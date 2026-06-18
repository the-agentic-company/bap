import { Sandbox } from "e2b";
import { env } from "../../../env";
import { conversationRuntimeService } from "../../services/conversation-runtime-service";
import { logger, type ObservabilityContext } from "../../utils/observability";
import {
  createSandboxRuntimeClient,
  getSandboxReadinessUrl,
  getSandboxServerPort,
} from "../opencode-runtime";
import {
  DEFAULT_SANDBOX_MODEL,
  SANDBOX_TIMEOUT_MS,
  TEMPLATE_NAME,
  applySandboxTimeout,
  connectSandboxById,
  formatErrorMessage,
  getConversationRuntimeState,
  logLifecycle,
  resolveSandboxAppUrl,
  type SandboxConfig,
  type SandboxState,
  type SessionInitLifecycleCallback,
} from "./runtime";

/**
 * Build the OpenCode server URL a connected sandbox exposes for a given model.
 */
function buildServerUrl(sandbox: Sandbox, model: string): string {
  const serverPort = getSandboxServerPort(model);
  return `https://${sandbox.getHost(serverPort)}`;
}

/**
 * Connect to a known sandbox, confirm its OpenCode server answers a readiness
 * probe, and hydrate a runtime client for it. Returns the live SandboxState,
 * or null when the sandbox cannot be reached or is not healthy. This is the
 * single place the "connect -> serverUrl -> health probe -> client" sequence
 * lives; both reuse paths (provisioning and durable lookup) go through it.
 */
async function connectHealthyRuntime(
  sandboxId: string,
  model: string,
): Promise<SandboxState | null> {
  const connected = await connectSandboxById(sandboxId);
  if (!connected) {
    return null;
  }
  const serverUrl = buildServerUrl(connected, model);
  const health = await fetch(getSandboxReadinessUrl(serverUrl, model), {
    method: "GET",
  }).catch(() => null);
  if (!health?.ok) {
    return null;
  }
  const client = await createSandboxRuntimeClient({ serverUrl, model });
  return { sandbox: connected, client, serverUrl, reused: true };
}

/**
 * Create a fresh E2B sandbox VM for a conversation: provision it with the
 * conversation's secrets, apply the active timeout, and persist SANDBOX_ID into
 * the guest shell so the in-sandbox plugin can read it back. Emits the
 * VM_START_REQUESTED / VM_STARTED lifecycle log pair and the matching
 * onLifecycle callbacks. Throws (after logging VM_START_FAILED) when creation
 * fails. This concentrates the provisioning sequence shared by the bare and
 * full sandbox factories.
 */
async function createSandboxVm(
  config: SandboxConfig,
  telemetryContext: ObservabilityContext,
  onLifecycle: SessionInitLifecycleCallback | undefined,
): Promise<Sandbox> {
  const hasApiKey = !!config.anthropicApiKey;
  const vmCreateStart = Date.now();
  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: TEMPLATE_NAME,
  });
  logLifecycle(
    "VM_START_REQUESTED",
    {
      conversationId: config.conversationId,
      template: TEMPLATE_NAME,
      hasAnthropicApiKey: hasApiKey,
      timeoutMs: SANDBOX_TIMEOUT_MS,
    },
    telemetryContext,
  );

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create(TEMPLATE_NAME, {
      metadata: {
        conversationId: config.conversationId,
        userId: config.userId || "",
      },
      envs: {
        ANTHROPIC_API_KEY: config.anthropicApiKey,
        ANVIL_API_KEY: env.ANVIL_API_KEY || "",
        APP_URL: resolveSandboxAppUrl(),
        APP_SERVER_SECRET: env.APP_SERVER_SECRET || "",
        CONVERSATION_ID: config.conversationId,
        ...config.integrationEnvs,
      },
      timeoutMs: SANDBOX_TIMEOUT_MS,
      lifecycle: {
        onTimeout: "kill",
        autoResume: false,
      },
    });
    await applySandboxTimeout(sandbox);
  } catch (error) {
    logger.error({
      event: "VM_START_FAILED",
      ...telemetryContext,
      ...{
        conversationId: config.conversationId,
        template: TEMPLATE_NAME,
        durationMs: Date.now() - vmCreateStart,
        error: formatErrorMessage(error),
        hasAnthropicApiKey: hasApiKey,
        hasE2BApiKey: Boolean(env.E2B_API_KEY),
        integrationEnvCount: Object.keys(config.integrationEnvs || {}).length,
      },
    });
    throw error;
  }
  logLifecycle(
    "VM_STARTED",
    {
      conversationId: config.conversationId,
      sandboxId: sandbox.sandboxId,
      template: TEMPLATE_NAME,
      durationMs: Date.now() - vmCreateStart,
    },
    { ...telemetryContext, sandboxId: sandbox.sandboxId },
  );
  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: sandbox.sandboxId,
    durationMs: Date.now() - vmCreateStart,
  });

  // Set SANDBOX_ID env var (needed by plugin)
  try {
    await sandbox.commands.run(`echo "export SANDBOX_ID=${sandbox.sandboxId}" >> ~/.bashrc`);
  } catch (error) {
    logger.warn({
      event: "VM_SET_SANDBOX_ID_FAILED",
      ...{ ...telemetryContext, sandboxId: sandbox.sandboxId },
      ...{
        conversationId: config.conversationId,
        sandboxId: sandbox.sandboxId,
        error: formatErrorMessage(error),
      },
    });
  }

  return sandbox;
}

function buildTelemetryContext(
  config: SandboxConfig,
  telemetry: ObservabilityContext | undefined,
): ObservabilityContext {
  return {
    ...telemetry,
    source: "e2b",
    conversationId: config.conversationId,
    userId: config.userId,
  };
}

/**
 * Get or create a sandbox without waiting for the OpenCode runtime to be ready.
 */
export async function getOrCreateBareSandbox(
  config: SandboxConfig,
  onLifecycle?: SessionInitLifecycleCallback,
  telemetry?: ObservabilityContext,
): Promise<{
  sandbox: Sandbox;
  reused: boolean;
}> {
  const telemetryContext = buildTelemetryContext(config, telemetry);
  onLifecycle?.("sandbox_checking_cache", {
    conversationId: config.conversationId,
  });

  const runtimeState = await getConversationRuntimeState(config.conversationId);

  if (runtimeState?.sandboxId) {
    const connected = await connectSandboxById(runtimeState.sandboxId);
    if (connected) {
      onLifecycle?.("sandbox_reused", {
        conversationId: config.conversationId,
        sandboxId: connected.sandboxId,
      });
      return {
        sandbox: connected,
        reused: true,
      };
    }

    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
  }

  const sandbox = await createSandboxVm(config, telemetryContext, onLifecycle);
  return { sandbox, reused: false };
}

/**
 * Get or create a sandbox with OpenCode server running inside.
 */
export async function getOrCreateSandbox(
  config: SandboxConfig,
  onLifecycle?: SessionInitLifecycleCallback,
  telemetry?: ObservabilityContext,
): Promise<SandboxState> {
  const telemetryContext = buildTelemetryContext(config, telemetry);
  onLifecycle?.("sandbox_checking_cache", {
    conversationId: config.conversationId,
  });

  const runtimeState = await getConversationRuntimeState(config.conversationId);

  if (runtimeState?.sandboxId) {
    const healthy = await connectHealthyRuntime(runtimeState.sandboxId, config.model);
    if (healthy) {
      onLifecycle?.("sandbox_reused", {
        conversationId: config.conversationId,
        sandboxId: healthy.sandbox.sandboxId,
      });
      return healthy;
    }

    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
  }

  const sandbox = await createSandboxVm(config, telemetryContext, onLifecycle);
  const serverUrl = buildServerUrl(sandbox, config.model);

  // Create SDK client pointing to sandbox's OpenCode server
  const client = await createSandboxRuntimeClient({ serverUrl, model: config.model });
  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: sandbox.sandboxId,
    serverUrl,
  });
  return { sandbox, client, serverUrl, reused: false };
}

/**
 * Get the OpenCode client for a conversation's existing sandbox, hydrating it
 * from the persisted runtime row. Returns undefined when no live, healthy
 * sandbox is available (and marks the runtime dead so the next caller recreates
 * it).
 */
export async function getSandboxStateDurable(
  conversationId: string,
): Promise<SandboxState | undefined> {
  const runtimeState = await getConversationRuntimeState(conversationId);
  if (!runtimeState?.sandboxId) {
    return undefined;
  }
  const model = runtimeState.model ?? DEFAULT_SANDBOX_MODEL;

  const healthy = await connectHealthyRuntime(runtimeState.sandboxId, model);
  if (healthy) {
    return healthy;
  }

  await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
  return undefined;
}
