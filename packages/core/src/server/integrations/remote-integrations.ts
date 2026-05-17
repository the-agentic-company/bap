import { db } from "@cmdclaw/db/client";
import { integration, integrationToken, user } from "@cmdclaw/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../env";
import type { IntegrationType } from "../oauth/config";
import { getEnabledIntegrationTypes, getTokensForIntegrations } from "./cli-env";

const REMOTE_INTEGRATION_TARGET_ENVS = ["staging", "prod"] as const;
export type RemoteIntegrationTargetEnv = (typeof REMOTE_INTEGRATION_TARGET_ENVS)[number];

const REMOTE_INTEGRATION_SUPPORTED_TYPES = [
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "salesforce",
  "dynamics",
  "reddit",
  "twitter",
] as const satisfies readonly IntegrationType[];

type RemoteIntegrationSupportedType = (typeof REMOTE_INTEGRATION_SUPPORTED_TYPES)[number];

export const remoteIntegrationTargetEnvSchema = z.enum(REMOTE_INTEGRATION_TARGET_ENVS);
export const remoteIntegrationTypeSchema = z.enum(REMOTE_INTEGRATION_SUPPORTED_TYPES);

export const remoteIntegrationSourceSchema = z.object({
  targetEnv: remoteIntegrationTargetEnvSchema,
  remoteUserId: z.string().min(1),
  requestedByUserId: z.string().min(1).optional(),
  requestedByEmail: z.string().email().nullable().optional(),
  remoteUserEmail: z.string().email().nullable().optional(),
});

export type RemoteIntegrationSource = z.infer<typeof remoteIntegrationSourceSchema>;

export const remoteIntegrationUserSummarySchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullable(),
  enabledIntegrationTypes: z.array(remoteIntegrationTypeSchema),
});

export type RemoteIntegrationUserSummary = z.infer<typeof remoteIntegrationUserSummarySchema>;

const remoteIntegrationUsersResponseSchema = z.object({
  users: z.array(remoteIntegrationUserSummarySchema),
});

export const remoteIntegrationCredentialsResponseSchema = z.object({
  remoteUserId: z.string().min(1),
  remoteUserEmail: z.string().email(),
  remoteUserName: z.string().nullable(),
  enabledIntegrations: z.array(remoteIntegrationTypeSchema),
  tokens: z.record(z.string(), z.string()),
});

export type RemoteIntegrationCredentialsResponse = z.infer<
  typeof remoteIntegrationCredentialsResponseSchema
>;

type RemoteTargetConfig = {
  env: RemoteIntegrationTargetEnv;
  baseUrl: string;
};

const REMOTE_INTEGRATION_TARGET_BASE_URLS: Record<RemoteIntegrationTargetEnv, string> = {
  staging: "https://staging.cmdclaw.ai",
  prod: "https://cmdclaw.ai",
};

function isRemoteIntegrationSupportedType(
  value: string | null | undefined,
): value is RemoteIntegrationSupportedType {
  return REMOTE_INTEGRATION_SUPPORTED_TYPES.includes(value as RemoteIntegrationSupportedType);
}

function getRemoteTargetConfigs(): RemoteTargetConfig[] {
  return [
    {
      env: "staging",
      baseUrl: REMOTE_INTEGRATION_TARGET_BASE_URLS.staging,
    },
    {
      env: "prod",
      baseUrl: REMOTE_INTEGRATION_TARGET_BASE_URLS.prod,
    },
  ];
}

function getRemoteTargetBaseUrl(targetEnv: RemoteIntegrationTargetEnv): string {
  const match = getRemoteTargetConfigs().find((entry) => entry.env === targetEnv);
  const baseUrl = match?.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error(`Remote integration target "${targetEnv}" is not configured`);
  }
  return baseUrl;
}

function requireRemoteIntegrationSecret(): string {
  const secret = env.CMDCLAW_SERVER_SECRET?.trim();
  if (!secret) {
    throw new Error("CMDCLAW_SERVER_SECRET is not configured");
  }
  return secret;
}

async function callRemoteIntegrationTarget<T>(
  targetEnv: RemoteIntegrationTargetEnv,
  path: string,
  body: unknown,
  schema: z.ZodSchema<T>,
): Promise<T> {
  const response = await fetch(new URL(path, getRemoteTargetBaseUrl(targetEnv)).toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireRemoteIntegrationSecret()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `Remote integration request failed (${response.status})`);
  }

  return schema.parse(await response.json());
}

export function listConfiguredRemoteIntegrationTargets(): RemoteIntegrationTargetEnv[] {
  return getRemoteTargetConfigs().map((entry) => entry.env);
}

export async function searchRemoteIntegrationUsers(params: {
  targetEnv: RemoteIntegrationTargetEnv;
  query: string;
  limit?: number;
}): Promise<RemoteIntegrationUserSummary[]> {
  const result = await callRemoteIntegrationTarget(
    params.targetEnv,
    "/api/internal/admin/remote-integrations/users",
    {
      query: params.query,
      limit: params.limit,
    },
    remoteIntegrationUsersResponseSchema,
  );

  return result.users;
}

export async function getRemoteIntegrationCredentials(params: {
  targetEnv: RemoteIntegrationTargetEnv;
  remoteUserId: string;
  integrationTypes: IntegrationType[];
  requestedByUserId?: string;
  requestedByEmail?: string | null;
}): Promise<RemoteIntegrationCredentialsResponse> {
  return callRemoteIntegrationTarget(
    params.targetEnv,
    "/api/internal/admin/remote-integrations/credentials",
    {
      remoteUserId: params.remoteUserId,
      integrationTypes: params.integrationTypes.filter(isRemoteIntegrationSupportedType),
      requestedByUserId: params.requestedByUserId,
      requestedByEmail: params.requestedByEmail ?? null,
    },
    remoteIntegrationCredentialsResponseSchema,
  );
}

export async function listLocalRemoteIntegrationUsers(params: {
  query: string;
  limit?: number;
}): Promise<RemoteIntegrationUserSummary[]> {
  const normalizedQuery = params.query.trim().toLowerCase();
  const limit = Math.max(1, Math.min(params.limit ?? 10, 25));
  const rows = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      type: integration.type,
    })
    .from(user)
    .innerJoin(
      integration,
      and(
        eq(integration.userId, user.id),
        eq(integration.enabled, true),
        eq(integration.authStatus, "connected"),
        inArray(integration.type, [...REMOTE_INTEGRATION_SUPPORTED_TYPES]),
      ),
    )
    .innerJoin(integrationToken, eq(integrationToken.integrationId, integration.id))
    .where(
      normalizedQuery
        ? sql`lower(${user.email}) like ${`%${normalizedQuery}%`}`
        : sql`true`,
    )
    .orderBy(desc(user.createdAt))
    .limit(limit * 8);

  const grouped = new Map<string, RemoteIntegrationUserSummary>();
  for (const row of rows) {
    if (!grouped.has(row.userId)) {
      grouped.set(row.userId, {
        id: row.userId,
        email: row.email,
        name: row.name,
        enabledIntegrationTypes: [],
      });
    }

    const summary = grouped.get(row.userId);
    if (!summary) {
      continue;
    }
    if (isRemoteIntegrationSupportedType(row.type) && !summary.enabledIntegrationTypes.includes(row.type)) {
      summary.enabledIntegrationTypes.push(row.type);
    }
  }

  return Array.from(grouped.values())
    .map((entry) => ({
      ...entry,
      enabledIntegrationTypes: [...entry.enabledIntegrationTypes].sort(),
    }))
    .slice(0, limit);
}

export async function getLocalRemoteIntegrationCredentials(params: {
  remoteUserId: string;
  integrationTypes: IntegrationType[];
}): Promise<RemoteIntegrationCredentialsResponse> {
  const remoteUser = await db.query.user.findFirst({
    where: eq(user.id, params.remoteUserId),
    columns: {
      id: true,
      email: true,
      name: true,
    },
  });

  if (!remoteUser) {
    throw new Error("Remote integration user not found");
  }

  const requestedIntegrationTypes = params.integrationTypes.filter(isRemoteIntegrationSupportedType);
  const enabledIntegrations = (await getEnabledIntegrationTypes(remoteUser.id)).filter(
    isRemoteIntegrationSupportedType,
  );

  return {
    remoteUserId: remoteUser.id,
    remoteUserEmail: remoteUser.email,
    remoteUserName: remoteUser.name,
    enabledIntegrations,
    tokens:
      requestedIntegrationTypes.length > 0
        ? await getTokensForIntegrations(remoteUser.id, requestedIntegrationTypes)
        : {},
  };
}
