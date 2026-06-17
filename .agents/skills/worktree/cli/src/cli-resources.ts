import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Client as PgClient } from "pg";

import {
  buildSharedStackConfig,
  buildWorktreeStackConfig,
  formatWorktreeStackSlot,
} from "./stack";
import { buildWorktreePublicCallbackBaseUrl } from "../../../../../packages/core/src/lib/worktree-routing";
import {
  agentBrowserSessionName,
  buildDatabaseUrlForMetadata,
  buildPostgresBaseUrl,
  Client,
  COMMENTED_WORKTREE_ENV_KEYS,
  fail,
  isDatabaseConnectionError,
  quoteIdentifier,
  readSharedEnvValues,
  redactConnectionString,
  resolveRuntimeSharedStackConfig,
  runtimeDir,
  WORKTREE_CLI_COMMAND,
  type DerivedEnv,
  type InstanceMetadata,
} from "./cli-runtime";
import { runSharedServiceCommand } from "./cli-docker";

export function deriveDatabaseUrl(baseDatabaseUrl: string, databaseName: string): string {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export function resolveSharedRedisAdminPassword(): string {
  return process.env.BAP_SHARED_REDIS_ADMIN_PASSWORD?.trim() || "bap-redis-admin";
}

export function resolveSharedMinioRootCredentials(): { accessKeyId: string; secretAccessKey: string } {
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim() || process.env.S3_ACCESS_KEY_ID?.trim() || "minioadmin",
    secretAccessKey:
      process.env.AWS_SECRET_ACCESS_KEY?.trim() ||
      process.env.S3_SECRET_ACCESS_KEY?.trim() ||
      "minioadmin",
  };
}

export function buildPostgresAdminUrl(metadata: InstanceMetadata): string {
  return buildPostgresBaseUrl(resolveRuntimeSharedStackConfig().postgresPort);
}

export async function withAdminClient<T>(
  connectionString: string,
  fn: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      fail(
        `database is unavailable at ${redactConnectionString(connectionString)}. Run '${WORKTREE_CLI_COMMAND} setup' to start the Docker stack and retry.`,
      );
    }
    throw error;
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function withClient<T>(connectionString: string, fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function ensureDatabase(metadata: InstanceMetadata): Promise<void> {
  const adminUrl = buildPostgresAdminUrl(metadata);
  await withAdminClient(adminUrl, async (client) => {
    const existing = await client.query("select 1 from pg_database where datname = $1", [
      metadata.databaseName,
    ]);

    if (existing.rowCount === 0) {
      await client.query(`create database ${quoteIdentifier(metadata.databaseName)}`);
      console.log(`[worktree] created database ${metadata.databaseName}`);
    }
  });
}

export async function ensureDatabaseRole(metadata: InstanceMetadata): Promise<void> {
  const adminUrl = buildPostgresAdminUrl(metadata);
  await withAdminClient(adminUrl, async (client) => {
    const existing = await client.query("select 1 from pg_roles where rolname = $1", [
      metadata.databaseUser,
    ]);

    if (existing.rowCount === 0) {
      await client.query(
        `create role ${quoteIdentifier(metadata.databaseUser)} login password '${metadata.databasePassword.replaceAll("'", "''")}'`,
      );
      console.log(`[worktree] created postgres role ${metadata.databaseUser}`);
    } else {
      await client.query(
        `alter role ${quoteIdentifier(metadata.databaseUser)} with login password '${metadata.databasePassword.replaceAll("'", "''")}'`,
      );
    }

    await client.query(`revoke all on database ${quoteIdentifier(metadata.databaseName)} from public`);
    await client.query(
      `grant all privileges on database ${quoteIdentifier(metadata.databaseName)} to ${quoteIdentifier(metadata.databaseUser)}`,
    );
    await client.query(
      `alter database ${quoteIdentifier(metadata.databaseName)} owner to ${quoteIdentifier(metadata.databaseUser)}`,
    );
  });

  await withAdminClient(
    buildPostgresBaseUrl(resolveRuntimeSharedStackConfig().postgresPort, metadata.databaseName),
    async (client) => {
      await client.query(`revoke all on schema public from public`);
      await client.query(
        `grant all on schema public to ${quoteIdentifier(metadata.databaseUser)}`,
      );
      await client.query(
        `alter schema public owner to ${quoteIdentifier(metadata.databaseUser)}`,
      );
    },
  );
}

export async function ensureDatabaseExtensions(metadata: InstanceMetadata): Promise<void> {
  await withAdminClient(
    buildPostgresBaseUrl(resolveRuntimeSharedStackConfig().postgresPort, metadata.databaseName),
    async (client) => {
      await client.query("create extension if not exists vector");
    },
  );
}

export async function dropDatabase(metadata: InstanceMetadata): Promise<void> {
  const adminUrl = buildPostgresAdminUrl(metadata);
  await withAdminClient(adminUrl, async (client) => {
    await client.query(
      `
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = $1
          and pid <> pg_backend_pid()
      `,
      [metadata.databaseName],
    );
    await client.query(`drop database if exists ${quoteIdentifier(metadata.databaseName)}`);
  });
  console.log(`[worktree] dropped database ${metadata.databaseName}`);
}

export async function dropDatabaseRole(metadata: InstanceMetadata): Promise<void> {
  const adminUrl = buildPostgresAdminUrl(metadata);
  await withAdminClient(adminUrl, async (client) => {
    await client.query(`drop role if exists ${quoteIdentifier(metadata.databaseUser)}`);
  });
  console.log(`[worktree] dropped postgres role ${metadata.databaseUser}`);
}

export function buildMinioPolicyName(instanceId: string): string {
  return `wt-${createHash("sha1").update(`${instanceId}:minio-policy`).digest("hex").slice(0, 16)}`;
}

export async function ensureRedisAclUser(metadata: InstanceMetadata): Promise<void> {
  const bullQueuePattern = `bull:${metadata.queueName}*`;
  runSharedServiceCommand(metadata.repoRoot, "redis", [
    "redis-cli",
    "-a",
    resolveSharedRedisAdminPassword(),
    "ACL",
    "SETUSER",
    metadata.redisUser,
    "reset",
    "on",
    `>${metadata.redisPassword}`,
    `~${metadata.redisNamespace}*`,
    `~${bullQueuePattern}`,
    `&${metadata.redisNamespace}*`,
    `&${bullQueuePattern}`,
    "+@all",
  ]);
  console.log(`[worktree] ensured redis ACL user ${metadata.redisUser}`);
}

export async function dropRedisAclUser(metadata: InstanceMetadata): Promise<void> {
  runSharedServiceCommand(
    metadata.repoRoot,
    "redis",
    ["redis-cli", "-a", resolveSharedRedisAdminPassword(), "ACL", "DELUSER", metadata.redisUser],
    { allowFailure: true },
  );
  console.log(`[worktree] dropped redis ACL user ${metadata.redisUser}`);
}

export async function ensureMinioTenant(metadata: InstanceMetadata): Promise<void> {
  const rootCredentials = resolveSharedMinioRootCredentials();
  const policyName = buildMinioPolicyName(metadata.instanceId);
  const policyDocument = JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:GetBucketLocation", "s3:ListBucket"],
          Resource: [`arn:aws:s3:::${metadata.minioBucketName}`],
        },
        {
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
          Resource: [`arn:aws:s3:::${metadata.minioBucketName}/*`],
        },
      ],
    },
    null,
    2,
  );

  const script = [
    `mc alias set local http://127.0.0.1:9000 ${JSON.stringify(rootCredentials.accessKeyId)} ${JSON.stringify(rootCredentials.secretAccessKey)} >/dev/null`,
    `mc mb --ignore-existing local/${metadata.minioBucketName} >/dev/null`,
    `mc admin user remove local ${metadata.minioAccessKeyId} >/dev/null 2>&1 || true`,
    `mc admin policy remove local ${policyName} >/dev/null 2>&1 || true`,
    `cat <<'EOF' > /tmp/${policyName}.json`,
    policyDocument,
    "EOF",
    `mc admin policy create local ${policyName} /tmp/${policyName}.json >/dev/null`,
    `mc admin user add local ${metadata.minioAccessKeyId} ${JSON.stringify(metadata.minioSecretAccessKey)} >/dev/null`,
    `mc admin policy attach local ${policyName} --user ${metadata.minioAccessKeyId} >/dev/null`,
  ].join("\n");

  runSharedServiceCommand(metadata.repoRoot, "minio", ["sh", "-lc", script]);
  console.log(`[worktree] ensured minio bucket ${metadata.minioBucketName}`);
}

export async function dropMinioTenant(metadata: InstanceMetadata): Promise<void> {
  const rootCredentials = resolveSharedMinioRootCredentials();
  const policyName = buildMinioPolicyName(metadata.instanceId);
  const script = [
    `mc alias set local http://127.0.0.1:9000 ${JSON.stringify(rootCredentials.accessKeyId)} ${JSON.stringify(rootCredentials.secretAccessKey)} >/dev/null`,
    `mc rm --recursive --force local/${metadata.minioBucketName} >/dev/null 2>&1 || true`,
    `mc rb --force local/${metadata.minioBucketName} >/dev/null 2>&1 || true`,
    `mc admin user remove local ${metadata.minioAccessKeyId} >/dev/null 2>&1 || true`,
    `mc admin policy remove local ${policyName} >/dev/null 2>&1 || true`,
  ].join("\n");

  runSharedServiceCommand(metadata.repoRoot, "minio", ["sh", "-lc", script], { allowFailure: true });
  console.log(`[worktree] removed minio bucket ${metadata.minioBucketName}`);
}

export function buildDerivedEnv(metadata: InstanceMetadata): DerivedEnv {
  const instanceRuntimeDir = runtimeDir(metadata.instanceRoot);
  const instanceAppUrl = metadata.appUrl;
  const sharedStack = resolveRuntimeSharedStackConfig();
  const databaseUrl = new URL(buildDatabaseUrlForMetadata(metadata));

  return {
    PORT: String(metadata.appPort),
    WS_PORT: String(metadata.wsPort),
    APP_URL: instanceAppUrl,
    VITE_APP_URL: instanceAppUrl,
    E2B_CALLBACK_BASE_URL: buildWorktreePublicCallbackBaseUrl({
      instanceId: metadata.instanceId,
      callbackBaseUrl: process.env.E2B_CALLBACK_BASE_URL,
      appUrl: process.env.APP_URL,
      viteAppUrl: process.env.VITE_APP_URL,
      nodeEnv: process.env.NODE_ENV,
    }),
    BAP_SERVER_URL: instanceAppUrl,
    PLAYWRIGHT_PORT: String(metadata.appPort),
    PLAYWRIGHT_BASE_URL: instanceAppUrl,
    E2E_AUTH_STATE_PATH: join(instanceRuntimeDir, "playwright", "user.json"),
    DATABASE_URL: databaseUrl.toString(),
    DATABASE_PASSWORD: metadata.databasePassword,
    DB_PASSWORD: metadata.databasePassword,
    REDIS_URL: `redis://${encodeURIComponent(metadata.redisUser)}:${encodeURIComponent(metadata.redisPassword)}@127.0.0.1:${sharedStack.redisPort}/0`,
    AWS_ENDPOINT_URL: `http://127.0.0.1:${sharedStack.minioApiPort}`,
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
    AWS_ACCESS_KEY_ID: metadata.minioAccessKeyId,
    AWS_SECRET_ACCESS_KEY: metadata.minioSecretAccessKey,
    AWS_S3_BUCKET_NAME: metadata.minioBucketName,
    AWS_S3_FORCE_PATH_STYLE: process.env.AWS_S3_FORCE_PATH_STYLE ?? "true",
    BULLMQ_QUEUE_NAME: metadata.queueName,
    BAP_INSTANCE_ID: metadata.instanceId,
    BAP_INSTANCE_ROOT: metadata.instanceRoot,
    BAP_REDIS_NAMESPACE: metadata.redisNamespace,
    BAP_WORKTREE_ID: metadata.instanceId,
    BAP_WORKTREE_SLOT: formatWorktreeStackSlot(metadata.stackSlot),
    BAP_COMPOSE_PROJECT: sharedStack.composeProjectName,
    COMPOSE_PROJECT_NAME: sharedStack.composeProjectName,
    BAP_POSTGRES_PORT: String(sharedStack.postgresPort),
    BAP_REDIS_PORT: String(sharedStack.redisPort),
    BAP_MINIO_API_PORT: String(sharedStack.minioApiPort),
    BAP_MINIO_CONSOLE_PORT: String(sharedStack.minioConsolePort),
    BAP_OTEL_GRPC_PORT: String(sharedStack.vectorOtelGrpcPort),
    BAP_OTEL_HTTP_PORT: String(sharedStack.vectorOtelHttpPort),
    BAP_VECTOR_OTLP_GRPC_PORT: String(sharedStack.vectorOtelGrpcPort),
    BAP_VECTOR_OTLP_HTTP_PORT: String(sharedStack.vectorOtelHttpPort),
    BAP_VECTOR_TRACES_PORT: String(sharedStack.vectorTracePort),
    BAP_VECTOR_LOG_PORT: String(sharedStack.vectorLogPort),
    BAP_VECTOR_LOG_URL: `http://127.0.0.1:${sharedStack.vectorLogPort}/logs`,
    BAP_VECTOR_METRICS_URL: `http://127.0.0.1:${sharedStack.vectorOtelHttpPort}/v1/metrics`,
    BAP_VECTOR_TRACES_URL: `http://127.0.0.1:${sharedStack.vectorTracePort}/v1/traces`,
    BAP_VICTORIA_METRICS_PORT: String(sharedStack.victoriaMetricsPort),
    BAP_VICTORIA_LOGS_PORT: String(sharedStack.victoriaLogsPort),
    BAP_VICTORIA_TRACES_PORT: String(sharedStack.victoriaTracesPort),
    BAP_VICTORIA_METRICS_URL: `http://127.0.0.1:${sharedStack.victoriaMetricsPort}`,
    BAP_VICTORIA_LOGS_URL: `http://127.0.0.1:${sharedStack.victoriaLogsPort}`,
    BAP_VICTORIA_TRACES_URL: `http://127.0.0.1:${sharedStack.victoriaTracesPort}`,
    BAP_ALERTMANAGER_PORT: String(sharedStack.alertmanagerPort),
    BAP_VMALERT_PORT: String(sharedStack.vmalertPort),
    BAP_GRAFANA_PORT: String(sharedStack.grafanaPort),
    BAP_POSTGRES_VOLUME: sharedStack.postgresVolume,
    BAP_REDIS_VOLUME: sharedStack.redisVolume,
    BAP_MINIO_VOLUME: sharedStack.minioVolume,
    BAP_VICTORIA_METRICS_VOLUME: sharedStack.victoriaMetricsVolume,
    BAP_VICTORIA_LOGS_VOLUME: sharedStack.victoriaLogsVolume,
    BAP_VICTORIA_TRACES_VOLUME: sharedStack.victoriaTracesVolume,
    BAP_ALERTMANAGER_VOLUME: sharedStack.alertmanagerVolume,
    BAP_GRAFANA_VOLUME: sharedStack.grafanaVolume,
    PGHOST: databaseUrl.hostname,
    PGPORT: databaseUrl.port,
    PGDATABASE: databaseUrl.pathname.replace(/^\//, ""),
    PGUSER: decodeURIComponent(databaseUrl.username),
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    AGENT_BROWSER_SESSION: agentBrowserSessionName(metadata.instanceId),
  };
}

export function buildCommentedWorktreeEnv(metadata: InstanceMetadata): Record<(typeof COMMENTED_WORKTREE_ENV_KEYS)[number], string> {
  const stack = buildWorktreeStackConfig(metadata.instanceId, metadata.stackSlot);

  return {
    DAYTONA_API_PORT: String(stack.daytonaApiPort),
    DAYTONA_PROXY_PORT: String(stack.daytonaProxyPort),
    DAYTONA_SSH_GATEWAY_PORT: String(stack.daytonaSshGatewayPort),
    DAYTONA_DEX_PORT: String(stack.daytonaDexPort),
    DAYTONA_API_URL: `http://127.0.0.1:${stack.daytonaApiPort}/api`,
    DAYTONA_DB_VOLUME: stack.daytonaDbVolume,
    DAYTONA_DEX_VOLUME: stack.daytonaDexVolume,
    DAYTONA_REGISTRY_VOLUME: stack.daytonaRegistryVolume,
  };
}

export function buildWorktreeRuntimeEnv(metadata: InstanceMetadata): DerivedEnv {
  return {
    ...readSharedEnvValues(metadata.repoRoot),
    ...buildDerivedEnv(metadata),
  };
}

export function buildSharedComposeEnv(repoRoot: string): NodeJS.ProcessEnv {
  const shared = buildSharedStackConfig();
  return {
    ...process.env,
    ...readSharedEnvValues(repoRoot),
    BAP_COMPOSE_PROJECT: shared.composeProjectName,
    COMPOSE_PROJECT_NAME: shared.composeProjectName,
    BAP_POSTGRES_PORT: String(shared.postgresPort),
    BAP_REDIS_PORT: String(shared.redisPort),
    BAP_MINIO_API_PORT: String(shared.minioApiPort),
    BAP_MINIO_CONSOLE_PORT: String(shared.minioConsolePort),
    BAP_GRAFANA_PORT: String(shared.grafanaPort),
    BAP_ALERTMANAGER_PORT: String(shared.alertmanagerPort),
    BAP_VECTOR_OTLP_GRPC_PORT: String(shared.vectorOtelGrpcPort),
    BAP_VECTOR_OTLP_HTTP_PORT: String(shared.vectorOtelHttpPort),
    BAP_VECTOR_TRACES_PORT: String(shared.vectorTracePort),
    BAP_VECTOR_LOG_PORT: String(shared.vectorLogPort),
    BAP_VICTORIA_METRICS_PORT: String(shared.victoriaMetricsPort),
    BAP_VICTORIA_LOGS_PORT: String(shared.victoriaLogsPort),
    BAP_VICTORIA_TRACES_PORT: String(shared.victoriaTracesPort),
    BAP_VMALERT_PORT: String(shared.vmalertPort),
    BAP_POSTGRES_VOLUME: shared.postgresVolume,
    BAP_REDIS_VOLUME: shared.redisVolume,
    BAP_MINIO_VOLUME: shared.minioVolume,
    BAP_GRAFANA_VOLUME: shared.grafanaVolume,
    BAP_ALERTMANAGER_VOLUME: shared.alertmanagerVolume,
    BAP_VICTORIA_METRICS_VOLUME: shared.victoriaMetricsVolume,
    BAP_VICTORIA_LOGS_VOLUME: shared.victoriaLogsVolume,
    BAP_VICTORIA_TRACES_VOLUME: shared.victoriaTracesVolume,
  };
}
