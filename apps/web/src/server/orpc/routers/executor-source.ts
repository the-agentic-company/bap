import {
  resolveMcpEndpoint,
  startMcpOAuthAuthorization,
} from "@cmdclaw/core/server/executor/mcp-oauth";
import {
  computeWorkspaceExecutorSourceRevisionHash,
  ensureWorkspaceExecutorPackage,
  listWorkspaceExecutorSources,
  normalizeExecutorNamespace,
  setWorkspaceExecutorSourceCredential,
} from "@cmdclaw/core/server/executor/workspace-sources";
import {
  user,
  workspace,
  workspaceExecutorSource,
  workspaceExecutorSourceCredential,
} from "@cmdclaw/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { storeExecutorSourceOAuthPending } from "@/server/executor-source-oauth";
import type { AuthenticatedContext } from "../middleware";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess, requireActiveWorkspaceAdmin } from "../workspace-access";

const stringMapSchema = z.record(z.string(), z.string()).default({});
const executorSourceKindSchema = z.enum(["mcp", "openapi"]);
const executorSourceAuthTypeSchema = z.enum(["none", "api_key", "bearer", "oauth2"]);
const workspaceIdSchema = z.object({ workspaceId: z.string() });

function generateState(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function getAppUrl(): string {
  return process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
}

const executorSourceBaseSchema = z.object({
  kind: executorSourceKindSchema,
  name: z.string().min(1).max(120),
  namespace: z.string().min(1).max(120),
  endpoint: z.string().url(),
  specUrl: z.string().url().nullish(),
  transport: z.string().max(120).nullish(),
  headers: stringMapSchema.optional(),
  queryParams: stringMapSchema.optional(),
  defaultHeaders: stringMapSchema.optional(),
  authType: executorSourceAuthTypeSchema.default("none"),
  authHeaderName: z.string().max(120).nullish(),
  authQueryParam: z.string().max(120).nullish(),
  authPrefix: z.string().max(120).nullish(),
  enabled: z.boolean().default(true),
});

function validateExecutorSourceInput(
  value: z.infer<typeof executorSourceBaseSchema>,
  ctx: z.RefinementCtx,
) {
  if (value.kind === "openapi" && !value.specUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["specUrl"],
      message: "specUrl is required for OpenAPI sources.",
    });
  }

  if (value.kind === "openapi" && value.authQueryParam?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["authQueryParam"],
      message: "OpenAPI sources currently support header-based auth only.",
    });
  }

  if (value.kind === "openapi" && value.authType === "oauth2") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["authType"],
      message: "OpenAPI sources do not support OAuth 2.0 executor auth.",
    });
  }
}

export const executorSourceInputSchema = executorSourceBaseSchema.superRefine(
  validateExecutorSourceInput,
);

const adminExecutorSourceBaseSchema = workspaceIdSchema.extend(executorSourceBaseSchema.shape);

const adminExecutorSourceInputSchema = adminExecutorSourceBaseSchema.superRefine(
  validateExecutorSourceInput,
);

const executorSourceUpdateInputSchema = executorSourceBaseSchema
  .extend({ id: z.string() })
  .superRefine(validateExecutorSourceInput);

const adminExecutorSourceUpdateInputSchema = adminExecutorSourceBaseSchema
  .extend({ id: z.string() })
  .superRefine(validateExecutorSourceInput);

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
  kind: z.infer<typeof executorSourceKindSchema>;
  authType: z.infer<typeof executorSourceAuthTypeSchema>;
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
  sourceId: string,
) {
  await getAdminWorkspace(context, workspaceId);

  const source = await context.db.query.workspaceExecutorSource.findFirst({
    where: and(
      eq(workspaceExecutorSource.id, sourceId),
      eq(workspaceExecutorSource.workspaceId, workspaceId),
    ),
  });

  if (!source) {
    throw new ORPCError("NOT_FOUND", { message: "Executor source not found." });
  }

  return source;
}

function assertMutableExecutorSource(
  source: Pick<typeof workspaceExecutorSource.$inferSelect, "internalKey">,
) {
  if (source.internalKey) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Managed executor sources cannot be edited or deleted manually.",
    });
  }
}

function assertManualCredentialSource(
  source: Pick<typeof workspaceExecutorSource.$inferSelect, "internalKey">,
) {
  if (source.internalKey) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Managed executor sources use the integration connection flow, not manual credentials.",
    });
  }
}

const list = protectedProcedure.handler(async ({ context }) => {
  const access = await requireActiveWorkspaceAccess(context.user.id);
  const sources = await listWorkspaceExecutorSources({
    database: context.db,
    workspaceId: access.workspace.id,
    userId: context.user.id,
  });
  const packageRow = await ensureWorkspaceExecutorPackage({
    database: context.db,
    workspaceId: access.workspace.id,
    workspaceName: access.workspace.name,
  });

  return {
    workspaceId: access.workspace.id,
    membershipRole: access.membership.role,
    packageRevisionHash: packageRow.revisionHash,
    sources,
  };
});

const adminList = protectedProcedure
  .input(workspaceIdSchema)
  .handler(async ({ input, context }) => {
    const selectedWorkspace = await getAdminWorkspace(context, input.workspaceId);
    const sources = await listWorkspaceExecutorSources({
      database: context.db,
      workspaceId: selectedWorkspace.id,
      userId: context.user.id,
    });
    const packageRow = await ensureWorkspaceExecutorPackage({
      database: context.db,
      workspaceId: selectedWorkspace.id,
      workspaceName: selectedWorkspace.name,
    });

    return {
      workspaceId: selectedWorkspace.id,
      membershipRole: "admin" as const,
      packageRevisionHash: packageRow.revisionHash,
      sources,
    };
  });

const startOAuth = protectedProcedure
  .input(
    z.object({
      workspaceExecutorSourceId: z.string(),
      redirectUrl: z.string().url(),
    }),
  )
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAccess(context.user.id);
    const source = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.id, input.workspaceExecutorSourceId),
        eq(workspaceExecutorSource.workspaceId, access.workspace.id),
      ),
    });

    if (!source) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source not found.",
      });
    }

    if (source.kind !== "mcp" || source.authType !== "oauth2") {
      throw new ORPCError("BAD_REQUEST", {
        message: "This source is not configured for MCP OAuth.",
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

    await storeExecutorSourceOAuthPending({
      state,
      userId: context.user.id,
      sourceId: source.id,
      redirectUrl: input.redirectUrl,
      session,
    });

    return { authUrl: authorizationUrl };
  });

const create = protectedProcedure
  .input(executorSourceInputSchema)
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAdmin(context.user.id);
    const namespace = normalizeExecutorNamespace(input.namespace);
    const existing = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.workspaceId, access.workspace.id),
        eq(workspaceExecutorSource.namespace, namespace),
      ),
    });

    if (existing) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Source namespace "${namespace}" already exists in this workspace.`,
      });
    }

    const revisionHash = computeWorkspaceExecutorSourceRevisionHash({
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
      .insert(workspaceExecutorSource)
      .values({
        workspaceId: access.workspace.id,
        kind: input.kind,
        name: input.name.trim(),
        namespace,
        endpoint: input.endpoint.trim(),
        specUrl: input.kind === "openapi" ? (input.specUrl?.trim() ?? null) : null,
        transport: input.kind === "mcp" ? (input.transport?.trim() ?? null) : null,
        headers: input.kind === "mcp" ? normalizeStringMap(input.headers) : null,
        queryParams: input.kind === "mcp" ? normalizeStringMap(input.queryParams) : null,
        defaultHeaders: input.kind === "openapi" ? normalizeStringMap(input.defaultHeaders) : null,
        authType: input.authType,
        ...normalizeAuthSettings(input),
        enabled: input.enabled,
        revisionHash,
        createdByUserId: context.user.id,
        updatedByUserId: context.user.id,
      })
      .returning();

    await ensureWorkspaceExecutorPackage({
      database: context.db,
      workspaceId: access.workspace.id,
      workspaceName: access.workspace.name,
    });

    return { id: created.id };
  });

const adminCreate = protectedProcedure
  .input(adminExecutorSourceInputSchema)
  .handler(async ({ input, context }) => {
    const selectedWorkspace = await getAdminWorkspace(context, input.workspaceId);
    const namespace = normalizeExecutorNamespace(input.namespace);
    const existing = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.workspaceId, selectedWorkspace.id),
        eq(workspaceExecutorSource.namespace, namespace),
      ),
    });

    if (existing) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Source namespace "${namespace}" already exists in this workspace.`,
      });
    }

    const revisionHash = computeWorkspaceExecutorSourceRevisionHash({
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
      .insert(workspaceExecutorSource)
      .values({
        workspaceId: selectedWorkspace.id,
        kind: input.kind,
        name: input.name.trim(),
        namespace,
        endpoint: input.endpoint.trim(),
        specUrl: input.kind === "openapi" ? (input.specUrl?.trim() ?? null) : null,
        transport: input.kind === "mcp" ? (input.transport?.trim() ?? null) : null,
        headers: input.kind === "mcp" ? normalizeStringMap(input.headers) : null,
        queryParams: input.kind === "mcp" ? normalizeStringMap(input.queryParams) : null,
        defaultHeaders: input.kind === "openapi" ? normalizeStringMap(input.defaultHeaders) : null,
        authType: input.authType,
        ...normalizeAuthSettings(input),
        enabled: input.enabled,
        revisionHash,
        createdByUserId: context.user.id,
        updatedByUserId: context.user.id,
      })
      .returning();

    await ensureWorkspaceExecutorPackage({
      database: context.db,
      workspaceId: selectedWorkspace.id,
      workspaceName: selectedWorkspace.name,
    });

    return { id: created.id };
  });

const update = protectedProcedure
  .input(executorSourceUpdateInputSchema)
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAdmin(context.user.id);
    const current = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.id, input.id),
        eq(workspaceExecutorSource.workspaceId, access.workspace.id),
      ),
    });

    if (!current) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source not found.",
      });
    }
    assertMutableExecutorSource(current);

    const namespace = normalizeExecutorNamespace(input.namespace);
    const duplicate = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.workspaceId, access.workspace.id),
        eq(workspaceExecutorSource.namespace, namespace),
      ),
    });

    if (duplicate && duplicate.id !== input.id) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Source namespace "${namespace}" already exists in this workspace.`,
      });
    }

    const revisionHash = computeWorkspaceExecutorSourceRevisionHash({
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
      .update(workspaceExecutorSource)
      .set({
        kind: input.kind,
        name: input.name.trim(),
        namespace,
        endpoint: input.endpoint.trim(),
        specUrl: input.kind === "openapi" ? (input.specUrl?.trim() ?? null) : null,
        transport: input.kind === "mcp" ? (input.transport?.trim() ?? null) : null,
        headers: input.kind === "mcp" ? normalizeStringMap(input.headers) : null,
        queryParams: input.kind === "mcp" ? normalizeStringMap(input.queryParams) : null,
        defaultHeaders: input.kind === "openapi" ? normalizeStringMap(input.defaultHeaders) : null,
        authType: input.authType,
        ...normalizeAuthSettings(input),
        enabled: input.enabled,
        revisionHash,
        updatedByUserId: context.user.id,
      })
      .where(eq(workspaceExecutorSource.id, input.id));

    await ensureWorkspaceExecutorPackage({
      database: context.db,
      workspaceId: access.workspace.id,
      workspaceName: access.workspace.name,
    });

    return { success: true };
  });

const adminUpdate = protectedProcedure
  .input(adminExecutorSourceUpdateInputSchema)
  .handler(async ({ input, context }) => {
    const selectedWorkspace = await getAdminWorkspace(context, input.workspaceId);
    const current = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.id, input.id),
        eq(workspaceExecutorSource.workspaceId, selectedWorkspace.id),
      ),
    });

    if (!current) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source not found.",
      });
    }
    assertMutableExecutorSource(current);

    const namespace = normalizeExecutorNamespace(input.namespace);
    const duplicate = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.workspaceId, selectedWorkspace.id),
        eq(workspaceExecutorSource.namespace, namespace),
      ),
    });

    if (duplicate && duplicate.id !== input.id) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Source namespace "${namespace}" already exists in this workspace.`,
      });
    }

    const revisionHash = computeWorkspaceExecutorSourceRevisionHash({
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
      .update(workspaceExecutorSource)
      .set({
        kind: input.kind,
        name: input.name.trim(),
        namespace,
        endpoint: input.endpoint.trim(),
        specUrl: input.kind === "openapi" ? (input.specUrl?.trim() ?? null) : null,
        transport: input.kind === "mcp" ? (input.transport?.trim() ?? null) : null,
        headers: input.kind === "mcp" ? normalizeStringMap(input.headers) : null,
        queryParams: input.kind === "mcp" ? normalizeStringMap(input.queryParams) : null,
        defaultHeaders: input.kind === "openapi" ? normalizeStringMap(input.defaultHeaders) : null,
        authType: input.authType,
        ...normalizeAuthSettings(input),
        enabled: input.enabled,
        revisionHash,
        updatedByUserId: context.user.id,
      })
      .where(eq(workspaceExecutorSource.id, input.id));

    await ensureWorkspaceExecutorPackage({
      database: context.db,
      workspaceId: selectedWorkspace.id,
      workspaceName: selectedWorkspace.name,
    });

    return { success: true };
  });

const remove = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAdmin(context.user.id);
    const current = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.id, input.id),
        eq(workspaceExecutorSource.workspaceId, access.workspace.id),
      ),
    });
    if (!current) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source not found.",
      });
    }
    assertMutableExecutorSource(current);
    const deleted = await context.db
      .delete(workspaceExecutorSource)
      .where(
        and(
          eq(workspaceExecutorSource.id, input.id),
          eq(workspaceExecutorSource.workspaceId, access.workspace.id),
        ),
      )
      .returning({ id: workspaceExecutorSource.id });

    if (deleted.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source not found.",
      });
    }

    await ensureWorkspaceExecutorPackage({
      database: context.db,
      workspaceId: access.workspace.id,
      workspaceName: access.workspace.name,
    });

    return { success: true };
  });

const adminDelete = protectedProcedure
  .input(z.object({ workspaceId: z.string(), id: z.string() }))
  .handler(async ({ input, context }) => {
    const selectedWorkspace = await getAdminWorkspace(context, input.workspaceId);
    const current = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.id, input.id),
        eq(workspaceExecutorSource.workspaceId, selectedWorkspace.id),
      ),
    });
    if (!current) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source not found.",
      });
    }
    assertMutableExecutorSource(current);
    const deleted = await context.db
      .delete(workspaceExecutorSource)
      .where(
        and(
          eq(workspaceExecutorSource.id, input.id),
          eq(workspaceExecutorSource.workspaceId, selectedWorkspace.id),
        ),
      )
      .returning({ id: workspaceExecutorSource.id });

    if (deleted.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source not found.",
      });
    }

    await ensureWorkspaceExecutorPackage({
      database: context.db,
      workspaceId: selectedWorkspace.id,
      workspaceName: selectedWorkspace.name,
    });

    return { success: true };
  });

const setCredential = protectedProcedure
  .input(
    z.object({
      workspaceExecutorSourceId: z.string(),
      secret: z.string().min(1),
      displayName: z.string().max(120).nullish(),
      enabled: z.boolean().default(true),
    }),
  )
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAccess(context.user.id);
    const source = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.id, input.workspaceExecutorSourceId),
        eq(workspaceExecutorSource.workspaceId, access.workspace.id),
      ),
    });

    if (!source) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source not found.",
      });
    }
    assertManualCredentialSource(source);

    if (source.authType === "oauth2") {
      throw new ORPCError("BAD_REQUEST", {
        message: "OAuth sources must be connected through the OAuth flow.",
      });
    }

    await setWorkspaceExecutorSourceCredential({
      database: context.db,
      workspaceExecutorSourceId: source.id,
      userId: context.user.id,
      secret: input.secret,
      displayName: input.displayName,
      enabled: input.enabled,
    });

    return { success: true };
  });

const adminSetCredential = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      workspaceExecutorSourceId: z.string(),
      secret: z.string().min(1),
      displayName: z.string().max(120).nullish(),
      enabled: z.boolean().default(true),
    }),
  )
  .handler(async ({ input, context }) => {
    const source = await getAdminSource(
      context,
      input.workspaceId,
      input.workspaceExecutorSourceId,
    );
    assertManualCredentialSource(source);

    if (source.authType === "oauth2") {
      throw new ORPCError("BAD_REQUEST", {
        message: "OAuth sources must be connected through the OAuth flow.",
      });
    }

    await setWorkspaceExecutorSourceCredential({
      database: context.db,
      workspaceExecutorSourceId: source.id,
      userId: context.user.id,
      secret: input.secret,
      displayName: input.displayName,
      enabled: input.enabled,
    });

    return { success: true };
  });

const disconnectCredential = protectedProcedure
  .input(z.object({ workspaceExecutorSourceId: z.string() }))
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAccess(context.user.id);
    const source = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.id, input.workspaceExecutorSourceId),
        eq(workspaceExecutorSource.workspaceId, access.workspace.id),
      ),
    });

    if (!source) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source not found.",
      });
    }
    assertManualCredentialSource(source);

    await context.db
      .delete(workspaceExecutorSourceCredential)
      .where(
        and(
          eq(workspaceExecutorSourceCredential.workspaceExecutorSourceId, source.id),
          eq(workspaceExecutorSourceCredential.userId, context.user.id),
        ),
      );

    return { success: true };
  });

const adminDisconnectCredential = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      workspaceExecutorSourceId: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    const source = await getAdminSource(
      context,
      input.workspaceId,
      input.workspaceExecutorSourceId,
    );
    assertManualCredentialSource(source);

    await context.db
      .delete(workspaceExecutorSourceCredential)
      .where(
        and(
          eq(workspaceExecutorSourceCredential.workspaceExecutorSourceId, source.id),
          eq(workspaceExecutorSourceCredential.userId, context.user.id),
        ),
      );

    return { success: true };
  });

const toggleCredential = protectedProcedure
  .input(
    z.object({
      workspaceExecutorSourceId: z.string(),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const access = await requireActiveWorkspaceAccess(context.user.id);
    const source = await context.db.query.workspaceExecutorSource.findFirst({
      where: and(
        eq(workspaceExecutorSource.id, input.workspaceExecutorSourceId),
        eq(workspaceExecutorSource.workspaceId, access.workspace.id),
      ),
    });

    if (!source) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source not found.",
      });
    }
    assertManualCredentialSource(source);

    const updated = await context.db
      .update(workspaceExecutorSourceCredential)
      .set({
        enabled: input.enabled,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspaceExecutorSourceCredential.workspaceExecutorSourceId, source.id),
          eq(workspaceExecutorSourceCredential.userId, context.user.id),
        ),
      )
      .returning({ id: workspaceExecutorSourceCredential.id });

    if (updated.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source credential not found.",
      });
    }

    return { success: true };
  });

const adminToggleCredential = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string(),
      workspaceExecutorSourceId: z.string(),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ input, context }) => {
    const source = await getAdminSource(
      context,
      input.workspaceId,
      input.workspaceExecutorSourceId,
    );
    assertManualCredentialSource(source);

    const updated = await context.db
      .update(workspaceExecutorSourceCredential)
      .set({
        enabled: input.enabled,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspaceExecutorSourceCredential.workspaceExecutorSourceId, source.id),
          eq(workspaceExecutorSourceCredential.userId, context.user.id),
        ),
      )
      .returning({ id: workspaceExecutorSourceCredential.id });

    if (updated.length === 0) {
      throw new ORPCError("NOT_FOUND", {
        message: "Executor source credential not found.",
      });
    }

    return { success: true };
  });

export const executorSourceRouter = {
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
