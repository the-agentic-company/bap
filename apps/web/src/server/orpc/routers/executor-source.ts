import {
  resolveMcpEndpoint,
  startMcpOAuthAuthorization,
} from "@bap/core/server/executor/mcp-oauth";
import {
  computeWorkspaceMcpServerRevisionHash,
  listWorkspaceMcpServers,
  normalizeExecutorNamespace,
  setWorkspaceMcpServerCredential,
} from "@bap/core/server/executor/workspace-sources";
import { user, workspace, workspaceMcpServer, workspaceMcpAuthorization } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { storeWorkspaceMcpServerOAuthPending } from "@/server/executor-source-oauth";
import type { AuthenticatedContext } from "../middleware";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess, requireActiveWorkspaceAdmin } from "../workspace-access";

const stringMapSchema = z.record(z.string(), z.string()).default({});
const workspaceMcpServerKindSchema = z.enum(["mcp"]);
const workspaceMcpServerAuthTypeSchema = z.enum(["none", "api_key", "bearer", "oauth2"]);
const workspaceIdSchema = z.object({ workspaceId: z.string() });

function generateState(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function getAppUrl(): string {
  return process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
}

const workspaceMcpServerBaseSchema = z.object({
  kind: workspaceMcpServerKindSchema,
  name: z.string().min(1).max(120),
  namespace: z.string().min(1).max(120),
  endpoint: z.string().url(),
  specUrl: z.string().url().nullish(),
  transport: z.string().max(120).nullish(),
  headers: stringMapSchema.optional(),
  queryParams: stringMapSchema.optional(),
  defaultHeaders: stringMapSchema.optional(),
  authType: workspaceMcpServerAuthTypeSchema.default("none"),
  authHeaderName: z.string().max(120).nullish(),
  authQueryParam: z.string().max(120).nullish(),
  authPrefix: z.string().max(120).nullish(),
  enabled: z.boolean().default(true),
});

function validateWorkspaceMcpServerInput(
  _value: z.infer<typeof workspaceMcpServerBaseSchema>,
  _ctx: z.RefinementCtx,
) {}

export const workspaceMcpServerInputSchema = workspaceMcpServerBaseSchema.superRefine(
  validateWorkspaceMcpServerInput,
);

const adminWorkspaceMcpServerBaseSchema = workspaceIdSchema.extend(
  workspaceMcpServerBaseSchema.shape,
);

const adminWorkspaceMcpServerInputSchema = adminWorkspaceMcpServerBaseSchema.superRefine(
  validateWorkspaceMcpServerInput,
);

const workspaceMcpServerUpdateInputSchema = workspaceMcpServerBaseSchema
  .extend({ id: z.string() })
  .superRefine(validateWorkspaceMcpServerInput);

const adminWorkspaceMcpServerUpdateInputSchema = adminWorkspaceMcpServerBaseSchema
  .extend({ id: z.string() })
  .superRefine(validateWorkspaceMcpServerInput);

function normalizeStringMap(
  value: Record<string, string> | undefined,
): Record<string, string> | null {
  if (!value) {
    return null;
  }

  const entries = Object.entries(value)
    .map(([key, entryValue]) => [key.trim(), entryValue.trim()] as const)
    .filter(([key, entryValue]) => key.length > 0 && entryValue.length > 0);

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalizeAuthSettings(input: {
  kind: z.infer<typeof workspaceMcpServerKindSchema>;
  authType: z.infer<typeof workspaceMcpServerAuthTypeSchema>;
  authHeaderName?: string | null;
  authQueryParam?: string | null;
  authPrefix?: string | null;
}) {
  if (input.authType === "oauth2") {
    return {
      authHeaderName: null,
      authQueryParam: null,
      authPrefix: null,
    };
  }

  return {
    authHeaderName: input.authHeaderName?.trim() || null,
    authQueryParam: input.kind === "mcp" ? input.authQueryParam?.trim() || null : null,
    authPrefix: input.authPrefix ?? null,
  };
}

function normalizeCredentialExpiresAt(value: string | null | undefined): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed.includes("T") ? trimmed : `${trimmed}T23:59:59.999Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Credential expiration date is invalid.",
    });
  }
  return parsed;
}

async function requireAdmin(context: Pick<AuthenticatedContext, "db" | "user">) {
  const currentUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
    columns: { role: true },
  });

  if (currentUser?.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin role required" });
  }
}

async function getAdminWorkspace(
  context: Pick<AuthenticatedContext, "db" | "user">,
  workspaceId: string,
) {
  await requireAdmin(context);

  const selectedWorkspace = await context.db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
    columns: { id: true, name: true },
  });

  if (!selectedWorkspace) {
    throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
  }

  return selectedWorkspace;
}

async function getAdminSource(
  context: Pick<AuthenticatedContext, "db" | "user">,
  workspaceId: string,
  workspaceMcpServerId: string,
) {
  await getAdminWorkspace(context, workspaceId);

  const source = await context.db.query.workspaceMcpServer.findFirst({
    where: and(
      eq(workspaceMcpServer.id, workspaceMcpServerId),
      eq(workspaceMcpServer.workspaceId, workspaceId),
    ),
  });

  if (!source) {
    throw new ORPCError("NOT_FOUND", { message: "Workspace MCP Server not found." });
  }

  return source;
}

function assertMutableWorkspaceMcpServer(
  source: Pick<typeof workspaceMcpServer.$inferSelect, "internalKey">,
) {
  if (source.internalKey) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Managed Workspace MCP Servers cannot be edited or deleted manually.",
    });
  }
}

function assertManualCredentialSource(
  source: Pick<typeof workspaceMcpServer.$inferSelect, "internalKey">,
) {
  if (source.internalKey) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Managed Workspace MCP Servers use the integration connection flow, not manual credentials.",
    });
  }
}

const list = protectedProcedure.handler(async ({ context }) => {
  const access = await requireActiveWorkspaceAccess(context.user.id);
  const sources = await listWorkspaceMcpServers({
    database: context.db,
    workspaceId: access.workspace.id,
    userId: context.user.id,
  });

  return {
    workspaceId: access.workspace.id,
    membershipRole: access.membership.role,
    sources,
  };
});

const adminList = protectedProcedure
  .input(workspaceIdSchema)
  .handler(async ({ input, context }) => {
    const selectedWorkspace = await getAdminWorkspace(context, input.workspaceId);
    const sources = await listWorkspaceMcpServers({
      database: context.db,
      workspaceId: selectedWorkspace.id,
      userId: context.user.id,
    });

    return {
      workspaceId: selectedWorkspace.id,
      membershipRole: "admin" as const,
      sources,
    };
  });

const startOAuth = protectedProcedure
  .input(
    z.object({
      workspaceMcpServerId: z.string(),
      redirectUrl: z.string().url(),
    }),
  )
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAccess(context.user.id);
    const source = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.id, input.workspaceMcpServerId),
        eq(workspaceMcpServer.workspaceId, access.workspace.id),
      ),
    });

    if (!source) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Server not found.",
      });
    }

    if (source.kind !== "mcp" || source.authType !== "oauth2") {
      throw new ORPCError("BAD_REQUEST", {
        message: "This Workspace MCP Server is not configured for MCP OAuth.",
      });
    }

    const state = generateState();
    const { authorizationUrl, session } = await startMcpOAuthAuthorization({
      endpoint: resolveMcpEndpoint({
        endpoint: source.endpoint,
        queryParams: source.queryParams,
      }),
      redirectUrl: `${getAppUrl()}/api/oauth/callback`,
      state,
    });

    await storeWorkspaceMcpServerOAuthPending({
      state,
      userId: context.user.id,
      workspaceMcpServerId: source.id,
      redirectUrl: input.redirectUrl,
      session,
    });

    return { authUrl: authorizationUrl };
  });

const create = protectedProcedure
  .input(workspaceMcpServerInputSchema)
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAdmin(context.user.id);
    const namespace = normalizeExecutorNamespace(input.namespace);
    const existing = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.workspaceId, access.workspace.id),
        eq(workspaceMcpServer.namespace, namespace),
      ),
    });

    if (existing) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Workspace MCP Server namespace "${namespace}" already exists in this workspace.`,
      });
    }

    const revisionHash = computeWorkspaceMcpServerRevisionHash({
      kind: input.kind,
      name: input.name,
      namespace,
      endpoint: input.endpoint,
      specUrl: input.specUrl ?? null,
      transport: input.transport ?? null,
      headers: normalizeStringMap(input.headers),
      queryParams: normalizeStringMap(input.queryParams),
      defaultHeaders: normalizeStringMap(input.defaultHeaders),
      authType: input.authType,
      ...normalizeAuthSettings(input),
      enabled: input.enabled,
    });

    const [created] = await context.db
      .insert(workspaceMcpServer)
      .values({
        workspaceId: access.workspace.id,
        kind: input.kind,
        name: input.name.trim(),
        namespace,
        endpoint: input.endpoint.trim(),
        specUrl: null,
        transport: input.transport?.trim() ?? null,
        headers: normalizeStringMap(input.headers),
        queryParams: normalizeStringMap(input.queryParams),
        defaultHeaders: null,
        authType: input.authType,
        ...normalizeAuthSettings(input),
        enabled: input.enabled,
        revisionHash,
        createdByUserId: context.user.id,
        updatedByUserId: context.user.id,
      })
      .returning();

    return { id: created.id };
  });

const adminCreate = protectedProcedure
  .input(adminWorkspaceMcpServerInputSchema)
  .handler(async ({ input, context }) => {
    const selectedWorkspace = await getAdminWorkspace(context, input.workspaceId);
    const namespace = normalizeExecutorNamespace(input.namespace);
    const existing = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.workspaceId, selectedWorkspace.id),
        eq(workspaceMcpServer.namespace, namespace),
      ),
    });

    if (existing) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Workspace MCP Server namespace "${namespace}" already exists in this workspace.`,
      });
    }

    const revisionHash = computeWorkspaceMcpServerRevisionHash({
      kind: input.kind,
      name: input.name,
      namespace,
      endpoint: input.endpoint,
      specUrl: input.specUrl ?? null,
      transport: input.transport ?? null,
      headers: normalizeStringMap(input.headers),
      queryParams: normalizeStringMap(input.queryParams),
      defaultHeaders: normalizeStringMap(input.defaultHeaders),
      authType: input.authType,
      ...normalizeAuthSettings(input),
      enabled: input.enabled,
    });

    const [created] = await context.db
      .insert(workspaceMcpServer)
      .values({
        workspaceId: selectedWorkspace.id,
        kind: input.kind,
        name: input.name.trim(),
        namespace,
        endpoint: input.endpoint.trim(),
        specUrl: null,
        transport: input.transport?.trim() ?? null,
        headers: normalizeStringMap(input.headers),
        queryParams: normalizeStringMap(input.queryParams),
        defaultHeaders: null,
        authType: input.authType,
        ...normalizeAuthSettings(input),
        enabled: input.enabled,
        revisionHash,
        createdByUserId: context.user.id,
        updatedByUserId: context.user.id,
      })
      .returning();

    return { id: created.id };
  });

const update = protectedProcedure
  .input(workspaceMcpServerUpdateInputSchema)
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAdmin(context.user.id);
    const current = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.id, input.id),
        eq(workspaceMcpServer.workspaceId, access.workspace.id),
      ),
    });

    if (!current) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Server not found.",
      });
    }
    assertMutableWorkspaceMcpServer(current);

    const namespace = normalizeExecutorNamespace(input.namespace);
    const duplicate = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.workspaceId, access.workspace.id),
        eq(workspaceMcpServer.namespace, namespace),
      ),
    });

    if (duplicate && duplicate.id !== input.id) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Workspace MCP Server namespace "${namespace}" already exists in this workspace.`,
      });
    }

    const revisionHash = computeWorkspaceMcpServerRevisionHash({
      kind: input.kind,
      name: input.name,
      namespace,
      endpoint: input.endpoint,
      specUrl: input.specUrl ?? null,
      transport: input.transport ?? null,
      headers: normalizeStringMap(input.headers),
      queryParams: normalizeStringMap(input.queryParams),
      defaultHeaders: normalizeStringMap(input.defaultHeaders),
      authType: input.authType,
      ...normalizeAuthSettings(input),
      enabled: input.enabled,
    });

    await context.db
      .update(workspaceMcpServer)
      .set({
        kind: input.kind,
        name: input.name.trim(),
        namespace,
        endpoint: input.endpoint.trim(),
        specUrl: null,
        transport: input.transport?.trim() ?? null,
        headers: normalizeStringMap(input.headers),
        queryParams: normalizeStringMap(input.queryParams),
        defaultHeaders: null,
        authType: input.authType,
        ...normalizeAuthSettings(input),
        enabled: input.enabled,
        revisionHash,
        updatedByUserId: context.user.id,
      })
      .where(eq(workspaceMcpServer.id, input.id));

    return { success: true };
  });

const adminUpdate = protectedProcedure
  .input(adminWorkspaceMcpServerUpdateInputSchema)
  .handler(async ({ input, context }) => {
    const selectedWorkspace = await getAdminWorkspace(context, input.workspaceId);
    const current = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.id, input.id),
        eq(workspaceMcpServer.workspaceId, selectedWorkspace.id),
      ),
    });

    if (!current) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Server not found.",
      });
    }
    assertMutableWorkspaceMcpServer(current);

    const namespace = normalizeExecutorNamespace(input.namespace);
    const duplicate = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.workspaceId, selectedWorkspace.id),
        eq(workspaceMcpServer.namespace, namespace),
      ),
    });

    if (duplicate && duplicate.id !== input.id) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Workspace MCP Server namespace "${namespace}" already exists in this workspace.`,
      });
    }

    const revisionHash = computeWorkspaceMcpServerRevisionHash({
      kind: input.kind,
      name: input.name,
      namespace,
      endpoint: input.endpoint,
      specUrl: input.specUrl ?? null,
      transport: input.transport ?? null,
      headers: normalizeStringMap(input.headers),
      queryParams: normalizeStringMap(input.queryParams),
      defaultHeaders: normalizeStringMap(input.defaultHeaders),
      authType: input.authType,
      ...normalizeAuthSettings(input),
      enabled: input.enabled,
    });

    await context.db
      .update(workspaceMcpServer)
      .set({
        kind: input.kind,
        name: input.name.trim(),
        namespace,
        endpoint: input.endpoint.trim(),
        specUrl: null,
        transport: input.transport?.trim() ?? null,
        headers: normalizeStringMap(input.headers),
        queryParams: normalizeStringMap(input.queryParams),
        defaultHeaders: null,
        authType: input.authType,
        ...normalizeAuthSettings(input),
        enabled: input.enabled,
        revisionHash,
        updatedByUserId: context.user.id,
      })
      .where(eq(workspaceMcpServer.id, input.id));

    return { success: true };
  });

const remove = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAdmin(context.user.id);
    const current = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.id, input.id),
        eq(workspaceMcpServer.workspaceId, access.workspace.id),
      ),
    });
    if (!current) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Server not found.",
      });
    }
    assertMutableWorkspaceMcpServer(current);
    const deleted = await context.db
      .delete(workspaceMcpServer)
      .where(
        and(
          eq(workspaceMcpServer.id, input.id),
          eq(workspaceMcpServer.workspaceId, access.workspace.id),
        ),
      )
      .returning({ id: workspaceMcpServer.id });

    if (deleted.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Server not found.",
      });
    }

    return { success: true };
  });

const adminDelete = protectedProcedure
  .input(z.object({ workspaceId: z.string(), id: z.string() }))
  .handler(async ({ input, context }) => {
    const selectedWorkspace = await getAdminWorkspace(context, input.workspaceId);
    const current = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.id, input.id),
        eq(workspaceMcpServer.workspaceId, selectedWorkspace.id),
      ),
    });
    if (!current) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Server not found.",
      });
    }
    assertMutableWorkspaceMcpServer(current);
    const deleted = await context.db
      .delete(workspaceMcpServer)
      .where(
        and(
          eq(workspaceMcpServer.id, input.id),
          eq(workspaceMcpServer.workspaceId, selectedWorkspace.id),
        ),
      )
      .returning({ id: workspaceMcpServer.id });

    if (deleted.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Server not found.",
      });
    }

    return { success: true };
  });

const setCredential = protectedProcedure
  .input(
    z.object({
      workspaceMcpServerId: z.string(),
      secret: z.string().min(1),
      displayName: z.string().max(120).nullish(),
      expiresAt: z.string().max(40).nullish(),
      enabled: z.boolean().default(true),
    }),
  )
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAccess(context.user.id);
    const source = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.id, input.workspaceMcpServerId),
        eq(workspaceMcpServer.workspaceId, access.workspace.id),
      ),
    });

    if (!source) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Server not found.",
      });
    }
    assertManualCredentialSource(source);

    if (source.authType === "oauth2") {
      throw new ORPCError("BAD_REQUEST", {
        message: "OAuth Workspace MCP Servers must be connected through the OAuth flow.",
      });
    }

    await setWorkspaceMcpServerCredential({
      database: context.db,
      workspaceMcpServerId: source.id,
      userId: context.user.id,
      secret: input.secret,
      displayName: input.displayName,
      expiresAt: normalizeCredentialExpiresAt(input.expiresAt),
      enabled: input.enabled,
    });

    return { success: true };
  });

const adminSetCredential = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      workspaceMcpServerId: z.string(),
      secret: z.string().min(1),
      displayName: z.string().max(120).nullish(),
      expiresAt: z.string().max(40).nullish(),
      enabled: z.boolean().default(true),
    }),
  )
  .handler(async ({ input, context }) => {
    const source = await getAdminSource(context, input.workspaceId, input.workspaceMcpServerId);
    assertManualCredentialSource(source);

    if (source.authType === "oauth2") {
      throw new ORPCError("BAD_REQUEST", {
        message: "OAuth Workspace MCP Servers must be connected through the OAuth flow.",
      });
    }

    await setWorkspaceMcpServerCredential({
      database: context.db,
      workspaceMcpServerId: source.id,
      userId: context.user.id,
      secret: input.secret,
      displayName: input.displayName,
      expiresAt: normalizeCredentialExpiresAt(input.expiresAt),
      enabled: input.enabled,
    });

    return { success: true };
  });

const disconnectCredential = protectedProcedure
  .input(z.object({ workspaceMcpServerId: z.string() }))
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAccess(context.user.id);
    const source = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.id, input.workspaceMcpServerId),
        eq(workspaceMcpServer.workspaceId, access.workspace.id),
      ),
    });

    if (!source) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Server not found.",
      });
    }
    assertManualCredentialSource(source);

    await context.db
      .delete(workspaceMcpAuthorization)
      .where(
        and(
          eq(workspaceMcpAuthorization.workspaceMcpServerId, source.id),
          eq(workspaceMcpAuthorization.userId, context.user.id),
        ),
      );

    return { success: true };
  });

const adminDisconnectCredential = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      workspaceMcpServerId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    const source = await getAdminSource(context, input.workspaceId, input.workspaceMcpServerId);
    assertManualCredentialSource(source);

    await context.db
      .delete(workspaceMcpAuthorization)
      .where(
        and(
          eq(workspaceMcpAuthorization.workspaceMcpServerId, source.id),
          eq(workspaceMcpAuthorization.userId, context.user.id),
        ),
      );

    return { success: true };
  });

const toggleCredential = protectedProcedure
  .input(
    z.object({
      workspaceMcpServerId: z.string(),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAccess(context.user.id);
    const source = await context.db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.id, input.workspaceMcpServerId),
        eq(workspaceMcpServer.workspaceId, access.workspace.id),
      ),
    });

    if (!source) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Server not found.",
      });
    }
    assertManualCredentialSource(source);

    const updated = await context.db
      .update(workspaceMcpAuthorization)
      .set({
        enabled: input.enabled,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspaceMcpAuthorization.workspaceMcpServerId, source.id),
          eq(workspaceMcpAuthorization.userId, context.user.id),
        ),
      )
      .returning({ id: workspaceMcpAuthorization.id });

    if (updated.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Authorization not found.",
      });
    }

    return { success: true };
  });

const adminToggleCredential = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      workspaceMcpServerId: z.string(),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const source = await getAdminSource(context, input.workspaceId, input.workspaceMcpServerId);
    assertManualCredentialSource(source);

    const updated = await context.db
      .update(workspaceMcpAuthorization)
      .set({
        enabled: input.enabled,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspaceMcpAuthorization.workspaceMcpServerId, source.id),
          eq(workspaceMcpAuthorization.userId, context.user.id),
        ),
      )
      .returning({ id: workspaceMcpAuthorization.id });

    if (updated.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Workspace MCP Authorization not found.",
      });
    }

    return { success: true };
  });

export const workspaceMcpServerRouter = {
  list,
  adminList,
  startOAuth,
  create,
  adminCreate,
  update,
  adminUpdate,
  delete: remove,
  adminDelete,
  setCredential,
  adminSetCredential,
  disconnectCredential,
  adminDisconnectCredential,
  toggleCredential,
  adminToggleCredential,
};
