import { randomBytes, randomUUID } from "node:crypto";
import { ensureWorkspaceForUser } from "@cmdclaw/core/server/billing/service";
import { db } from "@cmdclaw/db/client";
import { session, user } from "@cmdclaw/db/schema";
import { serializeSignedCookie } from "better-call";
import { eq } from "drizzle-orm";
import { env } from "@/env";
import { shouldGrantAdminRole } from "@/lib/admin-emails";
import {
  canUseWorktreeAutoLoginForRequest,
  WORKTREE_AUTO_LOGIN_UNAVAILABLE_ERROR,
} from "@/lib/worktree-auto-login";
import { sanitizeReturnPath } from "@/server/control-plane/return-path";
import { loadWorktreeSessionCookie } from "@/server/worktree-auto-login-storage";

/**
 * Framework-neutral handlers for the development-only `/api/dev/**` routes.
 *
 * These endpoints are gated to loopback hosts (auto-login) and worktree instances
 * (worktree-auth); they mint a Better Auth session cookie and redirect back to the
 * sanitized callback path. Everything here uses standard Web Request/Response and the
 * `better-call` cookie serializer so the TanStack Start route files stay thin adapters.
 */

const DEFAULT_DEV_AUTO_LOGIN_EMAIL = "cmdclaw@example.com";
const DEFAULT_DEV_AUTO_LOGIN_NAME = "Baptiste";
const LOOPBACK_HOSTNAMES = new Set(["0.0.0.0", "127.0.0.1", "::1", "[::1]", "localhost"]);

const SESSION_COOKIE_NAME = "better-auth.session_token";
const SECURE_SESSION_COOKIE_NAME = "__Secure-better-auth.session_token";

function isLoopbackRequest(requestUrl: URL): boolean {
  return LOOPBACK_HOSTNAMES.has(requestUrl.hostname);
}

function getSessionCookieName(requestUrl: URL): string {
  return requestUrl.protocol === "https:" ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME;
}

function getOtherSessionCookieName(cookieName: string): string {
  return cookieName === SESSION_COOKIE_NAME ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME;
}

function normalizeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Serializes a `Set-Cookie` header value. Implemented inline (rather than via
 * `better-call`'s serializeCookie) to preserve the previous `NextResponse.cookies`
 * behavior, which does not cap `expires` at 400 days and URL-encodes the cookie value.
 */
function serializeSetCookie(
  name: string,
  value: string,
  options: {
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
    expires?: Date;
    maxAge?: number;
  },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  if (options.sameSite) {
    const value = options.sameSite;
    parts.push(`SameSite=${value.charAt(0).toUpperCase()}${value.slice(1)}`);
  }
  return parts.join("; ");
}

/**
 * Builds a redirect Response that sets the session cookie and clears the cookie that the
 * current protocol does not use, mirroring the previous `NextResponse.cookies` behavior.
 */
function buildSessionRedirect(options: {
  requestUrl: URL;
  callbackUrl: string;
  cookieName: string;
  cookieValue: string;
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  expires: Date | undefined;
}): Response {
  const { requestUrl, callbackUrl, cookieName, cookieValue, httpOnly, sameSite, expires } = options;
  const headers = new Headers();
  headers.set("location", new URL(callbackUrl, requestUrl).toString());

  headers.append(
    "set-cookie",
    serializeSetCookie(cookieName, cookieValue, {
      httpOnly,
      sameSite,
      secure: cookieName.startsWith("__Secure-"),
      expires,
      path: "/",
    }),
  );

  // Clear the cookie for the protocol we are not using (matches NextResponse.cookies.delete).
  headers.append(
    "set-cookie",
    serializeSetCookie(getOtherSessionCookieName(cookieName), "", {
      path: "/",
      maxAge: 0,
    }),
  );

  return new Response(null, { status: 307, headers });
}

function redirectTo(requestUrl: URL, target: string): Response {
  return new Response(null, {
    status: 307,
    headers: { location: new URL(target, requestUrl).toString() },
  });
}

function redirectToLogin(requestUrl: URL, callbackUrl: string, error: string): Response {
  const loginUrl = new URL("/login", requestUrl);
  loginUrl.searchParams.set("callbackUrl", callbackUrl);
  loginUrl.searchParams.set("error", error);
  return redirectTo(requestUrl, loginUrl.toString());
}

async function ensureDevUser(email: string): Promise<string> {
  const now = new Date();
  const existingUser = await db.query.user.findFirst({
    where: eq(user.email, email),
  });

  if (existingUser) {
    await db
      .update(user)
      .set({
        name: existingUser.name || DEFAULT_DEV_AUTO_LOGIN_NAME,
        emailVerified: true,
        onboardedAt: existingUser.onboardedAt ?? now,
        updatedAt: now,
        ...(shouldGrantAdminRole(email) ? { role: "admin" } : {}),
      })
      .where(eq(user.id, existingUser.id));

    await ensureWorkspaceForUser(existingUser.id, existingUser.activeWorkspaceId);
    return existingUser.id;
  }

  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    email,
    name: DEFAULT_DEV_AUTO_LOGIN_NAME,
    emailVerified: true,
    onboardedAt: now,
    role: shouldGrantAdminRole(email) ? "admin" : "user",
    createdAt: now,
    updatedAt: now,
  });

  await ensureWorkspaceForUser(userId, null);
  return userId;
}

async function createSessionCookie(userId: string, requestUrl: URL) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const token = randomBytes(48).toString("hex");

  await db.insert(session).values({
    id: randomUUID(),
    userId,
    token,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ipAddress: "127.0.0.1",
    userAgent: "cmdclaw-dev-auto-login",
  });

  const signedToken = (await serializeSignedCookie("", token, env.BETTER_AUTH_SECRET)).replace(
    "=",
    "",
  );

  return {
    cookieName: getSessionCookieName(requestUrl),
    expiresAt,
    signedToken: normalizeCookieValue(signedToken),
  };
}

/** GET /api/dev/auto-login */
export async function handleDevAutoLogin(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const callbackUrl = sanitizeReturnPath(requestUrl.searchParams.get("callbackUrl"), "/agents");

  if (!isLoopbackRequest(requestUrl)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (env.APP_DEV_AUTO_LOGIN !== "1") {
    return redirectToLogin(requestUrl, callbackUrl, "dev_auto_login_unavailable");
  }

  const email =
    env.APP_DEV_AUTO_LOGIN_EMAIL ?? env.APP_DEFAULT_USER_EMAIL ?? DEFAULT_DEV_AUTO_LOGIN_EMAIL;
  const userId = await ensureDevUser(email);
  const { cookieName, expiresAt, signedToken } = await createSessionCookie(userId, requestUrl);

  return buildSessionRedirect({
    requestUrl,
    callbackUrl,
    cookieName,
    cookieValue: signedToken,
    httpOnly: true,
    sameSite: "lax",
    expires: expiresAt,
  });
}

/** GET /api/dev/health */
export function handleDevHealth(): Response {
  return Response.json({ ok: true });
}

/** GET /api/dev/worktree-auth */
export function handleDevWorktreeAuth(request: Request): Response {
  const requestUrl = new URL(request.url);
  const callbackUrl = sanitizeReturnPath(requestUrl.searchParams.get("callbackUrl"), "/chat");

  if (!canUseWorktreeAutoLoginForRequest(request)) {
    return redirectToLogin(requestUrl, callbackUrl, WORKTREE_AUTO_LOGIN_UNAVAILABLE_ERROR);
  }

  const worktreeSessionCookie = loadWorktreeSessionCookie();
  if (!worktreeSessionCookie) {
    return redirectToLogin(requestUrl, callbackUrl, WORKTREE_AUTO_LOGIN_UNAVAILABLE_ERROR);
  }

  const cookieName = getSessionCookieName(requestUrl);
  return buildSessionRedirect({
    requestUrl,
    callbackUrl,
    cookieName,
    cookieValue: worktreeSessionCookie.value,
    httpOnly: worktreeSessionCookie.httpOnly,
    sameSite: worktreeSessionCookie.sameSite,
    expires: worktreeSessionCookie.expires,
  });
}
