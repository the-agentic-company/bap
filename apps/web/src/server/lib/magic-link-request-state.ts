import { db } from "@cmdclaw/db/client";
import { magicLinkRequestState } from "@cmdclaw/db/schema";
import { and, eq, lt } from "drizzle-orm";
import {
  extractMagicLinkRedirectState,
  MAGIC_LINK_STATE_RETENTION_MS,
  MAGIC_LINK_TTL_MS,
} from "@/lib/magic-link-request";
import { hashMagicLinkToken } from "./magic-link-token-hash";

export const MAGIC_LINK_REQUEST_TTL_MS = MAGIC_LINK_TTL_MS;
export const MAGIC_LINK_REQUEST_STATE_RETENTION_MS = MAGIC_LINK_STATE_RETENTION_MS;

export type StoredMagicLinkRequestState = {
  tokenHash: string;
  email: string;
  callbackUrl: string | null;
  newUserCallbackUrl: string | null;
  errorCallbackUrl: string | null;
  status: "pending" | "consumed";
  consumedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
};

export type ResolvedMagicLinkPageState =
  | {
      status: "invalid";
      email: null;
      callbackUrl: null;
      newUserCallbackUrl: null;
      errorCallbackUrl: null;
    }
  | {
      status: "pending" | "expired" | "consumed";
      email: string;
      callbackUrl: string | null;
      newUserCallbackUrl: string | null;
      errorCallbackUrl: string | null;
    };

export async function createMagicLinkRequestState(params: {
  token: string;
  email: string;
  verificationUrl: string;
}) {
  const cleanupCutoff = new Date(Date.now() - MAGIC_LINK_REQUEST_STATE_RETENTION_MS);
  await db.delete(magicLinkRequestState).where(lt(magicLinkRequestState.expiresAt, cleanupCutoff));

  const redirectState = extractMagicLinkRedirectState(params.verificationUrl);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_REQUEST_TTL_MS);

  await db
    .insert(magicLinkRequestState)
    .values({
      tokenHash: hashMagicLinkToken(params.token),
      email: params.email,
      callbackUrl: redirectState.callbackURL ?? null,
      newUserCallbackUrl: redirectState.newUserCallbackURL ?? null,
      errorCallbackUrl: redirectState.errorCallbackURL ?? null,
      status: "pending",
      consumedAt: null,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: magicLinkRequestState.tokenHash,
      set: {
        email: params.email,
        callbackUrl: redirectState.callbackURL ?? null,
        newUserCallbackUrl: redirectState.newUserCallbackURL ?? null,
        errorCallbackUrl: redirectState.errorCallbackURL ?? null,
        status: "pending",
        consumedAt: null,
        expiresAt,
        createdAt: new Date(),
      },
    });

  return {
    tokenHash: hashMagicLinkToken(params.token),
    email: params.email,
    callbackUrl: redirectState.callbackURL ?? null,
    newUserCallbackUrl: redirectState.newUserCallbackURL ?? null,
    errorCallbackUrl: redirectState.errorCallbackURL ?? null,
    status: "pending" as const,
    consumedAt: null,
    expiresAt,
  };
}

export async function getMagicLinkRequestState(
  token: string,
): Promise<StoredMagicLinkRequestState | null> {
  const row = await db.query.magicLinkRequestState.findFirst({
    where: eq(magicLinkRequestState.tokenHash, hashMagicLinkToken(token)),
  });

  return row ?? null;
}

export async function resolveMagicLinkPageState(
  token: string,
): Promise<ResolvedMagicLinkPageState> {
  const row = await getMagicLinkRequestState(token);

  if (!row) {
    return {
      status: "invalid",
      email: null,
      callbackUrl: null,
      newUserCallbackUrl: null,
      errorCallbackUrl: null,
    };
  }

  if (row.status === "consumed") {
    return {
      status: "consumed",
      email: row.email,
      callbackUrl: row.callbackUrl,
      newUserCallbackUrl: row.newUserCallbackUrl,
      errorCallbackUrl: row.errorCallbackUrl,
    };
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    return {
      status: "expired",
      email: row.email,
      callbackUrl: row.callbackUrl,
      newUserCallbackUrl: row.newUserCallbackUrl,
      errorCallbackUrl: row.errorCallbackUrl,
    };
  }

  return {
    status: "pending",
    email: row.email,
    callbackUrl: row.callbackUrl,
    newUserCallbackUrl: row.newUserCallbackUrl,
    errorCallbackUrl: row.errorCallbackUrl,
  };
}

export async function markMagicLinkRequestConsumed(token: string) {
  await db
    .update(magicLinkRequestState)
    .set({
      status: "consumed",
      consumedAt: new Date(),
    })
    .where(
      and(
        eq(magicLinkRequestState.tokenHash, hashMagicLinkToken(token)),
        eq(magicLinkRequestState.status, "pending"),
      ),
    );
}
