import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { env } from "../../env";
import {
  getDaytonaClientConfig,
  getDaytonaSandboxLifecycleIntervals,
  listDaytonaSandboxPages,
  type DaytonaListedSandbox,
} from "./daytona";
import {
  createSandboxRuntimeClient,
  getSandboxReadinessUrl,
  getSandboxServerPort,
  getSandboxServerBackgroundStartCommand,
  resolveSandboxAgentRuntimeForModel,
} from "./opencode-runtime";
import { injectProviderAuth } from "./provider-auth-injection";
import { conversationRuntimeService } from "../services/conversation-runtime-service";
import type {
  OpenCodeSandbox,
  OpenCodeSandboxInitResult,
  OpenCodeSessionConfig,
  OpenCodeSessionOptions,
  SessionInitLifecycleCallback,
} from "./opencode-session-types";
import {
  appendDaytonaAuth,
  buildSandboxBootstrapEnv,
  escapeShell,
  getConversationRuntimeState,
  sleep,
  waitForConfiguredModel,
  waitForServer,
  waitForServerHealth,
} from "./opencode-session-support";

const DEFAULT_DAYTONA_SNAPSHOT = "bap-agent-dev";
const DAYTONA_CREATE_TIMEOUT_SECONDS = 30;
const DAYTONA_CREATE_MAX_ATTEMPTS = 2;
const DAYTONA_CREATE_RETRY_DELAY_MS = 1_000;

export type DaytonaSandboxLike = {
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
  list: (...args: unknown[]) => unknown;
};

function buildDaytonaSandboxLabels(config: OpenCodeSessionConfig): Record<string, string> {
  return {
    "bap-conversation-id": config.conversationId,
    ...(config.generationId ? { "bap-generation-id": config.generationId } : {}),
    ...(config.userId ? { "bap-user-id": config.userId } : {}),
  };
}

function buildDaytonaSandboxCreateParams(config: OpenCodeSessionConfig): Record<string, unknown> {
  const lifecycleIntervals = getDaytonaSandboxLifecycleIntervals();
  return {
    snapshot: env.E2B_DAYTONA_SANDBOX_NAME || DEFAULT_DAYTONA_SNAPSHOT,
    envVars: buildSandboxBootstrapEnv(config),
    labels: buildDaytonaSandboxLabels(config),
    autoStopInterval: lifecycleIntervals.autoStopInterval,
    autoDeleteInterval: lifecycleIntervals.autoDeleteInterval,
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

async function createAuthenticatedDaytonaClient(input: {
  baseUrl: string;
  config: OpenCodeSessionConfig;
  token?: string;
}): Promise<OpencodeClient> {
  const client = await createDaytonaOpencodeClient(
    input.baseUrl,
    input.config.model,
    input.token,
  );

  if (
    input.config.userId &&
    resolveSandboxAgentRuntimeForModel(input.config.model) === "opencode"
  ) {
    await injectProviderAuth(client, input.config.userId, {
      openAIAuthSource: input.config.openAIAuthSource,
      logPrefix: "[Daytona]",
    });
  }

  await waitForConfiguredModel(input.baseUrl, input.config.model, input.token);
  return client;
}

export function wrapDaytonaSandbox(sandbox: DaytonaSandboxLike): OpenCodeSandbox {
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

export async function getOrCreateDaytonaSandbox(
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
      const client = await createAuthenticatedDaytonaClient({
        baseUrl,
        config,
        token: preview.token,
      });
      onLifecycle?.("sandbox_reused", {
        conversationId: config.conversationId,
        sandboxId: fromConversation.id,
      });
      return {
        sandbox: wrapDaytonaSandbox(fromConversation),
        client,
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

  await waitForServerHealth(baseUrl, config.model, preview.token);
  const client = await createAuthenticatedDaytonaClient({
    baseUrl,
    config,
    token: preview.token,
  });

  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    serverUrl: preview.url,
  });

  return {
    sandbox: wrapDaytonaSandbox(created),
    client,
    reused: false,
  };
}

async function ensureDaytonaAgentReady(
  sandbox: DaytonaSandboxLike,
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
  init?: { freshSandbox?: boolean },
): Promise<OpencodeClient> {
  const onLifecycle = options?.onLifecycle;
  const preview = await sandbox.getPreviewLink(getSandboxServerPort(config.model));
  const baseUrl = preview.url;

  const startServerAndWait = async () => {
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
    await waitForServerHealth(baseUrl, config.model, preview.token);
  };

  if (init?.freshSandbox) {
    // The sandbox entrypoint already starts the agent server on boot; poll
    // readiness instead of racing it with a duplicate process. Fall back to a
    // manual start if it never comes up (e.g. stale image without entrypoint).
    onLifecycle?.("opencode_waiting_ready", {
      conversationId: config.conversationId,
      sandboxId: sandbox.id,
      serverUrl: preview.url,
    });
    try {
      await waitForServerHealth(baseUrl, config.model, preview.token, 10_000);
    } catch {
      await startServerAndWait();
    }
  } else {
    const health = await fetch(
      appendDaytonaAuth(getSandboxReadinessUrl(baseUrl, config.model), preview.token),
      { method: "GET" },
    ).catch(() => null);
    if (!health?.ok) {
      await startServerAndWait();
    }
  }

  const client = await createAuthenticatedDaytonaClient({
    baseUrl,
    config,
    token: preview.token,
  });

  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: sandbox.id,
    serverUrl: preview.url,
  });

  return client;
}

export async function getOrCreateDaytonaSandboxInit(
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
        await ensureDaytonaAgentReady(fromConversation, config, options, { freshSandbox: false }),
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
      await ensureDaytonaAgentReady(created, config, options, { freshSandbox: true }),
  };
}
