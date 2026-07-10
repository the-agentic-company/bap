import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Client as PgClient } from "pg";

import { formatWorktreeStackSlot } from "./stack";
import {
  agentBrowserSessionName,
  agentBrowserStatePath,
  authArtifactsDir,
  buildAppUrl,
  buildDatabaseUrlForMetadata,
  buildHealthCheckUrl,
  buildInstanceId,
  buildMinioAccessKeyId,
  buildMinioBucketName,
  buildQueueName,
  buildRedisNamespace,
  buildRedisUser,
  buildDatabaseUser,
  buildDatabaseName,
  Client,
  DEV_START_TIMEOUT_MS,
  ensureDir,
  fail,
  generateCredentialSecret,
  isDatabaseConnectionError,
  logsDir,
  redactConnectionString,
  resolveCliProfilePath,
  resolveRepoRoot,
  resolveSharedWorktreeInstancesPath,
  resolveSharedWorktreeRootPath,
  runtimeDir,
  resolveWorktreeEnvFile,
  saveCliProfile,
  serializeSignedCookie,
  type InstanceMetadata,
  type ProcessName,
  type SessionProfileRecord,
  type SourceUserRecord,
} from "./cli-runtime";
import { resolveSharedWorktreeInstanceRoot } from "./coordination";
import {
  buildDerivedEnv,
  buildPostgresAdminUrl,
  buildWorktreeRuntimeEnv,
  ensureDatabase,
  ensureDatabaseExtensions,
  ensureDatabaseRole,
  ensureMinioTenant,
  ensureRedisAclUser,
  ensureZeroDatabaseMetadataAccess,
  withClient,
} from "./cli-resources";
import {
  buildJsonStorageState,
  ensureZeroCacheConfigured,
  resolveSourceDatabaseUrl,
  selectRows,
  upsertRows,
  writeDerivedEnvFile,
} from "./cli-docker";
import {
  buildAppPorts,
  hydrateMetadataCredentials,
  loadMetadata,
  migrateLegacyInstanceRoot,
  removeSlotLease,
  reserveStackSlot,
  saveMetadata,
} from "./cli-state";

const DEFAULT_WORKTREE_DEV_USER_EMAIL = "baptiste@theagenticcompany.ai";
const DEFAULT_WORKTREE_DEV_USER_NAME = "Baptiste";

export function resolveWorktreeDevUserEmail(): string {
  return (
    process.env.BAP_WORKTREE_DEV_USER_EMAIL?.trim() ||
    process.env.APP_DEFAULT_USER_EMAIL?.trim() ||
    DEFAULT_WORKTREE_DEV_USER_EMAIL
  );
}

export async function resolveLatestLocalSessionProfile(
  metadata: InstanceMetadata,
): Promise<SessionProfileRecord | null> {
  return withClient(buildDatabaseUrlForMetadata(metadata), async (client) => {
    const result = await client.query<{
      token: string;
      email: string;
      expires_at: Date;
    }>(
      `
        select s.token, u.email, s.expires_at
        from "session" s
        join "user" u on u.id = s.user_id
        where s.expires_at > now()
        order by s.updated_at desc nulls last, s.created_at desc
        limit 1
      `,
    );

    const row = result.rows[0];
    if (!row?.token || !row.email || !(row.expires_at instanceof Date)) {
      return null;
    }

    return {
      token: row.token,
      email: row.email,
      expiresAt: row.expires_at,
    };
  });
}

export async function syncCliProfileFromLocalSession(metadata: InstanceMetadata): Promise<boolean> {
  const sessionProfile = await resolveLatestLocalSessionProfile(metadata);
  if (!sessionProfile) {
    return false;
  }

  saveCliProfile(metadata.appUrl, sessionProfile.token);
  console.log(`[worktree] cli profile ${resolveCliProfilePath(metadata.appUrl)}`);
  console.log(`[worktree] cli auth user ${sessionProfile.email}`);
  console.log(`[worktree] cli auth expires ${sessionProfile.expiresAt.toISOString()}`);
  return true;
}

export async function resolveBootstrapSourceUser(
  sourceClient: PgClient,
): Promise<SourceUserRecord | null> {
  const explicitEmail = resolveWorktreeDevUserEmail();
  if (explicitEmail) {
    const result = await sourceClient.query<SourceUserRecord>(
      `select id, email from "user" where lower(email) = lower($1) limit 1`,
      [explicitEmail],
    );
    return result.rows[0] ?? null;
  }

  const recentSession = await sourceClient.query<SourceUserRecord>(
    `
      select u.id, u.email
      from "session" s
      join "user" u on u.id = s.user_id
      order by s.updated_at desc nulls last, s.created_at desc
      limit 1
    `,
  );
  if (recentSession.rows[0]) {
    return recentSession.rows[0];
  }

  const users = await sourceClient.query<SourceUserRecord>(
    `select id, email from "user" order by updated_at desc, created_at desc`,
  );
  if (users.rows.length === 1) {
    return users.rows[0] ?? null;
  }

  return null;
}

async function tableExists(client: PgClient, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      select exists (
        select 1
        from information_schema.tables
        where table_schema = current_schema()
          and table_name = $1
      )
    `,
    [tableName],
  );
  return result.rows[0]?.exists ?? false;
}

async function resolveSourceWorkspaceTables(client: PgClient): Promise<{
  workspaceTable: "organization" | "workspace";
  memberTable: "member" | "workspace_member";
}> {
  if ((await tableExists(client, "organization")) && (await tableExists(client, "member"))) {
    return { workspaceTable: "organization", memberTable: "member" };
  }

  return { workspaceTable: "workspace", memberTable: "workspace_member" };
}

async function writeWorktreeSessionArtifacts(params: {
  metadata: InstanceMetadata;
  email: string;
  userId: string;
  sessionToken: string;
  expiresAt: Date;
}): Promise<void> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    fail("BETTER_AUTH_SECRET is required to generate a developer session cookie.");
  }

  const signedCookie = (await serializeSignedCookie("", params.sessionToken, secret)).replace(
    "=",
    "",
  );

  ensureDir(authArtifactsDir(params.metadata.instanceRoot));
  const storageStatePath = agentBrowserStatePath(params.metadata.instanceRoot);
  const sessionInfoPath = join(authArtifactsDir(params.metadata.instanceRoot), "dev-user.session.json");

  writeFileSync(
    storageStatePath,
    buildJsonStorageState({
      appUrl: params.metadata.appUrl,
      signedSessionToken: signedCookie,
      expiresAtEpochSeconds: Math.floor(params.expiresAt.getTime() / 1000),
    }),
    "utf8",
  );
  writeFileSync(
    sessionInfoPath,
    `${JSON.stringify(
      {
        appUrl: params.metadata.appUrl,
        email: params.email,
        userId: params.userId,
        cookieHeader: `better-auth.session_token=${signedCookie}`,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`[worktree] auth storage ${storageStatePath}`);
  loadAgentBrowserAuthState(params.metadata);
}

export async function ensureStandaloneDeveloperSession(metadata: InstanceMetadata): Promise<void> {
  const targetDatabaseUrl = buildDatabaseUrlForMetadata(metadata);
  const email = resolveWorktreeDevUserEmail();
  const now = new Date();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const sessionToken = randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await withClient(targetDatabaseUrl, async (client) => {
    await client.query("begin");
    try {
      const existingUser = await client.query<{ id: string }>(
        `select id from "user" where lower(email) = lower($1) limit 1`,
        [email],
      );
      const effectiveUserId = existingUser.rows[0]?.id ?? userId;

      if (!existingUser.rows[0]) {
        await client.query(
          `
            insert into "user" (
              id, name, email, email_verified, role,
              created_at, updated_at, onboarded_at
            )
            values ($1, $2, $3, true, 'admin', $4, $4, $4)
          `,
          [effectiveUserId, DEFAULT_WORKTREE_DEV_USER_NAME, email, now],
        );
      }

      const existingWorkspace = await client.query<{ id: string }>(
        `
          select w.id
          from member wm
          join organization w on w.id = wm.organization_id
          where wm.user_id = $1
          order by w.updated_at desc nulls last, w.created_at desc
          limit 1
        `,
        [effectiveUserId],
      );
      const effectiveWorkspaceId = existingWorkspace.rows[0]?.id ?? workspaceId;

      if (!existingWorkspace.rows[0]) {
        await client.query(
          `
            insert into organization (id, name, slug, billing_plan_id, autumn_customer_id, created_at, updated_at)
            values ($1, $2, $3, 'free', null, $4, $4)
          `,
          [
            effectiveWorkspaceId,
            `${DEFAULT_WORKTREE_DEV_USER_NAME}'s workspace`,
            `worktree-${metadata.instanceId}`.slice(0, 63),
            now,
          ],
        );
        await client.query(
          `
            insert into member (id, organization_id, user_id, role, created_at)
            values ($1, $2, $3, 'owner', $4)
            on conflict (organization_id, user_id) do nothing
          `,
          [randomUUID(), effectiveWorkspaceId, effectiveUserId, now],
        );
      }

      await client.query(
        `
          update "user"
          set email_verified = true,
              onboarded_at = coalesce(onboarded_at, $2),
              role = 'admin',
              updated_at = $2
          where id = $1
        `,
        [effectiveUserId, now],
      );
      await client.query(
        `
          insert into "session" (
            id, expires_at, token, created_at, updated_at,
            ip_address, user_agent, user_id, impersonated_by, active_organization_id
          )
          values ($1, $2, $3, $4, $4, '127.0.0.1', 'bap-worktree-bootstrap', $5, null, $6)
        `,
        [randomUUID(), expiresAt, sessionToken, now, effectiveUserId, effectiveWorkspaceId],
      );
      await client.query("commit");

      await writeWorktreeSessionArtifacts({
        metadata,
        email,
        userId: effectiveUserId,
        sessionToken,
        expiresAt,
      });
      console.log(`[worktree] bootstrapped developer user ${email}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

export function remapWorkspaceRows(
  rows: Array<Record<string, unknown>>,
  targetUserId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    created_by_user_id: targetUserId,
  }));
}

export function remapWorkspaceMemberRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    if (!("workspace_id" in row)) {
      return row;
    }

    const { workspace_id, ...rest } = row;
    return {
      ...rest,
      organization_id: workspace_id,
    };
  });
}

export function remapCustomIntegrationRows(
  rows: Array<Record<string, unknown>>,
  targetUserId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    created_by_user_id: targetUserId,
  }));
}

export function remapWorkspaceMcpServerRows(
  rows: Array<Record<string, unknown>>,
  targetUserId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    created_by_user_id: targetUserId,
    updated_by_user_id: targetUserId,
  }));
}

export function remapCoworkerRows(
  rows: Array<Record<string, unknown>>,
  targetUserId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    owner_id: targetUserId,
    builder_conversation_id: null,
  }));
}

export function remapSharedProviderAuthRows(
  rows: Array<Record<string, unknown>>,
  targetUserId: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row,
    managed_by_user_id:
      row.managed_by_user_id == null || row.managed_by_user_id === targetUserId
        ? row.managed_by_user_id
        : targetUserId,
  }));
}

export function loadAgentBrowserAuthState(metadata: InstanceMetadata): void {
  const statePath = agentBrowserStatePath(metadata.instanceRoot);
  if (!existsSync(statePath)) {
    return;
  }

  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    cookies?: Array<{
      name: string;
      value: string;
      expires?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "Lax" | "Strict" | "None";
    }>;
  };
  const cookies = Array.isArray(state.cookies) ? state.cookies : [];
  if (cookies.length === 0) {
    return;
  }

  const env = buildDerivedEnv(metadata);
  for (const cookie of cookies) {
    const args = ["cookies", "set", cookie.name, cookie.value, "--url", metadata.appUrl];

    if (cookie.httpOnly) {
      args.push("--httpOnly");
    }
    if (cookie.secure) {
      args.push("--secure");
    }
    if (cookie.sameSite) {
      args.push("--sameSite", cookie.sameSite);
    }
    if (typeof cookie.expires === "number") {
      args.push("--expires", String(cookie.expires));
    }

    const result = spawnSync("agent-browser", args, {
      cwd: metadata.repoRoot,
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.status !== 0) {
      const output = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
      console.warn(`[worktree] failed to hydrate agent-browser cookie ${cookie.name}: ${output}`);
      return;
    }
  }

  console.log(
    `[worktree] hydrated agent-browser session ${agentBrowserSessionName(metadata.instanceId)}`,
  );
}

export function closeAgentBrowserSession(metadata: InstanceMetadata): void {
  const env = buildDerivedEnv(metadata);
  const result = spawnSync("agent-browser", ["close"], {
    cwd: metadata.repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const output = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
    console.warn(`[worktree] failed to close agent-browser session: ${output}`);
  }
}

export function createMetadata(
  repoRoot: string,
  appPort: number,
  wsPort: number,
  zeroCachePort: number,
  stackSlot: number,
): InstanceMetadata {
  const instanceId = buildInstanceId(repoRoot);
  const instanceRoot = resolveSharedWorktreeInstanceRoot(
    resolveSharedWorktreeRootPath(),
    instanceId,
  );
  const databaseName = buildDatabaseName(instanceId);
  const databaseUser = buildDatabaseUser(instanceId);
  const databasePassword = generateCredentialSecret();
  const redisUser = buildRedisUser(instanceId);
  const redisPassword = generateCredentialSecret();
  const minioBucketName = buildMinioBucketName(instanceId);
  const minioAccessKeyId = buildMinioAccessKeyId(instanceId);
  const minioSecretAccessKey = generateCredentialSecret();
  const now = new Date().toISOString();

  return {
    instanceId,
    repoRoot,
    instanceRoot,
    stackSlot,
    appPort,
    wsPort,
    zeroCachePort,
    appUrl: buildAppUrl(appPort),
    databaseName,
    databaseUser,
    databasePassword,
    databaseUrl: buildDatabaseUrlForMetadata({
      databaseName,
      databaseUser,
      databasePassword,
    }),
    redisUser,
    redisPassword,
    queueName: buildQueueName(instanceId),
    redisNamespace: buildRedisNamespace(instanceId),
    minioBucketName,
    minioAccessKeyId,
    minioSecretAccessKey,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateMetadataStackSlot(
  metadata: InstanceMetadata,
  stackSlot: number,
): InstanceMetadata {
  const ports = buildAppPorts(stackSlot);
  const updated = hydrateMetadataCredentials({
    ...metadata,
    stackSlot,
    appPort: ports.appPort,
    wsPort: ports.wsPort,
    zeroCachePort: ports.zeroCachePort,
    appUrl: buildAppUrl(ports.appPort),
    updatedAt: new Date().toISOString(),
  });
  saveMetadata(updated);
  writeDerivedEnvFile(updated);
  return updated;
}

export async function reallocateMetadataStackSlot(
  metadata: InstanceMetadata,
  reason: string,
  excludedSlots?: Set<number>,
): Promise<InstanceMetadata> {
  const reservation = await reserveStackSlot(metadata.repoRoot, metadata, {
    excludedSlots,
    preferredSlot: null,
  });
  const updated = updateMetadataStackSlot(metadata, reservation.slot);
  if (updated.stackSlot !== metadata.stackSlot) {
    console.warn(
      `[worktree] reallocated stack slot ${formatWorktreeStackSlot(metadata.stackSlot)} -> ${formatWorktreeStackSlot(
        updated.stackSlot,
      )} because ${reason}`,
    );
    removeSlotLease(metadata.stackSlot, {
      instanceId: metadata.instanceId,
      repoRoot: metadata.repoRoot,
    });
  }

  return updated;
}

export async function resolveMetadata(): Promise<InstanceMetadata> {
  const repoRoot = resolveRepoRoot();
  const instanceId = buildInstanceId(repoRoot);
  const instanceRoot = migrateLegacyInstanceRoot(repoRoot);
  const existing = loadMetadata(instanceRoot);

  if (existing) {
    const hydratedExisting = hydrateMetadataCredentials(existing);
    const reservation = await reserveStackSlot(repoRoot, hydratedExisting);
    const updated = updateMetadataStackSlot(
      {
        ...hydratedExisting,
        repoRoot,
        instanceRoot,
      },
      reservation.slot,
    );
    if (reservation.previousSlot !== null && reservation.previousSlot !== reservation.slot) {
      console.warn(
        `[worktree] reallocated stack slot ${formatWorktreeStackSlot(reservation.previousSlot)} -> ${formatWorktreeStackSlot(
          reservation.slot,
        )}${reservation.reason ? ` because ${reservation.reason}` : ""}`,
      );
      removeSlotLease(reservation.previousSlot, {
        instanceId,
        repoRoot,
      });
    }
    return updated;
  }

  ensureDir(resolveSharedWorktreeInstancesPath());
  ensureDir(instanceRoot);
  ensureDir(logsDir(instanceRoot));
  ensureDir(runtimeDir(instanceRoot));

  const stackSlot = (await reserveStackSlot(repoRoot, null)).slot;
  const ports = buildAppPorts(stackSlot);
  const metadata = createMetadata(
    repoRoot,
    ports.appPort,
    ports.wsPort,
    ports.zeroCachePort,
    stackSlot,
  );
  saveMetadata(metadata);
  writeDerivedEnvFile(metadata);
  return metadata;
}

export function spawnWithEnv(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  mode: "foreground" | "background",
  name: ProcessName,
  instanceRoot: string,
) {
  const processEnv = {
    ...process.env,
    ...env,
  };

  if (mode === "foreground") {
    return spawn(command, args, {
      cwd,
      env: processEnv,
      stdio: "inherit",
    });
  }

  ensureDir(logsDir(instanceRoot));
  const logPath = join(logsDir(instanceRoot), `${name}.log`);
  const fd = openSync(logPath, "a");

  return spawn(command, args, {
    cwd,
    env: processEnv,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
}

export function buildProcessCommand(
  metadata: InstanceMetadata,
  name: ProcessName,
  options?: { watch?: boolean },
): { command: string; args: string[]; cwd: string } {
  const envFile = resolveWorktreeEnvFile(metadata.repoRoot);

  switch (name) {
    case "web":
      return {
        command: "bun",
        args: [
          "--env-file",
          envFile,
          "vite",
          "dev",
          "--host",
          "0.0.0.0",
          "--port",
          String(metadata.appPort),
        ],
        cwd: join(metadata.repoRoot, "apps/web"),
      };
    case "worker":
      return {
        command: "bun",
        args: [...(options?.watch ? ["--watch"] : []), "--env-file", envFile, "index.ts"],
        cwd: join(metadata.repoRoot, "apps/worker"),
      };
    case "ws":
      return {
        command: "bun",
        args: [...(options?.watch ? ["--watch"] : []), "--env-file", envFile, "index.ts"],
        cwd: join(metadata.repoRoot, "apps/ws"),
      };
  }
}

export async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Poll until ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  fail(`Timed out waiting for ${url}`);
}

export async function waitForDatabaseReady(
  connectionString: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch {
      try {
        await client.end();
      } catch {
        // Ignore shutdown errors while polling for readiness.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  fail(`Timed out waiting for database at ${redactConnectionString(connectionString)}`);
}

export async function runDbPush(metadata: InstanceMetadata): Promise<void> {
  const result = spawnSync("bun", ["run", "--shell", "system", "--cwd", "packages/db", "db:push"], {
    cwd: metadata.repoRoot,
    env: {
      ...process.env,
      ...buildWorktreeRuntimeEnv(metadata),
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    fail(`db:push failed for ${metadata.databaseName}`);
  }
}

export async function bootstrapDeveloperUser(metadata: InstanceMetadata): Promise<void> {
  const sourceDatabaseUrl = resolveSourceDatabaseUrl(metadata.repoRoot);
  const targetDatabaseUrl = buildDatabaseUrlForMetadata(metadata);
  if (!sourceDatabaseUrl || sourceDatabaseUrl === targetDatabaseUrl) {
    await ensureStandaloneDeveloperSession(metadata);
    return;
  }

  try {
    await withClient(sourceDatabaseUrl, async (sourceClient) => {
      const sourceUser = await resolveBootstrapSourceUser(sourceClient);
      if (!sourceUser) {
        await ensureStandaloneDeveloperSession(metadata);
        return;
      }

      await withClient(targetDatabaseUrl, async (targetClient) => {
        const userRows = await selectRows(sourceClient, "user", "id = $1", [sourceUser.id]);
        if (userRows.length === 0) {
          fail(`Source user ${sourceUser.email} was not found in the source database.`);
        }

        const sourceWorkspaceTables = await resolveSourceWorkspaceTables(sourceClient);
        const sourceWorkspaceIdColumn =
          sourceWorkspaceTables.memberTable === "member" ? "organization_id" : "workspace_id";
        const activeWorkspaceSubquery =
          sourceWorkspaceTables.workspaceTable === "organization"
            ? `
                select active_organization_id
                from "session"
                where user_id = $1
                  and active_organization_id is not null
                order by updated_at desc nulls last, created_at desc
                limit 1
              `
            : `select active_workspace_id from "user" where id = $1`;
        const workspaceRows = await sourceClient.query<Record<string, unknown>>(
          `
          select distinct w.*
          from ${sourceWorkspaceTables.memberTable} wm
          join ${sourceWorkspaceTables.workspaceTable} w on w.id = wm.${sourceWorkspaceIdColumn}
          where wm.user_id = $1
             or w.id = (${activeWorkspaceSubquery})
        `,
          [sourceUser.id],
        );
        const workspaceIds = workspaceRows.rows
          .map((row) => row.id)
          .filter((value): value is string => typeof value === "string");

        const workspaceMemberRows =
          workspaceIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `select * from ${sourceWorkspaceTables.memberTable} where user_id = $1 and ${sourceWorkspaceIdColumn} = any($2::text[])`,
                [sourceUser.id, workspaceIds],
              )
            : { rows: [] };

        const accountRows = await selectRows(sourceClient, "account", "user_id = $1", [
          sourceUser.id,
        ]);
        const connectedIdentityRows = await selectRows(
          sourceClient,
          "connected_identity",
          "user_id = $1",
          [sourceUser.id],
        );
        const integrationRows = await selectRows(sourceClient, "integration", "user_id = $1", [
          sourceUser.id,
        ]);
        const integrationIds = integrationRows
          .map((row) => row.id)
          .filter((value): value is string => typeof value === "string");

        const integrationTokenRows =
          integrationIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `select * from integration_token where integration_id = any($1::text[])`,
                [integrationIds],
              )
            : { rows: [] };

        const providerAuthRows = await selectRows(sourceClient, "provider_auth", "user_id = $1", [
          sourceUser.id,
        ]);
        const cloudAccountLinkRows = await selectRows(
          sourceClient,
          "cloud_account_link",
          "user_id = $1",
          [sourceUser.id],
        );
        const customIntegrationCredentialRows = await selectRows(
          sourceClient,
          "custom_integration_credential",
          "user_id = $1",
          [sourceUser.id],
        );
        const customIntegrationIds = customIntegrationCredentialRows
          .map((row) => row.custom_integration_id)
          .filter((value): value is string => typeof value === "string");

        const customIntegrationRows =
          customIntegrationIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `select * from custom_integration where id = any($1::text[])`,
                [customIntegrationIds],
              )
            : { rows: [] };

        const executorSourceCredentialRows = await selectRows(
          sourceClient,
          "workspace_mcp_authorization",
          "user_id = $1",
          [sourceUser.id],
        );
        const executorSourceIds = executorSourceCredentialRows
          .map((row) => row.workspace_mcp_server_id)
          .filter((value): value is string => typeof value === "string");

        const executorSourceRows =
          executorSourceIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `select * from workspace_mcp_server where id = any($1::text[])`,
                [executorSourceIds],
              )
            : { rows: [] };

        const coworkerRows =
          workspaceIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `select * from coworker where owner_id = $1 and workspace_id = any($2::text[])`,
                [sourceUser.id, workspaceIds],
              )
            : { rows: [] };
        const coworkerIds = coworkerRows.rows
          .map((row) => row.id)
          .filter((value): value is string => typeof value === "string");

        const coworkerDocumentRows =
          coworkerIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `select * from coworker_document where coworker_id = any($1::text[])`,
                [coworkerIds],
              )
            : { rows: [] };

        const coworkerEmailAliasRows =
          coworkerIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `select * from coworker_email_alias where coworker_id = any($1::text[])`,
                [coworkerIds],
              )
            : { rows: [] };

        const coworkerTagAssignmentRows =
          coworkerIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `select * from coworker_tag_assignment where coworker_id = any($1::text[])`,
                [coworkerIds],
              )
            : { rows: [] };
        const coworkerTagIds = coworkerTagAssignmentRows.rows
          .map((row) => row.tag_id)
          .filter((value): value is string => typeof value === "string");

        const coworkerTagRows =
          coworkerTagIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `select * from coworker_tag where id = any($1::text[])`,
                [coworkerTagIds],
              )
            : { rows: [] };

        const orgChartNodeRows =
          workspaceIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `
                select *
                from org_chart_node
                where workspace_id = any($1::text[])
                  and (coworker_id is null or coworker_id = any($2::text[]))
              `,
                [workspaceIds, coworkerIds],
              )
            : { rows: [] };

        const coworkerViewRows =
          workspaceIds.length > 0
            ? await sourceClient.query<Record<string, unknown>>(
                `select * from coworker_view where workspace_id = any($1::text[])`,
                [workspaceIds],
              )
            : { rows: [] };

        const sharedProviderAuthRows = (
          await sourceClient.query<Record<string, unknown>>(`select * from shared_provider_auth`)
        ).rows;

        await targetClient.query("begin");
        try {
          await upsertRows(targetClient, "user", userRows, ["id"]);
          await upsertRows(
            targetClient,
            "organization",
            remapWorkspaceRows(workspaceRows.rows, sourceUser.id),
            ["id"],
          );
          await upsertRows(
            targetClient,
            "member",
            remapWorkspaceMemberRows(workspaceMemberRows.rows),
            ["id"],
          );
          await upsertRows(targetClient, "account", accountRows, ["id"]);
          await upsertRows(targetClient, "connected_identity", connectedIdentityRows, ["id"]);
          await upsertRows(targetClient, "integration", integrationRows, ["id"]);
          await upsertRows(targetClient, "integration_token", integrationTokenRows.rows, ["id"]);
          await upsertRows(targetClient, "provider_auth", providerAuthRows, ["id"]);
          await upsertRows(
            targetClient,
            "shared_provider_auth",
            remapSharedProviderAuthRows(sharedProviderAuthRows, sourceUser.id),
            ["id"],
          );
          await upsertRows(targetClient, "cloud_account_link", cloudAccountLinkRows, ["id"]);
          await upsertRows(
            targetClient,
            "custom_integration",
            remapCustomIntegrationRows(customIntegrationRows.rows, sourceUser.id),
            ["id"],
          );
          await upsertRows(
            targetClient,
            "custom_integration_credential",
            customIntegrationCredentialRows,
            ["id"],
          );
          await upsertRows(
            targetClient,
            "workspace_mcp_server",
            remapWorkspaceMcpServerRows(executorSourceRows.rows, sourceUser.id),
            ["id"],
          );
          await upsertRows(
            targetClient,
            "workspace_mcp_authorization",
            executorSourceCredentialRows,
            ["id"],
          );
          await upsertRows(
            targetClient,
            "coworker",
            remapCoworkerRows(coworkerRows.rows, sourceUser.id),
            ["id"],
          );
          await upsertRows(targetClient, "coworker_document", coworkerDocumentRows.rows, ["id"]);
          await upsertRows(targetClient, "coworker_email_alias", coworkerEmailAliasRows.rows, [
            "id",
          ]);
          await upsertRows(targetClient, "coworker_tag", coworkerTagRows.rows, ["id"]);
          await upsertRows(
            targetClient,
            "coworker_tag_assignment",
            coworkerTagAssignmentRows.rows,
            ["id"],
          );
          await upsertRows(targetClient, "org_chart_node", orgChartNodeRows.rows, ["id"]);
          await upsertRows(targetClient, "coworker_view", coworkerViewRows.rows, ["id"]);

          const sessionToken = randomBytes(48).toString("hex");
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await upsertRows(
            targetClient,
            "session",
            [
              {
                id: randomUUID(),
                expires_at: expiresAt,
                token: sessionToken,
                created_at: new Date(),
                updated_at: new Date(),
                ip_address: "127.0.0.1",
                user_agent: "bap-worktree-bootstrap",
                user_id: sourceUser.id,
                impersonated_by: null,
                active_organization_id: workspaceIds[0] ?? null,
              },
            ],
            ["id"],
          );

          await targetClient.query("commit");

          console.log(`[worktree] bootstrapped developer user ${sourceUser.email}`);
          console.log(`[worktree] imported coworkers ${coworkerRows.rows.length}`);
          await writeWorktreeSessionArtifacts({
            metadata,
            email: sourceUser.email,
            userId: sourceUser.id,
            sessionToken,
            expiresAt,
          });
        } catch (error) {
          await targetClient.query("rollback");
          throw error;
        }
      });
    });
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      fail(
        `there was an issue during worktree setup: the source database is unavailable at ${redactConnectionString(sourceDatabaseUrl)}. The main docker stack is likely not up, so developer data could not be copied. Report this state and wait for instructions before continuing.`,
      );
    }
    throw error;
  }
}

export async function createInstance(): Promise<InstanceMetadata> {
  const metadata = await resolveMetadata();
  ensureDir(logsDir(metadata.instanceRoot));
  ensureDir(runtimeDir(metadata.instanceRoot));
  await ensureDatabase(metadata);
  await ensureDatabaseExtensions(metadata);
  await ensureDatabaseRole(metadata);
  await ensureRedisAclUser(metadata);
  await ensureMinioTenant(metadata);
  await ensureZeroDatabaseMetadataAccess(metadata);
  await runDbPush(metadata);
  ensureZeroCacheConfigured(metadata);
  await bootstrapDeveloperUser(metadata);
  if (!(await syncCliProfileFromLocalSession(metadata))) {
    console.warn("[worktree] no local session available to seed CLI auth");
  }
  saveMetadata({ ...metadata, updatedAt: new Date().toISOString() });
  writeDerivedEnvFile(metadata);
  console.log(`[worktree] instance ${metadata.instanceId}`);
  console.log(`[worktree] stack slot ${formatWorktreeStackSlot(metadata.stackSlot)}`);
  console.log(`[worktree] app ${metadata.appUrl}`);
  console.log(`[worktree] db ${metadata.databaseName}`);
  console.log(`[worktree] agent-browser session ${agentBrowserSessionName(metadata.instanceId)}`);
  return metadata;
}
