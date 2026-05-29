import { and, eq, sql } from "drizzle-orm";
import { db } from "@cmdclaw/db/client";
import { providerAuth, sharedProviderAuth } from "@cmdclaw/db/schema";
import type { ProviderAuthSource } from "../../lib/provider-auth-source";
import {
  SUBSCRIPTION_PROVIDERS,
  isOAuthProviderConfig,
  type SubscriptionProviderID,
} from "../ai/subscription-providers";
import { decrypt, encrypt } from "../utils/encryption";
import { isSelfHostedEdition } from "../edition";
import { getCloudManagedProviderAuthStatus, getDelegatedProviderAuths } from "./client";

export type ResolvedProviderAuth = {
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  authSource: ProviderAuthSource;
};

const PROVIDER_AUTH_REFRESH_BUFFER_MS = 5 * 60 * 1000;

type ProviderAuthRecord = typeof providerAuth.$inferSelect;

export function isProviderAuthRefreshError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.trim().startsWith("Token refresh failed:")
  );
}

function shouldRefreshProviderAuth(expiresAt: number | null): boolean {
  if (!expiresAt) {
    return false;
  }

  return Date.now() >= expiresAt - PROVIDER_AUTH_REFRESH_BUFFER_MS;
}

function extractProviderTokenErrorDetail(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message =
      typeof parsed.error?.message === "string"
        ? parsed.error.message
        : typeof parsed.message === "string"
          ? parsed.message
          : null;
    if (message?.trim()) {
      return `${status} ${message.trim()}`;
    }
  } catch {
    // Fall back to a compact response body below.
  }

  const detail = text.replace(/\s+/g, " ").trim().slice(0, 180);
  return detail ? `${status} ${detail}` : String(status);
}

function toResolvedProviderAuth(
  auth: Pick<ProviderAuthRecord, "provider" | "accessToken" | "refreshToken" | "expiresAt">,
  authSource: ProviderAuthSource,
): ResolvedProviderAuth {
  return {
    provider: auth.provider,
    accessToken: decrypt(auth.accessToken),
    refreshToken: auth.refreshToken ? decrypt(auth.refreshToken) : null,
    expiresAt: auth.expiresAt?.getTime() ?? null,
    authSource,
  };
}

async function refreshOpenAIProviderTokens(input: {
  refreshToken: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}> {
  const tokenBody = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });

  if (input.clientSecret) {
    tokenBody.set("client_secret", input.clientSecret);
  }

  const response = await fetch(input.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenBody,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Token refresh failed: ${extractProviderTokenErrorDetail(response.status, text)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Token refresh failed: refresh response was not JSON");
  }

  const tokens = parsed as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
  };
  if (!tokens.access_token) {
    throw new Error("Token refresh failed: missing access_token");
  }

  const expiresIn =
    typeof tokens.expires_in === "number"
      ? tokens.expires_in
      : typeof tokens.expires_in === "string"
        ? Number(tokens.expires_in)
        : null;

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || input.refreshToken,
    expiresAt: expiresIn && Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000) : null,
  };
}

async function getValidProviderAuthRecord(
  params:
    | {
        type: "user";
        userId: string;
        provider: string;
      }
    | {
        type: "shared";
        provider: string;
      },
): Promise<ResolvedProviderAuth | null> {
  const authProviderId = params.provider as SubscriptionProviderID;
  const config = SUBSCRIPTION_PROVIDERS[authProviderId];
  const query =
    params.type === "user"
      ? db.query.providerAuth.findFirst({
          where: and(eq(providerAuth.userId, params.userId), eq(providerAuth.provider, params.provider)),
        })
      : db.query.sharedProviderAuth.findFirst({
          where: eq(sharedProviderAuth.provider, params.provider),
        });

  const auth = await query;
  if (!auth) {
    return null;
  }

  try {
    const resolved = toResolvedProviderAuth(auth, params.type === "user" ? "user" : "shared");
    if (
      authProviderId !== "openai" ||
      !config ||
      !isOAuthProviderConfig(config) ||
      !resolved.refreshToken ||
      !shouldRefreshProviderAuth(resolved.expiresAt)
    ) {
      return resolved;
    }
  } catch {
    return null;
  }

  const result = await db.transaction(async (tx) => {
    const lockKey =
      params.type === "user"
        ? `provider-auth:${params.userId}:${params.provider}`
        : `shared-provider-auth:${params.provider}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const current =
      params.type === "user"
        ? await tx.query.providerAuth.findFirst({
            where: and(eq(providerAuth.userId, params.userId), eq(providerAuth.provider, params.provider)),
          })
        : await tx.query.sharedProviderAuth.findFirst({
            where: eq(sharedProviderAuth.provider, params.provider),
          });

    if (!current) {
      return null;
    }

    const resolvedCurrent = toResolvedProviderAuth(
      current,
      params.type === "user" ? "user" : "shared",
    );
    if (!shouldRefreshProviderAuth(resolvedCurrent.expiresAt) || !resolvedCurrent.refreshToken) {
      return resolvedCurrent;
    }

    try {
      const refreshed = await refreshOpenAIProviderTokens({
        refreshToken: resolvedCurrent.refreshToken,
        tokenUrl: config.tokenUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      });

      const updateValues = {
        accessToken: encrypt(refreshed.accessToken),
        refreshToken: encrypt(refreshed.refreshToken),
        expiresAt: refreshed.expiresAt ?? current.expiresAt,
        updatedAt: new Date(),
      };

      if (params.type === "user") {
        await tx
          .update(providerAuth)
          .set(updateValues)
          .where(eq(providerAuth.id, current.id));
      } else {
        await tx
          .update(sharedProviderAuth)
          .set(updateValues)
          .where(eq(sharedProviderAuth.id, current.id));
      }

      return {
        provider: current.provider,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: updateValues.expiresAt?.getTime() ?? null,
        authSource: params.type === "user" ? "user" : "shared",
      } satisfies ResolvedProviderAuth;
    } catch (error) {
      if (resolvedCurrent.expiresAt && resolvedCurrent.expiresAt > Date.now()) {
        console.warn(
          `[ProviderAuth] OpenAI refresh failed for ${lockKey}; using existing access token until ${new Date(resolvedCurrent.expiresAt).toISOString()}:`,
          error,
        );
        return resolvedCurrent;
      }
      throw error;
    }
  });

  return result;
}

async function getConnectedProviderAuthIdsForUser(userId: string): Promise<string[]> {
  if (isSelfHostedEdition()) {
    const status = await getCloudManagedProviderAuthStatus(userId);
    return status.connected;
  }

  const auths = await db.query.providerAuth.findMany({
    where: eq(providerAuth.userId, userId),
    columns: {
      provider: true,
    },
  });

  return auths.map((auth) => auth.provider);
}

async function getSharedConnectedProviderAuthIds(): Promise<string[]> {
  if (isSelfHostedEdition()) {
    return [];
  }

  const auths = await db.query.sharedProviderAuth.findMany({
    columns: { provider: true },
  });

  return auths.map((auth) => auth.provider);
}

async function getProviderAuthAvailabilityForUser(userId: string): Promise<{
  connected: string[];
  shared: string[];
}> {
  const [connected, shared] = await Promise.all([
    getConnectedProviderAuthIdsForUser(userId),
    getSharedConnectedProviderAuthIds(),
  ]);

  return { connected, shared };
}

async function getUserProviderAuth(
  userId: string,
  provider: string,
): Promise<ResolvedProviderAuth | null> {
  if (isSelfHostedEdition()) {
    const delegated = await getDelegatedProviderAuths(userId);
    const auth = delegated.find((entry) => entry.provider === provider);
    if (!auth) {
      return null;
    }

    return {
      provider: auth.provider,
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken ?? null,
      expiresAt: auth.expiresAt ?? null,
      authSource: "user",
    };
  }

  return getValidProviderAuthRecord({
    type: "user",
    userId,
    provider,
  });
}

async function getSharedProviderAuth(provider: string): Promise<ResolvedProviderAuth | null> {
  if (isSelfHostedEdition()) {
    return null;
  }

  return getValidProviderAuthRecord({
    type: "shared",
    provider,
  });
}

export async function getResolvedProviderAuth(params: {
  userId: string;
  provider: string;
  authSource?: ProviderAuthSource | null;
}): Promise<ResolvedProviderAuth | null> {
  if (params.authSource === "shared") {
    return getSharedProviderAuth(params.provider);
  }

  if (params.authSource === "user") {
    return getUserProviderAuth(params.userId, params.provider);
  }

  return (
    (await getUserProviderAuth(params.userId, params.provider)) ??
    (await getSharedProviderAuth(params.provider))
  );
}

export async function hasConnectedProviderAuthForUser(
  userId: string,
  provider: string,
  authSource?: ProviderAuthSource | null,
) {
  const auth = await getResolvedProviderAuth({ userId, provider, authSource });
  return Boolean(auth);
}

async function upsertEncryptedProviderTokens(params: {
  table: typeof providerAuth | typeof sharedProviderAuth;
  provider: SubscriptionProviderID;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  userId?: string;
  managedByUserId?: string;
}): Promise<void> {
  const encryptedAccess = encrypt(params.accessToken);
  const encryptedRefresh = encrypt(params.refreshToken);

  if (params.table === providerAuth) {
    const existing = await db.query.providerAuth.findFirst({
      where: and(
        eq(providerAuth.userId, params.userId!),
        eq(providerAuth.provider, params.provider),
      ),
    });

    if (existing) {
      await db
        .update(providerAuth)
        .set({
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          expiresAt: params.expiresAt,
        })
        .where(eq(providerAuth.id, existing.id));
      return;
    }

    await db.insert(providerAuth).values({
      userId: params.userId!,
      provider: params.provider,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      expiresAt: params.expiresAt,
    });
    return;
  }

  const existing = await db.query.sharedProviderAuth.findFirst({
    where: eq(sharedProviderAuth.provider, params.provider),
  });

  if (existing) {
    await db
      .update(sharedProviderAuth)
      .set({
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt: params.expiresAt,
        managedByUserId: params.managedByUserId ?? null,
      })
      .where(eq(sharedProviderAuth.id, existing.id));
    return;
  }

  await db.insert(sharedProviderAuth).values({
    provider: params.provider,
    accessToken: encryptedAccess,
    refreshToken: encryptedRefresh,
    expiresAt: params.expiresAt,
    managedByUserId: params.managedByUserId ?? null,
  });
}

export async function storeProviderTokens(params: {
  userId: string;
  provider: SubscriptionProviderID;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}): Promise<void> {
  await upsertEncryptedProviderTokens({
    table: providerAuth,
    userId: params.userId,
    provider: params.provider,
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    expiresAt: params.expiresAt,
  });
}

export async function storeSharedProviderTokens(params: {
  managedByUserId: string;
  provider: SubscriptionProviderID;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}): Promise<void> {
  await upsertEncryptedProviderTokens({
    table: sharedProviderAuth,
    managedByUserId: params.managedByUserId,
    provider: params.provider,
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    expiresAt: params.expiresAt,
  });
}
