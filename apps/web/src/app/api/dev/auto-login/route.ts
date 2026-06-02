import { ensureWorkspaceForUser } from "@cmdclaw/core/server/billing/service";
import { db } from "@cmdclaw/db/client";
import { session, user } from "@cmdclaw/db/schema";
import { serializeSignedCookie } from "better-call";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { env } from "@/env";
import { shouldGrantAdminRole } from "@/lib/admin-emails";
import { sanitizeReturnPath } from "@/server/control-plane/return-path";

export const runtime = "nodejs";

const DEFAULT_DEV_AUTO_LOGIN_EMAIL = "baptiste@heybap.com";
const DEFAULT_DEV_AUTO_LOGIN_NAME = "Baptiste";
const LOOPBACK_HOSTNAMES = new Set(["0.0.0.0", "127.0.0.1", "::1", "[::1]", "localhost"]);

function isLoopbackRequest(requestUrl: URL) {
  return LOOPBACK_HOSTNAMES.has(requestUrl.hostname);
}

function getSessionCookieName(requestUrl: URL) {
  return requestUrl.protocol === "https:"
    ? "__Secure-better-auth.session_token"
    : "better-auth.session_token";
}

function normalizeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function redirectToLogin(request: Request, callbackUrl: string) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", callbackUrl);
  loginUrl.searchParams.set("error", "dev_auto_login_unavailable");
  return NextResponse.redirect(loginUrl);
}

async function ensureDevUser(email: string) {
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

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const callbackUrl = sanitizeReturnPath(requestUrl.searchParams.get("callbackUrl"), "/agents");

  if (!isLoopbackRequest(requestUrl)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (env.CMDCLAW_DEV_AUTO_LOGIN !== "1") {
    return redirectToLogin(request, callbackUrl);
  }

  const email = env.CMDCLAW_DEV_AUTO_LOGIN_EMAIL ?? DEFAULT_DEV_AUTO_LOGIN_EMAIL;
  const userId = await ensureDevUser(email);
  const { cookieName, expiresAt, signedToken } = await createSessionCookie(userId, requestUrl);

  const response = NextResponse.redirect(new URL(callbackUrl, request.url));
  response.cookies.set(cookieName, signedToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieName.startsWith("__Secure-"),
    expires: expiresAt,
    path: "/",
  });

  const otherCookieName =
    cookieName === "better-auth.session_token"
      ? "__Secure-better-auth.session_token"
      : "better-auth.session_token";
  response.cookies.delete(otherCookieName);

  return response;
}
