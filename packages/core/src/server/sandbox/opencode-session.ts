import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type Dockerode from "dockerode";
import { asc, eq } from "drizzle-orm";
import type { ObservabilityContext } from "../utils/observability";
import { env } from "../../env";
import { db } from "@cmdclaw/db/client";
import { conversationRuntime, message, type ContentPart } from "@cmdclaw/db/schema";
import {
  canConnectDockerDaemon,
  createDockerClient,
  createRuntimeContainer,
  ensureDockerRuntimeImage,
  execInContainer,
  getRunningContainerById,
  readFileInContainer,
  removeContainerBestEffort,
  resolveMappedRuntimeUrl,
  writeFileInContainer,
} from "./docker-runtime";
import {
  getOrCreateBareSandbox as getOrCreateBareE2BSandbox,
  getOrCreateSession as getOrCreateE2BSession,
  injectProviderAuth,
} from "./e2b";
import {
  getDaytonaClientConfig,
  listDaytonaSandboxPages,
  type DaytonaListedSandbox,
} from "./daytona";
import { getPreferredCloudSandboxProvider } from "./factory";
import { resolvePreferredCommunitySkillsForUser } from "../services/integration-skill-service";
import { listAccessibleEnabledSkillsForUser } from "../services/workspace-skill-service";
import { restoreConversationSessionSnapshot } from "../services/opencode-session-snapshot-service";
import { COMPACTION_SUMMARY_PREFIX, SESSION_BOUNDARY_PREFIX } from "../services/session-constants";
import { downloadFromS3 } from "../storage/s3-client";
import { resolveSandboxRuntimeAppUrl } from "./prep/runtime-env-prep";
import {
  createSandboxRuntimeClient,
  getSandboxReadinessUrl,
  getSandboxServerPort,
  getSandboxServerBackgroundStartCommand,
  resolveSandboxAgentRuntimeForModel,
} from "./opencode-runtime";
import { conversationRuntimeService } from "../services/conversation-runtime-service";
import { generationLifecyclePolicy } from "../services/lifecycle-policy";
import type { RuntimeMcpServer } from "./core/types";

const DEFAULT_DAYTONA_SNAPSHOT = "cmdclaw-agent-dev";
const DAYTONA_CREATE_TIMEOUT_SECONDS = 30;
const DAYTONA_CREATE_MAX_ATTEMPTS = 2;
const DAYTONA_CREATE_RETRY_DELAY_MS = 1_000;
const DAYTONA_AUTO_STOP_INTERVAL_MINUTES = Math.ceil(
  generationLifecyclePolicy.activeSandboxTimeoutMs / 60_000,
);
const DAYTONA_AUTO_DELETE_INTERVAL_MINUTES = 2 * 60;

type SessionInitStage =
  | "sandbox_checking_cache"
  | "sandbox_reused"
  | "sandbox_creating"
  | "sandbox_created"
  | "opencode_starting"
  | "opencode_waiting_ready"
  | "opencode_ready"
  | "session_reused"
  | "session_creating"
  | "session_created"
  | "session_replay_started"
  | "session_replay_completed"
  | "session_init_completed";

type SessionInitLifecycleCallback = (
  stage: SessionInitStage,
  details?: Record<string, unknown>,
) => void;

type OpenCodeSessionOptions = {
  title?: string;
  replayHistory?: boolean;
  allowSnapshotRestore?: boolean;
  sessionMcpServers?: RuntimeMcpServer[];
  onLifecycle?: SessionInitLifecycleCallback;
  telemetry?: ObservabilityContext;
};

export type OpenCodeCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type OpenCodeSandbox = {
  provider: "e2b" | "daytona" | "docker";
  sandboxId: string;
  commands: {
    run: (
      command: string,
      opts?: {
        timeoutMs?: number;
        envs?: Record<string, string>;
        background?: boolean;
        onStderr?: (chunk: string) => void;
      },
    ) => Promise<OpenCodeCommandResult>;
  };
  files: {
    write: (path: string, content: string | ArrayBuffer) => Promise<void>;
    read: (path: string) => Promise<string>;
  };
  teardown?: () => Promise<void>;
};

export interface OpenCodeSessionConfig {
  conversationId: string;
  generationId?: string;
  userId?: string;
  model: string;
  anthropicApiKey: string;
  integrationEnvs?: Record<string, string>;
  openAIAuthSource?: "user" | "shared" | null;
}

type OpenCodeSessionResult = {
  client: OpencodeClient;
  sessionId: string;
  sandbox: OpenCodeSandbox;
  sessionSource: "live_session" | "restored_snapshot" | "created_session";
};

export type OpenCodeSandboxInitResult = {
  sandbox: OpenCodeSandbox;
  reused: boolean;
  connectAgent: (options?: OpenCodeSessionOptions) => Promise<OpencodeClient>;
};

interface OpenCodeSessionProvider {
  getOrCreateSession(
    config: OpenCodeSessionConfig,
    options?: OpenCodeSessionOptions,
  ): Promise<OpenCodeSessionResult>;
}

function buildSandboxBootstrapEnv(config: OpenCodeSessionConfig): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    ANVIL_API_KEY: env.ANVIL_API_KEY || "",
    APP_URL: resolveSandboxRuntimeAppUrl(),
    CMDCLAW_SERVER_SECRET: env.CMDCLAW_SERVER_SECRET || "",
    CONVERSATION_ID: config.conversationId,
    ...config.integrationEnvs,
  };
}

function buildDaytonaSandboxLabels(config: OpenCodeSessionConfig): Record<string, string> {
  return {
    "cmdclaw-conversation-id": config.conversationId,
    ...(config.generationId ? { "cmdclaw-generation-id": config.generationId } : {}),
    ...(config.userId ? { "cmdclaw-user-id": config.userId } : {}),
  };
}

function buildDaytonaSandboxCreateParams(config: OpenCodeSessionConfig): Record<string, unknown> {
  return {
    snapshot: env.E2B_DAYTONA_SANDBOX_NAME || DEFAULT_DAYTONA_SNAPSHOT,
    envVars: buildSandboxBootstrapEnv(config),
    labels: buildDaytonaSandboxLabels(config),
    autoStopInterval: DAYTONA_AUTO_STOP_INTERVAL_MINUTES,
    autoDeleteInterval: DAYTONA_AUTO_DELETE_INTERVAL_MINUTES,
  };
}

function isDaytonaCreateTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "DaytonaError" &&
    error.message.includes("Failed to create and start sandbox") &&
    error.message.includes("Operation timed out")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getConversationRuntimeState(conversationId: string): Promise<{
  runtimeId: string;
  sandboxId: string | null;
  sessionId: string | null;
} | null> {
  const runtime = await db.query.conversationRuntime.findFirst({
    where: eq(conversationRuntime.conversationId, conversationId),
    columns: {
      id: true,
      sandboxId: true,
      sessionId: true,
    },
  });

  if (!runtime) {
    return null;
  }

  return {
    runtimeId: runtime.id,
    sandboxId: runtime.sandboxId,
    sessionId: runtime.sessionId,
  };
}

type DaytonaSandboxLike = {
  id: string;
  state?: string;
  delete?: () => Promise<void>;
  start?: () => Promise<void>;
  waitUntilStarted?: (timeoutSeconds?: number) => Promise<void>;
  getPreviewLink: (port: number) => Promise<{ url: string; token?: string }>;
  process: {
    executeCommand: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<{
      exitCode?: number;
      result?: string;
      stdout?: string;
      stderr?: string;
    }>;
  };
  fs: {
    uploadFile: (source: Buffer, destination: string, timeout?: number) => Promise<void>;
    downloadFile: (path: string, timeout?: number) => Promise<Buffer | string>;
  };
};

type DaytonaClientLike = {
  create: (
    params: Record<string, unknown>,
    options?: { timeout?: number },
  ) => Promise<DaytonaSandboxLike>;
  get: (sandboxIdOrName: string) => Promise<DaytonaSandboxLike>;
  list: (
    labels?: Record<string, string>,
    page?: number,
    limit?: number,
  ) => Promise<DaytonaListedSandbox[] | { items?: DaytonaListedSandbox[]; totalPages?: number }>;
};

function escapeShell(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function appendDaytonaAuth(url: string, token?: string): string {
  if (!token) {
    return url;
  }
  const parsed = new URL(url);
  if (!parsed.searchParams.has("DAYTONA_SANDBOX_AUTH_KEY")) {
    parsed.searchParams.set("DAYTONA_SANDBOX_AUTH_KEY", token);
  }
  return parsed.toString();
}

async function createDaytonaOpencodeClient(
  baseUrl: string,
  model: string,
  token?: string,
): Promise<OpencodeClient> {
  if (!token) {
    return createSandboxRuntimeClient({ serverUrl: baseUrl, model });
  }
  const authedFetch = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): ReturnType<typeof fetch> => {
    if (input instanceof Request) {
      const authedUrl = appendDaytonaAuth(input.url, token);
      return fetch(new Request(authedUrl, input), init);
    }

    const authedUrl = appendDaytonaAuth(String(input), token);
    return fetch(authedUrl, init);
  };

  return createSandboxRuntimeClient({
    serverUrl: baseUrl,
    model,
    fetch: authedFetch as typeof fetch,
  });
}

function toOpencodeMcpConfig(server: RuntimeMcpServer) {
  if (server.type === "stdio") {
    return {
      type: "local" as const,
      command: [server.command, ...server.args],
      environment: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
      enabled: true,
    };
  }

  return {
    type: "remote" as const,
    url: server.url,
    headers: Object.fromEntries(server.headers.map((entry) => [entry.name, entry.value])),
    enabled: true,
  };
}

function formatMcpError(error: unknown): string {
  if (!error) {
    return "unknown error";
  }
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function ensureOpencodeMcpServerConfigured(
  client: OpencodeClient,
  server: RuntimeMcpServer,
): Promise<void> {
  const desiredConfig = toOpencodeMcpConfig(server);
  const statusResult = await client.mcp.status();
  if (statusResult.error) {
    throw new Error(
      `Failed to read OpenCode MCP status for ${server.name}: ${formatMcpError(statusResult.error)}`,
    );
  }

  const currentStatus = statusResult.data?.[server.name];
  if (currentStatus?.status === "connected") {
    const disconnectResult = await client.mcp.disconnect({ name: server.name });
    if (disconnectResult.error) {
      throw new Error(
        `Failed to disconnect stale OpenCode MCP server ${server.name}: ${formatMcpError(disconnectResult.error)}`,
      );
    }
  }

  if (!currentStatus || currentStatus.status === "failed") {
    const addResult = await client.mcp.add({
      name: server.name,
      config: desiredConfig,
    });
    if (addResult.error) {
      const message = formatMcpError(addResult.error);
      if (!message.toLowerCase().includes("already exists")) {
        throw new Error(`Failed to add OpenCode MCP server ${server.name}: ${message}`);
      }
    }
  }

  const refreshedStatusResult = await client.mcp.status();
  if (refreshedStatusResult.error) {
    throw new Error(
      `Failed to refresh OpenCode MCP status for ${server.name}: ${formatMcpError(refreshedStatusResult.error)}`,
    );
  }

  const refreshedStatus = refreshedStatusResult.data?.[server.name];
  if (refreshedStatus?.status === "connected") {
    return;
  }

  const connectResult = await client.mcp.connect({ name: server.name });
  if (connectResult.error) {
    throw new Error(
      `Failed to connect OpenCode MCP server ${server.name}: ${formatMcpError(connectResult.error)}`,
    );
  }

  const finalStatusResult = await client.mcp.status();
  if (finalStatusResult.error) {
    throw new Error(
      `Failed to verify OpenCode MCP status for ${server.name}: ${formatMcpError(finalStatusResult.error)}`,
    );
  }
  const finalStatus = finalStatusResult.data?.[server.name];
  if (finalStatus?.status !== "connected") {
    throw new Error(
      `OpenCode MCP server ${server.name} is not connected (status=${finalStatus?.status ?? "missing"}).`,
    );
  }
}

async function ensureOpencodeMcpServersConfigured(
  client: OpencodeClient,
  servers: RuntimeMcpServer[] | undefined,
): Promise<void> {
  for (const server of servers ?? []) {
    // MCP registration must be complete before the first prompt is sent.
    await ensureOpencodeMcpServerConfigured(client, server);
  }
}

async function waitForServer(
  url: string,
  model: string,
  token?: string,
  maxWait = 30_000,
): Promise<void> {
  const readinessUrl = appendDaytonaAuth(getSandboxReadinessUrl(url, model), token);
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWait) {
    try {
      // eslint-disable-next-line no-await-in-loop -- readiness polling is intentional
      const response = await fetch(readinessUrl, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    // eslint-disable-next-line no-await-in-loop -- readiness polling is intentional
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `OpenCode server failed readiness check (url=${readinessUrl}, waitedMs=${maxWait})`,
  );
}

function wrapDaytonaSandbox(sandbox: DaytonaSandboxLike): OpenCodeSandbox {
  return {
    provider: "daytona",
    sandboxId: sandbox.id,
    commands: {
      run: async (command, opts) => {
        const timeoutSeconds = opts?.timeoutMs ? Math.max(1, Math.ceil(opts.timeoutMs / 1000)) : 0;
        const effectiveCommand = opts?.background
          ? `sh -lc ${escapeShell(`(${command}) >/tmp/opencode-bg.log 2>&1 &`)}`
          : command;
        const result = await sandbox.process.executeCommand(
          effectiveCommand,
          "/app",
          opts?.envs,
          timeoutSeconds,
        );
        const stderr = result.stderr ?? "";
        if (stderr && opts?.onStderr) {
          for (const line of stderr.split("\n")) {
            if (line.trim()) {
              opts.onStderr(line);
            }
          }
        }
        return {
          exitCode: result.exitCode ?? 0,
          stdout: result.stdout ?? result.result ?? "",
          stderr,
        };
      },
    },
    files: {
      write: async (path, content) => {
        const normalized =
          typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
        await sandbox.fs.uploadFile(normalized, path);
      },
      read: async (path) => {
        const raw = await sandbox.fs.downloadFile(path);
        return typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
      },
    },
    teardown: async () => {
      await sandbox.delete?.().catch(() => {});
    },
  };
}

function wrapDockerSandbox(container: Dockerode.Container): OpenCodeSandbox {
  return {
    provider: "docker",
    sandboxId: container.id,
    commands: {
      run: async (command, opts) => {
        const effectiveCommand = opts?.background
          ? `sh -lc ${escapeShell(`(${command}) >/tmp/opencode-bg.log 2>&1 &`)}`
          : command;

        return execInContainer({
          container,
          command: effectiveCommand,
          cwd: "/app",
          env: opts?.envs,
          timeoutMs: opts?.timeoutMs,
          onStderr: opts?.onStderr,
        });
      },
    },
    files: {
      write: async (path, content) => writeFileInContainer(container, path, content),
      read: async (path) => readFileInContainer(container, path),
    },
    teardown: async () => {
      await removeContainerBestEffort(container);
    },
  };
}

async function connectDockerSandboxById(
  docker: Dockerode,
  sandboxId: string,
): Promise<Dockerode.Container | null> {
  return getRunningContainerById(docker, sandboxId);
}

async function getOrCreateDockerSandbox(
  config: OpenCodeSessionConfig,
  onLifecycle?: SessionInitLifecycleCallback,
): Promise<{
  sandbox: OpenCodeSandbox;
  client: OpencodeClient;
  reused: boolean;
}> {
  const docker = createDockerClient();
  if (!(await canConnectDockerDaemon(docker))) {
    throw new Error("Docker daemon is not reachable");
  }

  onLifecycle?.("sandbox_checking_cache", { conversationId: config.conversationId });
  const runtimeState = await getConversationRuntimeState(config.conversationId);

  const connectAndValidate = async (container: Dockerode.Container | null) => {
    if (!container) {
      return null;
    }
    const baseUrl = await resolveMappedRuntimeUrl(container, getSandboxServerPort(config.model));
    const health = await fetch(getSandboxReadinessUrl(baseUrl, config.model), {
      method: "GET",
    }).catch(() => null);
    if (!health?.ok) {
      return null;
    }
    return {
      container,
      baseUrl,
    };
  };

  const fromConversation = runtimeState?.sandboxId
    ? await connectDockerSandboxById(docker, runtimeState.sandboxId)
    : null;

  const validConversationContainer = await connectAndValidate(fromConversation);
  if (validConversationContainer) {
    onLifecycle?.("sandbox_reused", {
      conversationId: config.conversationId,
      sandboxId: validConversationContainer.container.id,
    });
    return {
      sandbox: wrapDockerSandbox(validConversationContainer.container),
      client: await createSandboxRuntimeClient({
        serverUrl: validConversationContainer.baseUrl,
        model: config.model,
      }),
      reused: true,
    };
  }

  if (runtimeState?.sandboxId) {
    if (fromConversation) {
      await removeContainerBestEffort(fromConversation);
    }
    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
  }

  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: "cmdclaw-agent-runtime",
  });

  const imageTag = await ensureDockerRuntimeImage(docker);
  const runtimePort = getSandboxServerPort(config.model);
  const created = await createRuntimeContainer({
    docker,
    imageTag,
    runtimePort,
    env: buildSandboxBootstrapEnv(config),
  });

  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: created.id,
  });

  onLifecycle?.("opencode_starting", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    port: runtimePort,
  });

  await execInContainer({
    container: created,
    command: getSandboxServerBackgroundStartCommand({
      sandboxId: created.id,
      model: config.model,
    }),
    cwd: "/app",
    timeoutMs: 10_000,
  });

  const baseUrl = await resolveMappedRuntimeUrl(created, runtimePort);
  onLifecycle?.("opencode_waiting_ready", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    serverUrl: baseUrl,
  });
  await waitForServer(baseUrl, config.model);

  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    serverUrl: baseUrl,
  });

  return {
    sandbox: wrapDockerSandbox(created),
    client: await createSandboxRuntimeClient({ serverUrl: baseUrl, model: config.model }),
    reused: false,
  };
}

async function createDaytonaClient() {
  const { Daytona } = await import("@daytonaio/sdk");
  return new Daytona(getDaytonaClientConfig()) as unknown as DaytonaClientLike;
}

async function recoverCreatedDaytonaSandboxAfterTimeout(
  daytona: DaytonaClientLike,
  config: OpenCodeSessionConfig,
): Promise<DaytonaSandboxLike | null> {
  if (!config.generationId) {
    return null;
  }

  const labels = buildDaytonaSandboxLabels(config);
  let sandboxes: DaytonaListedSandbox[];
  try {
    sandboxes = await listDaytonaSandboxPages(daytona, labels);
  } catch {
    return null;
  }

  const runningCandidate = sandboxes.find((sandbox) => {
    const state = (sandbox.state ?? "").toLowerCase();
    return sandbox.id && (state === "started" || state === "starting");
  });
  if (runningCandidate?.id) {
    try {
      const sandbox = await daytona.get(runningCandidate.id);
      if (sandbox.state && sandbox.state !== "started") {
        await sandbox.start?.();
        await sandbox.waitUntilStarted?.(DAYTONA_CREATE_TIMEOUT_SECONDS);
      }
      return sandbox;
    } catch {
      return null;
    }
  }

  const terminalCandidates = sandboxes.filter((sandbox) =>
    ["error", "build_failed", "stopped"].includes((sandbox.state ?? "").toLowerCase()),
  );
  for (const sandbox of terminalCandidates) {
    if (!sandbox.id) {
      continue;
    }
    if (sandbox.delete) {
      // eslint-disable-next-line no-await-in-loop -- cleanup must stay bounded and sequential
      await sandbox.delete(60).catch(() => undefined);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- fallback lookup is per sandbox
    const loaded = await daytona.get(sandbox.id).catch(() => null);
    // eslint-disable-next-line no-await-in-loop -- cleanup must stay bounded and sequential
    await loaded?.delete?.().catch(() => undefined);
  }

  return null;
}

async function createDaytonaSandboxWithRetry(
  daytona: DaytonaClientLike,
  config: OpenCodeSessionConfig,
): Promise<DaytonaSandboxLike> {
  const params = buildDaytonaSandboxCreateParams(config);
  let lastError: unknown;

  for (let attempt = 1; attempt <= DAYTONA_CREATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- retries must be sequential to avoid duplicate sandboxes
      return await daytona.create(params, { timeout: DAYTONA_CREATE_TIMEOUT_SECONDS });
    } catch (error) {
      lastError = error;
      if (!isDaytonaCreateTimeout(error)) {
        throw error;
      }

      // eslint-disable-next-line no-await-in-loop -- recovery must observe the just-timed-out create
      const recovered = await recoverCreatedDaytonaSandboxAfterTimeout(daytona, config);
      if (recovered) {
        return recovered;
      }

      if (attempt >= DAYTONA_CREATE_MAX_ATTEMPTS) {
        break;
      }

      console.warn("[opencode-session] Daytona create timed out; retrying", {
        conversationId: config.conversationId,
        generationId: config.generationId,
        attempt,
        timeoutSeconds: DAYTONA_CREATE_TIMEOUT_SECONDS,
      });
      // eslint-disable-next-line no-await-in-loop -- retry delay is intentionally bounded
      await sleep(DAYTONA_CREATE_RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Daytona sandbox create failed after retry");
}

async function cleanupStaleDaytonaRuntime(args: {
  runtimeId: string;
  sandboxId: string;
  conversationId: string;
  reason: string;
}) {
  try {
    const daytona = await createDaytonaClient();
    const sandbox = (await daytona.get(args.sandboxId)) as DaytonaSandboxLike;
    await sandbox.delete?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[opencode-session] Failed to delete stale Daytona sandbox", {
      conversationId: args.conversationId,
      runtimeId: args.runtimeId,
      sandboxId: args.sandboxId,
      reason: args.reason,
      error: message,
    });
  }

  await conversationRuntimeService.markRuntimeDead(args.runtimeId);
}

async function connectDaytonaSandboxById(sandboxId: string): Promise<DaytonaSandboxLike | null> {
  try {
    const daytona = await createDaytonaClient();
    const sandbox = (await daytona.get(sandboxId)) as DaytonaSandboxLike;
    if (sandbox.state && sandbox.state !== "started") {
      await sandbox.start?.();
      await sandbox.waitUntilStarted?.(60);
    }
    return sandbox;
  } catch {
    return null;
  }
}

async function getOrCreateDaytonaSandbox(
  config: OpenCodeSessionConfig,
  onLifecycle?: SessionInitLifecycleCallback,
): Promise<{
  sandbox: OpenCodeSandbox;
  client: OpencodeClient;
  reused: boolean;
}> {
  onLifecycle?.("sandbox_checking_cache", { conversationId: config.conversationId });
  const runtimeState = await getConversationRuntimeState(config.conversationId);

  const fromConversation = runtimeState?.sandboxId
    ? await connectDaytonaSandboxById(runtimeState.sandboxId)
    : null;

  if (fromConversation) {
    const preview = await fromConversation.getPreviewLink(getSandboxServerPort(config.model));
    const baseUrl = preview.url;
    const health = await fetch(
      appendDaytonaAuth(getSandboxReadinessUrl(baseUrl, config.model), preview.token),
      {
        method: "GET",
      },
    ).catch(() => null);
    if (health?.ok) {
      onLifecycle?.("sandbox_reused", {
        conversationId: config.conversationId,
        sandboxId: fromConversation.id,
      });
      return {
        sandbox: wrapDaytonaSandbox(fromConversation),
        client: await createDaytonaOpencodeClient(baseUrl, config.model, preview.token),
        reused: true,
      };
    }
  }

  if (runtimeState?.sandboxId) {
    await cleanupStaleDaytonaRuntime({
      runtimeId: runtimeState.runtimeId,
      sandboxId: runtimeState.sandboxId,
      conversationId: config.conversationId,
      reason: "reused_runtime_failed_healthcheck",
    });
  }

  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: env.E2B_DAYTONA_SANDBOX_NAME || DEFAULT_DAYTONA_SNAPSHOT,
  });

  const daytona = await createDaytonaClient();
  const created = await createDaytonaSandboxWithRetry(daytona, config);

  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: created.id,
  });

  onLifecycle?.("opencode_starting", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    port: getSandboxServerPort(config.model),
  });

  const preview = await created.getPreviewLink(getSandboxServerPort(config.model));
  const baseUrl = preview.url;

  onLifecycle?.("opencode_waiting_ready", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    serverUrl: preview.url,
  });

  await waitForServer(baseUrl, config.model, preview.token);

  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    serverUrl: preview.url,
  });

  return {
    sandbox: wrapDaytonaSandbox(created),
    client: await createDaytonaOpencodeClient(baseUrl, config.model, preview.token),
    reused: false,
  };
}

async function ensureDockerAgentReady(
  container: Dockerode.Container,
  config: OpenCodeSessionConfig,
  onLifecycle?: SessionInitLifecycleCallback,
): Promise<OpencodeClient> {
  const runtimePort = getSandboxServerPort(config.model);
  const baseUrl = await resolveMappedRuntimeUrl(container, runtimePort);
  const health = await fetch(getSandboxReadinessUrl(baseUrl, config.model), {
    method: "GET",
  }).catch(() => null);

  if (!health?.ok) {
    onLifecycle?.("opencode_starting", {
      conversationId: config.conversationId,
      sandboxId: container.id,
      port: runtimePort,
    });
    await execInContainer({
      container,
      command: getSandboxServerBackgroundStartCommand({
        sandboxId: container.id,
        model: config.model,
      }),
      cwd: "/app",
      timeoutMs: 10_000,
    });
    onLifecycle?.("opencode_waiting_ready", {
      conversationId: config.conversationId,
      sandboxId: container.id,
      serverUrl: baseUrl,
    });
    await waitForServer(baseUrl, config.model);
  }

  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: container.id,
    serverUrl: baseUrl,
  });

  return await createSandboxRuntimeClient({ serverUrl: baseUrl, model: config.model });
}

async function getOrCreateDockerSandboxInit(
  config: OpenCodeSessionConfig,
  onLifecycle?: SessionInitLifecycleCallback,
): Promise<OpenCodeSandboxInitResult> {
  const docker = createDockerClient();
  if (!(await canConnectDockerDaemon(docker))) {
    throw new Error("Docker daemon is not reachable");
  }

  onLifecycle?.("sandbox_checking_cache", { conversationId: config.conversationId });
  const runtimeState = await getConversationRuntimeState(config.conversationId);
  const fromConversation = runtimeState?.sandboxId
    ? await connectDockerSandboxById(docker, runtimeState.sandboxId)
    : null;

  if (fromConversation) {
    onLifecycle?.("sandbox_reused", {
      conversationId: config.conversationId,
      sandboxId: fromConversation.id,
    });
    return {
      sandbox: wrapDockerSandbox(fromConversation),
      reused: true,
      connectAgent: async (options) =>
        await ensureDockerAgentReady(fromConversation, config, options?.onLifecycle),
    };
  }

  if (runtimeState?.sandboxId) {
    if (fromConversation) {
      await removeContainerBestEffort(fromConversation);
    }
    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
  }

  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: "cmdclaw-agent-runtime",
  });

  const imageTag = await ensureDockerRuntimeImage(docker);
  const runtimePort = getSandboxServerPort(config.model);
  const created = await createRuntimeContainer({
    docker,
    imageTag,
    runtimePort,
    env: buildSandboxBootstrapEnv(config),
  });

  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: created.id,
  });

  return {
    sandbox: wrapDockerSandbox(created),
    reused: false,
    connectAgent: async (options) =>
      await ensureDockerAgentReady(created, config, options?.onLifecycle),
  };
}

async function ensureDaytonaAgentReady(
  sandbox: DaytonaSandboxLike,
  config: OpenCodeSessionConfig,
  onLifecycle?: SessionInitLifecycleCallback,
): Promise<OpencodeClient> {
  const preview = await sandbox.getPreviewLink(getSandboxServerPort(config.model));
  const baseUrl = preview.url;
  const health = await fetch(
    appendDaytonaAuth(getSandboxReadinessUrl(baseUrl, config.model), preview.token),
    {
      method: "GET",
    },
  ).catch(() => null);

  if (!health?.ok) {
    onLifecycle?.("opencode_starting", {
      conversationId: config.conversationId,
      sandboxId: sandbox.id,
      port: getSandboxServerPort(config.model),
    });
    const startResult = await sandbox.process.executeCommand(
      getSandboxServerBackgroundStartCommand({
        sandboxId: sandbox.id,
        model: config.model,
      }),
      "/app",
      undefined,
      10,
    );
    const startExitCode = startResult.exitCode ?? 0;
    if (startExitCode !== 0) {
      throw new Error(
        `OpenCode server start failed (exit=${startExitCode}): ${
          startResult.stderr || startResult.stdout || startResult.result || "unknown error"
        }`,
      );
    }
    onLifecycle?.("opencode_waiting_ready", {
      conversationId: config.conversationId,
      sandboxId: sandbox.id,
      serverUrl: preview.url,
    });
    await waitForServer(baseUrl, config.model, preview.token);
  }

  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: sandbox.id,
    serverUrl: preview.url,
  });

  return await createSandboxRuntimeClient({
    serverUrl: baseUrl,
    model: config.model,
    fetch: preview.token
      ? (((input, init) => {
          if (input instanceof Request) {
            const authedUrl = appendDaytonaAuth(input.url, preview.token);
            return fetch(new Request(authedUrl, input), init);
          }

          const authedUrl = appendDaytonaAuth(String(input), preview.token);
          return fetch(authedUrl, init);
        }) as typeof fetch)
      : undefined,
  });
}

async function getOrCreateDaytonaSandboxInit(
  config: OpenCodeSessionConfig,
  onLifecycle?: SessionInitLifecycleCallback,
): Promise<OpenCodeSandboxInitResult> {
  onLifecycle?.("sandbox_checking_cache", { conversationId: config.conversationId });
  const runtimeState = await getConversationRuntimeState(config.conversationId);

  const fromConversation = runtimeState?.sandboxId
    ? await connectDaytonaSandboxById(runtimeState.sandboxId)
    : null;

  if (fromConversation) {
    onLifecycle?.("sandbox_reused", {
      conversationId: config.conversationId,
      sandboxId: fromConversation.id,
    });
    return {
      sandbox: wrapDaytonaSandbox(fromConversation),
      reused: true,
      connectAgent: async (options) =>
        await ensureDaytonaAgentReady(fromConversation, config, options?.onLifecycle),
    };
  }

  if (runtimeState?.sandboxId) {
    await cleanupStaleDaytonaRuntime({
      runtimeId: runtimeState.runtimeId,
      sandboxId: runtimeState.sandboxId,
      conversationId: config.conversationId,
      reason: "reused_runtime_missing_for_init",
    });
  }

  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: env.E2B_DAYTONA_SANDBOX_NAME || DEFAULT_DAYTONA_SNAPSHOT,
  });

  const daytona = await createDaytonaClient();
  const created = await createDaytonaSandboxWithRetry(daytona, config);

  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: created.id,
  });

  return {
    sandbox: wrapDaytonaSandbox(created),
    reused: false,
    connectAgent: async (options) =>
      await ensureDaytonaAgentReady(created, config, options?.onLifecycle),
  };
}

async function getOrCreateCloudSession(
  config: OpenCodeSessionConfig,
  options: OpenCodeSessionOptions | undefined,
  getOrCreateSandbox: (
    config: OpenCodeSessionConfig,
    onLifecycle?: SessionInitLifecycleCallback,
  ) => Promise<{
    sandbox: OpenCodeSandbox;
    client: OpencodeClient;
    reused: boolean;
  }>,
): Promise<OpenCodeSessionResult> {
  const state = await getOrCreateSandbox(config, options?.onLifecycle);
  const runtimeState = await getConversationRuntimeState(config.conversationId);
  const runtimeId = runtimeState?.runtimeId ?? null;
  const existingSessionId = runtimeState?.sessionId ?? null;

  if (existingSessionId && state.reused) {
    const existingSession = await state.client.session.get({ sessionID: existingSessionId });
    if (!existingSession.error && existingSession.data) {
      options?.onLifecycle?.("session_reused", {
        conversationId: config.conversationId,
        sessionId: existingSessionId,
        sandboxId: state.sandbox.sandboxId,
      });
      return {
        client: state.client,
        sessionId: existingSessionId,
        sandbox: state.sandbox,
        sessionSource: "live_session",
      };
    }

    if (runtimeId) {
      await db
        .update(conversationRuntime)
        .set({ sessionId: null })
        .where(eq(conversationRuntime.id, runtimeId));
    }
  } else if (existingSessionId && !state.reused) {
    if (runtimeId) {
      await db
        .update(conversationRuntime)
        .set({ sessionId: null })
        .where(eq(conversationRuntime.id, runtimeId));
    }
  }

  if (!state.reused && options?.allowSnapshotRestore !== false) {
    try {
      const restoredSnapshot = await restoreConversationSessionSnapshot({
        conversationId: config.conversationId,
        sandbox: {
          exec: (command, opts) =>
            state.sandbox.commands.run(command, {
              timeoutMs: opts?.timeoutMs,
              envs: opts?.env,
              background: opts?.background,
              onStderr: opts?.onStderr,
            }),
          writeFile: (path, content) => state.sandbox.files.write(path, content),
        },
        client: state.client,
      });
      if (restoredSnapshot) {
        if (config.userId) {
          await injectProviderAuth(state.client, config.userId, {
            openAIAuthSource: config.openAIAuthSource,
          });
        }

        options?.onLifecycle?.("session_reused", {
          conversationId: config.conversationId,
          sessionId: restoredSnapshot.sessionId,
          sandboxId: state.sandbox.sandboxId,
          restoredFromSnapshot: true,
        });
        options?.onLifecycle?.("session_init_completed", {
          conversationId: config.conversationId,
          sessionId: restoredSnapshot.sessionId,
          restoredFromSnapshot: true,
        });
        return {
          client: state.client,
          sessionId: restoredSnapshot.sessionId,
          sandbox: state.sandbox,
          sessionSource: "restored_snapshot",
        };
      }
    } catch (error) {
      console.warn(
        `[OpenCodeSession] Failed to restore snapshot for conversation ${config.conversationId}:`,
        error,
      );
    }
  }

  options?.onLifecycle?.("session_creating", {
    conversationId: config.conversationId,
    sandboxId: state.sandbox.sandboxId,
  });

  const sessionResult = await state.client.session.create({
    title: options?.title || "Conversation",
  });
  if (sessionResult.error || !sessionResult.data) {
    const details = sessionResult.error ? JSON.stringify(sessionResult.error) : "missing_data";
    throw new Error(`Failed to create OpenCode session: ${details}`);
  }
  const sessionId = sessionResult.data.id;
  options?.onLifecycle?.("session_created", {
    conversationId: config.conversationId,
    sessionId,
    sandboxId: state.sandbox.sandboxId,
  });

  if (config.userId) {
    await injectProviderAuth(state.client, config.userId, {
      openAIAuthSource: config.openAIAuthSource,
    });
  }

  if (options?.replayHistory) {
    options.onLifecycle?.("session_replay_started", {
      conversationId: config.conversationId,
      sessionId,
    });
    await replayConversationHistory(state.client, sessionId, config.conversationId);
    options.onLifecycle?.("session_replay_completed", {
      conversationId: config.conversationId,
      sessionId,
    });
  }

  options?.onLifecycle?.("session_init_completed", {
    conversationId: config.conversationId,
    sessionId,
  });

  return {
    client: state.client,
    sessionId,
    sandbox: state.sandbox,
    sessionSource: "created_session",
  };
}

async function getOrCreateDaytonaSession(
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSessionResult> {
  return getOrCreateCloudSession(config, options, getOrCreateDaytonaSandbox);
}

async function getOrCreateDockerSession(
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSessionResult> {
  return getOrCreateCloudSession(config, options, getOrCreateDockerSandbox);
}

export async function getOrCreateSandboxForCloudProvider(
  provider: "e2b" | "daytona" | "docker",
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSandboxInitResult> {
  if (provider === "daytona") {
    return await getOrCreateDaytonaSandboxInit(config, options?.onLifecycle);
  }
  if (provider === "docker") {
    return await getOrCreateDockerSandboxInit(config, options?.onLifecycle);
  }

  const state = await getOrCreateBareE2BSandbox(config, options?.onLifecycle, options?.telemetry);
  return {
    sandbox: {
      provider: "e2b",
      sandboxId: state.sandbox.sandboxId,
      commands: {
        run: async (command, opts) => {
          const result = await state.sandbox.commands.run(command, {
            timeoutMs: opts?.timeoutMs,
            envs: opts?.envs,
            background: opts?.background,
            onStderr: opts?.onStderr,
          });
          return {
            exitCode: result.exitCode ?? 0,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
          };
        },
      },
      files: {
        write: async (path, content) => {
          await state.sandbox.files.write(path, content);
        },
        read: async (path) => state.sandbox.files.read(path),
      },
      teardown: async () => {
        await state.sandbox.kill().catch(() => {});
      },
    },
    reused: state.reused,
    connectAgent: async (agentOptions) => {
      const serverPort = getSandboxServerPort(config.model);
      const serverUrl = `https://${state.sandbox.getHost(serverPort)}`;
      const health = await fetch(getSandboxReadinessUrl(serverUrl, config.model), {
        method: "GET",
      }).catch(() => null);

      if (!health?.ok) {
        throw new Error(`Sandbox runtime is not ready at ${serverUrl}`);
      }

      agentOptions?.onLifecycle?.("opencode_ready", {
        conversationId: config.conversationId,
        sandboxId: state.sandbox.sandboxId,
        serverUrl,
      });

      return await createSandboxRuntimeClient({
        serverUrl,
        model: config.model,
      });
    },
  };
}

export async function completeSessionInitForCloudProvider(
  _provider: "e2b" | "daytona" | "docker",
  sandboxInit: OpenCodeSandboxInitResult,
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSessionResult> {
  const client = await sandboxInit.connectAgent(options);
  if (resolveSandboxAgentRuntimeForModel(config.model) === "opencode") {
    await ensureOpencodeMcpServersConfigured(client, options?.sessionMcpServers);
  }
  const runtimeState = await getConversationRuntimeState(config.conversationId);
  const runtimeId = runtimeState?.runtimeId ?? null;
  const existingSessionId = runtimeState?.sessionId ?? null;

  if (existingSessionId && sandboxInit.reused) {
    const existingSession = await client.session.get({ sessionID: existingSessionId });
    if (!existingSession.error && existingSession.data) {
      options?.onLifecycle?.("session_reused", {
        conversationId: config.conversationId,
        sessionId: existingSessionId,
        sandboxId: sandboxInit.sandbox.sandboxId,
      });
      return {
        client,
        sessionId: existingSessionId,
        sandbox: sandboxInit.sandbox,
        sessionSource: "live_session",
      };
    }

    if (runtimeId) {
      await db
        .update(conversationRuntime)
        .set({ sessionId: null })
        .where(eq(conversationRuntime.id, runtimeId));
    }
  } else if (existingSessionId && !sandboxInit.reused) {
    if (runtimeId) {
      await db
        .update(conversationRuntime)
        .set({ sessionId: null })
        .where(eq(conversationRuntime.id, runtimeId));
    }
  }

  if (!sandboxInit.reused && options?.allowSnapshotRestore !== false) {
    try {
      const restoredSnapshot = await restoreConversationSessionSnapshot({
        conversationId: config.conversationId,
        sandbox: {
          exec: (command, opts) =>
            sandboxInit.sandbox.commands.run(command, {
              timeoutMs: opts?.timeoutMs,
              envs: opts?.env,
              background: opts?.background,
              onStderr: opts?.onStderr,
            }),
          writeFile: (path, content) => sandboxInit.sandbox.files.write(path, content),
        },
        client,
      });
      if (restoredSnapshot) {
        if (config.userId) {
          await injectProviderAuth(client, config.userId, {
            openAIAuthSource: config.openAIAuthSource,
          });
        }

        options?.onLifecycle?.("session_reused", {
          conversationId: config.conversationId,
          sessionId: restoredSnapshot.sessionId,
          sandboxId: sandboxInit.sandbox.sandboxId,
          restoredFromSnapshot: true,
        });
        options?.onLifecycle?.("session_init_completed", {
          conversationId: config.conversationId,
          sessionId: restoredSnapshot.sessionId,
          restoredFromSnapshot: true,
        });
        return {
          client,
          sessionId: restoredSnapshot.sessionId,
          sandbox: sandboxInit.sandbox,
          sessionSource: "restored_snapshot",
        };
      }
    } catch (error) {
      console.warn(
        `[OpenCodeSession] Failed to restore snapshot for conversation ${config.conversationId}:`,
        error,
      );
    }
  }

  options?.onLifecycle?.("session_creating", {
    conversationId: config.conversationId,
    sandboxId: sandboxInit.sandbox.sandboxId,
  });

  const sessionResult = await client.session.create({
    title: options?.title || "Conversation",
  });
  if (sessionResult.error || !sessionResult.data) {
    const details = sessionResult.error ? JSON.stringify(sessionResult.error) : "missing_data";
    throw new Error(`Failed to create OpenCode session: ${details}`);
  }
  const sessionId = sessionResult.data.id;
  options?.onLifecycle?.("session_created", {
    conversationId: config.conversationId,
    sessionId,
    sandboxId: sandboxInit.sandbox.sandboxId,
  });

  if (config.userId) {
    await injectProviderAuth(client, config.userId, {
      openAIAuthSource: config.openAIAuthSource,
    });
  }

  if (options?.replayHistory) {
    options.onLifecycle?.("session_replay_started", {
      conversationId: config.conversationId,
      sessionId,
    });
    await replayConversationHistory(client, sessionId, config.conversationId);
    options.onLifecycle?.("session_replay_completed", {
      conversationId: config.conversationId,
      sessionId,
    });
  }

  options?.onLifecycle?.("session_init_completed", {
    conversationId: config.conversationId,
    sessionId,
  });

  return {
    client,
    sessionId,
    sandbox: sandboxInit.sandbox,
    sessionSource: "created_session",
  };
}

async function replayConversationHistory(
  client: OpencodeClient,
  sessionId: string,
  conversationId: string,
): Promise<void> {
  const messages = await db.query.message.findMany({
    where: eq(message.conversationId, conversationId),
    orderBy: asc(message.createdAt),
  });

  if (messages.length === 0) {
    return;
  }

  const boundaryIndex = messages.findLastIndex(
    (m) => m.role === "system" && m.content.startsWith(SESSION_BOUNDARY_PREFIX),
  );
  const sessionMessages = boundaryIndex >= 0 ? messages.slice(boundaryIndex + 1) : messages;

  const summaryIndex = sessionMessages.findLastIndex(
    (m) => m.role === "system" && m.content.startsWith(COMPACTION_SUMMARY_PREFIX),
  );

  const summaryMessage = summaryIndex >= 0 ? sessionMessages[summaryIndex] : undefined;
  const summaryText = summaryMessage
    ? summaryMessage.content.replace(COMPACTION_SUMMARY_PREFIX, "").trim()
    : null;

  const messagesAfterSummary =
    summaryIndex >= 0 ? sessionMessages.slice(summaryIndex + 1) : sessionMessages;

  const historyContext = messagesAfterSummary
    .map((m) => {
      if (m.role === "user") {
        return `User: ${m.content}`;
      }
      if (m.role === "assistant") {
        if (m.contentParts) {
          const parts = m.contentParts
            .map((p) => {
              const part = p as ContentPart;
              if (part.type === "text") {
                return part.text;
              }
              if (part.type === "tool_use") {
                return `[Used ${part.name}]`;
              }
              if (part.type === "tool_result") {
                return "[Result received]";
              }
              return "";
            })
            .filter(Boolean)
            .join("\n");
          return `Assistant: ${parts}`;
        }
        return `Assistant: ${m.content}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  const summaryBlock = summaryText ? `Summary of previous conversation:\n${summaryText}\n\n` : "";
  await client.session.prompt({
    sessionID: sessionId,
    parts: [
      {
        type: "text",
        text: `<conversation_history>\n${summaryBlock}${historyContext}\n</conversation_history>\n\nContinue this conversation. The user's next message follows.`,
      },
    ],
    noReply: true,
  });
}

async function getOrCreateSession(
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSessionResult> {
  return getOrCreateSessionForCloudProvider(getPreferredCloudSandboxProvider(), config, options);
}

async function getOrCreateSessionForCloudProvider(
  provider: "e2b" | "daytona" | "docker",
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSessionResult> {
  return getOpenCodeSessionProvider(provider).getOrCreateSession(config, options);
}

export async function writeSkillsToSandbox(
  sandbox: OpenCodeSandbox,
  userId: string,
  allowedSkillNames?: string[],
): Promise<string[]> {
  const filteredSkills = await listAccessibleEnabledSkillsForUser(userId, allowedSkillNames);

  if (filteredSkills.length === 0) {
    return [];
  }

  await sandbox.commands.run("mkdir -p /app/.opencode/skills");

  const writtenSkills: string[] = [];
  let agentsContent = "# Custom Skills\n\n";

  await filteredSkills.reduce<Promise<void>>(async (prev, s) => {
    await prev;
    const skillDir = `/app/.opencode/skills/${s.name}`;
    await sandbox.commands.run(`mkdir -p "${skillDir}"`);

    agentsContent += `## ${s.displayName}\n\n`;
    agentsContent += `${s.description}\n\n`;
    agentsContent += `Files available in: /app/.opencode/skills/${s.name}/\n\n`;

    await Promise.all(
      s.files.map(async (file) => {
        const filePath = `${skillDir}/${file.path}`;
        const lastSlash = filePath.lastIndexOf("/");
        const parentDir = filePath.substring(0, lastSlash);
        if (parentDir !== skillDir) {
          await sandbox.commands.run(`mkdir -p "${parentDir}"`);
        }
        await sandbox.files.write(filePath, file.content);
      }),
    );

    await Promise.all(
      s.documents.map(async (doc) => {
        try {
          const buffer = await downloadFromS3(doc.storageKey);
          const docPath = `${skillDir}/${doc.path ?? doc.filename}`;
          const lastSlash = docPath.lastIndexOf("/");
          const parentDir = docPath.substring(0, lastSlash);
          if (parentDir !== skillDir) {
            await sandbox.commands.run(`mkdir -p "${parentDir}"`);
          }
          const arrayBuffer = new Uint8Array(buffer).buffer;
          await sandbox.files.write(docPath, arrayBuffer);
        } catch (error) {
          console.error(
            `[OpenCodeSession] Failed to write document ${doc.path ?? doc.filename}:`,
            error,
          );
        }
      }),
    );

    writtenSkills.push(s.name);
  }, Promise.resolve());

  await sandbox.files.write("/app/.opencode/AGENTS.md", agentsContent);

  return writtenSkills;
}

export async function writeResolvedIntegrationSkillsToSandbox(
  sandbox: OpenCodeSandbox,
  userId: string,
  allowedSlugs?: string[],
): Promise<string[]> {
  const resolved = await resolvePreferredCommunitySkillsForUser(userId, allowedSlugs);
  if (resolved.length === 0) {
    return [];
  }

  await sandbox.commands.run("mkdir -p /app/.opencode/integration-skills");
  const written: string[] = [];

  await Promise.all(
    resolved.map(async (entry) => {
      const skillDir = `/app/.opencode/integration-skills/${entry.slug}`;
      await sandbox.commands.run(`mkdir -p "${skillDir}"`);

      await Promise.all(
        entry.files.map(async (file) => {
          const filePath = `${skillDir}/${file.path}`;
          const lastSlash = filePath.lastIndexOf("/");
          const parentDir = filePath.substring(0, lastSlash);
          if (parentDir !== skillDir) {
            await sandbox.commands.run(`mkdir -p "${parentDir}"`);
          }
          await sandbox.files.write(filePath, file.content);
        }),
      );

      written.push(entry.slug);
    }),
  );

  return written;
}

export function getSkillsSystemPrompt(skillNames: string[]): string {
  if (skillNames.length === 0) {
    return "";
  }

  return `
# Custom Skills

You have access to custom skills in /app/.opencode/skills/. Each skill directory contains:
- A SKILL.md file with instructions
- Any associated documents (PDFs, images, etc.) at the same level

Available skills:
${skillNames.map((name) => `- ${name}`).join("\n")}

Read the SKILL.md file in each skill directory when relevant to the user's request.
`;
}

export function getIntegrationSkillsSystemPrompt(skillSlugs: string[]): string {
  if (skillSlugs.length === 0) {
    return "";
  }

  return `
# Community Integration Skills

Use community integration skills for these slugs (preferred over official skill variants):
${skillSlugs.map((slug) => `- ${slug}`).join("\n")}

Community files are available in:
/app/.opencode/integration-skills/<slug>/

When a slug is listed above, prioritize that community skill's SKILL.md and resources for that integration.
`;
}

function wrapE2BSession(
  session: Awaited<ReturnType<typeof getOrCreateE2BSession>>,
): OpenCodeSessionResult {
  return {
    client: session.client,
    sessionId: session.sessionId,
    sessionSource: session.sessionSource,
    sandbox: {
      provider: "e2b",
      sandboxId: session.sandbox.sandboxId,
      commands: {
        run: async (command, opts) => {
          const result = await session.sandbox.commands.run(command, {
            timeoutMs: opts?.timeoutMs,
            envs: opts?.envs,
            background: opts?.background,
            onStderr: opts?.onStderr,
          });
          return {
            exitCode: result.exitCode ?? 0,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
          };
        },
      },
      files: {
        write: async (path, content) => {
          await session.sandbox.files.write(path, content);
        },
        read: async (path) => session.sandbox.files.read(path),
      },
      teardown: async () => {
        await session.sandbox.kill().catch(() => {});
      },
    },
  };
}

const e2bSessionProvider: OpenCodeSessionProvider = {
  async getOrCreateSession(config, options) {
    const session = await getOrCreateE2BSession(config, options);
    return wrapE2BSession(session);
  },
};

const daytonaSessionProvider: OpenCodeSessionProvider = {
  getOrCreateSession: getOrCreateDaytonaSession,
};

const dockerSessionProvider: OpenCodeSessionProvider = {
  getOrCreateSession: getOrCreateDockerSession,
};

function getOpenCodeSessionProvider(
  provider: "e2b" | "daytona" | "docker",
): OpenCodeSessionProvider {
  if (provider === "daytona") {
    return daytonaSessionProvider;
  }
  if (provider === "docker") {
    return dockerSessionProvider;
  }
  return e2bSessionProvider;
}
