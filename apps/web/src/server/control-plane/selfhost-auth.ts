import type { CloudAuthExchangePayload } from "@bap/core/server/control-plane/types";
import { ensureWorkspaceForUser } from "@bap/core/server/billing/service";
import { upsertCloudAccountLinkForUser } from "@bap/core/server/control-plane/local-links";
import { db } from "@bap/db/client";
import { cloudAccountLink, session, user } from "@bap/db/schema";
import { serializeSignedCookie } from "better-call";
import { eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { env } from "@/env";
import { INVITE_ONLY_LOGIN_ERROR, shouldGrantAdminRole } from "@/lib/admin-emails";
import { isApprovedLoginEmail } from "@/server/lib/approved-login-emails";

function getDefaultName(email: string, fallbackName: string | null) {
  if (fallbackName?.trim()) {
    return fallbackName.trim();
  }

  const [localPart] = email.split("@");
  return localPart?.trim() || "Bap User";
}

function normalizeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getSessionCookieName(requestUrl: string) {
  const appUrl = env.APP_URL ?? env.VITE_APP_URL ?? requestUrl;
  return new URL(appUrl).protocol === "https:"
    ? "__Secure-better-auth.session_token"
    : "better-auth.session_token";
}

async function assertInviteOnlyLogin(email: string) {
  if (await isApprovedLoginEmail(email)) {
    return;
  }

  throw new Error(INVITE_ONLY_LOGIN_ERROR);
}

async function createLocalSession(userId: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const token = randomBytes(48).toString("hex");

  await db.insert(session).values({
    id: randomUUID(),
    userId,
    token,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  return { token, expiresAt };
}

export async function resolveOrCreateLocalUserFromCloudIdentity(
  identity: CloudAuthExchangePayload,
): Promise<string> {
  await assertInviteOnlyLogin(identity.email);

  const now = new Date();
  const linkedUser = await db.query.cloudAccountLink.findFirst({
    where: eq(cloudAccountLink.cloudUserId, identity.cloudUserId),
    with: {
      user: {
        columns: {
          id: true,
          role: true,
        },
      },
    },
  });

  if (linkedUser?.user) {
    await db
      .update(user)
      .set({
        email: identity.email,
        name: getDefaultName(identity.email, identity.name),
        image: identity.image,
        emailVerified: true,
        onboardedAt: now,
        updatedAt: now,
        ...(shouldGrantAdminRole(identity.email) ? { role: "admin" } : {}),
      })
      .where(eq(user.id, linkedUser.user.id));

    await ensureWorkspaceForUser(linkedUser.user.id);
    return linkedUser.user.id;
  }

  const existingUser = await db.query.user.findFirst({
    where: eq(user.email, identity.email),
    columns: {
      id: true,
      role: true,
    },
  });

  if (existingUser) {
    const existingLink = await db.query.cloudAccountLink.findFirst({
      where: eq(cloudAccountLink.userId, existingUser.id),
      columns: {
        cloudUserId: true,
      },
    });

    if (existingLink && existingLink.cloudUserId !== identity.cloudUserId) {
      throw new Error("This self-hosted user is already linked to a different cloud account");
    }

    await db
      .update(user)
      .set({
        email: identity.email,
        name: getDefaultName(identity.email, identity.name),
        image: identity.image,
        emailVerified: true,
        onboardedAt: now,
        updatedAt: now,
        ...(shouldGrantAdminRole(identity.email) ? { role: "admin" } : {}),
      })
      .where(eq(user.id, existingUser.id));

    await upsertCloudAccountLinkForUser(existingUser.id, identity.cloudUserId);
    await ensureWorkspaceForUser(existingUser.id);
    return existingUser.id;
  }

  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    email: identity.email,
    name: getDefaultName(identity.email, identity.name),
    image: identity.image,
    emailVerified: true,
    onboardedAt: now,
    role: shouldGrantAdminRole(identity.email) ? "admin" : "user",
    createdAt: now,
    updatedAt: now,
  });

  await upsertCloudAccountLinkForUser(userId, identity.cloudUserId);
  await ensureWorkspaceForUser(userId, null);

  return userId;
}

/**
 * Serializes a `Set-Cookie` header value. Implemented inline (rather than via
 * `better-call`'s serializeCookie) to preserve the previous `standard cookie handling`
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
    const sameSite = options.sameSite;
    parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);
  }
  return parts.join("; ");
}

export async function createLocalSessionRedirectResponse(args: {
  userId: string;
  redirectUrl: URL;
  requestUrl: string;
}): Promise<Response> {
  const { token, expiresAt } = await createLocalSession(args.userId);
  const signedToken = (await serializeSignedCookie("", token, env.BETTER_AUTH_SECRET)).replace(
    "=",
    "",
  );

  const cookieName = getSessionCookieName(args.requestUrl);
  const otherCookieName =
    cookieName === "better-auth.session_token"
      ? "__Secure-better-auth.session_token"
      : "better-auth.session_token";

  const headers = new Headers();
  headers.set("location", args.redirectUrl.toString());

  headers.append(
    "set-cookie",
    serializeSetCookie(cookieName, normalizeCookieValue(signedToken), {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieName.startsWith("__Secure-"),
      expires: expiresAt,
      path: "/",
    }),
  );

  // Clear the cookie for the protocol we are not using (matches standard cookie handling.delete).
  headers.append(
    "set-cookie",
    serializeSetCookie(otherCookieName, "", {
      path: "/",
      maxAge: 0,
    }),
  );

  return new Response(null, { status: 307, headers });
}
