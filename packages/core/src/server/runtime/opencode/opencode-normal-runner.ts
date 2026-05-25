import { db } from "@cmdclaw/db/client";
import { conversation } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { env } from "../../../env";
import { splitCoworkerAllowedSkillSlugs } from "../../../lib/coworker-tool-policy";
import { parseModelReference } from "../../../lib/model-reference";
import type { RuntimeContextFile } from "../../../lib/runtime-context";
import {
  stageExecutorPrePrompt,
  ExecutorPromptReadyError,
} from "../../execution/executor-preprompt";
import type { ExecutionEnvironmentSession } from "../../execution/execution-environment";
import { stagePrePromptAssets } from "../../execution/pre-prompt-assets";
import { stageRuntimePromptAttachments } from "../../execution/prompt-attachments";
import {
  writeRuntimeContextToSandbox,
  writeRuntimeEnvToSandbox,
} from "../../execution/runtime-context";
import { resolveRuntimeEnvironmentForTurn } from "../../execution/runtime-env";
import { composeOpencodePromptSpec } from "../../prompts/opencode-runtime-prompt";
import {
  isOpaqueDiagnosticMessage,
  resolveOpenCodePromptCompletion,
  waitForOpenCodeTerminalStateAfterEarlyStreamEnd,
} from "./opencode-runtime-driver";
import type {
  RuntimeHarnessClient,
  RuntimeMcpServer,
  RuntimePromptPart,
  RuntimeSelection,
  SandboxHandle,
} from "../../sandbox/core/types";
import { getOrCreateConversationSandbox } from "../../sandbox/core/orchestrator";
import {
  buildMemorySystemPrompt,
  syncMemoryFilesToSandbox,
} from "../../sandbox/prep/memory-prep";
import {
  getIntegrationSkillsSystemPrompt,
  getSkillsSystemPrompt,
} from "../../sandbox/prep/skills-prep";
import { logServerEvent } from "../../utils/observability";
import type {
  GenerationCompletionReason,
  RuntimeFailureClassification,
} from "../../services/lifecycle-policy";
import { generationLifecyclePolicy } from "../../services/lifecycle-policy";
import { GenerationSuspendedError } from "../../services/generation/core/turn-suspension";
import { buildOpencodePromptSpecInputForContext } from "../../services/generation/prompts/opencode-prompt-context";
import type {
  GenerationContext,
  GenerationEvent,
  GenerationStatus,
  RemoteRunDebugPhase,
} from "../../services/generation/types";
import type { OpenCodeTurnEventBridge } from "./opencode-turn-events";
import { captureRuntimeNoProgressDiagnosticSnapshot } from "../../services/runtime-diagnostic-snapshot-service";

const OPENCODE_EARLY_STREAM_REATTACH_ATTEMPTS = 2;
const OPENCODE_EARLY_STREAM_REATTACH_WAIT_MS = 8_000;
const OPENCODE_STATUS_POLL_INTERVAL_MS = 500;
const RUNTIME_NO_PROGRESS_USER_MESSAGE =
  "The runtime stopped responding before producing any output. Please retry.";

type TerminalGenerationStatus = Extract<
  GenerationStatus,
  "completed" | "cancelled" | "error"
>;

type NormalRunnerCallbacks = {
  bootstrapTimeoutMs: number;
  opencodeTurnEvents: OpenCodeTurnEventBridge;
  refreshCancellationSignal: (
    ctx: GenerationContext,
    options?: { force?: boolean },
  ) => Promise<boolean>;
  finishGeneration: (
    ctx: GenerationContext,
    status: TerminalGenerationStatus,
  ) => Promise<void>;
  setCompletionReason: (
    ctx: GenerationContext,
    reason: GenerationCompletionReason | null | undefined,
  ) => void;
  ensureRemoteRunDebugInfo: (ctx: GenerationContext) => void;
  recordRemoteRunPhase: (
    ctx: GenerationContext,
    phase: RemoteRunDebugPhase,
    patch?: Record<string, unknown>,
  ) => void;
  markPhase: (ctx: GenerationContext, phase: string) => void;
  broadcast: (ctx: GenerationContext, event: GenerationEvent) => void;
  bindRuntimeSandboxToContext: (
    ctx: GenerationContext,
    input: {
      runtimeSandbox: SandboxHandle;
      runtimeMetadata?: RuntimeSelection;
      executionEnvironment?: ExecutionEnvironmentSession["environment"];
    },
  ) => Promise<void>;
  bindRuntimeSessionToContext: (
    ctx: GenerationContext,
    input: {
      runtimeSandbox: SandboxHandle;
      runtimeMetadata?: RuntimeSelection;
      executionEnvironment?: ExecutionEnvironmentSession["environment"];
      sessionId: string;
    },
  ) => Promise<void>;
  persistRuntimeSessionBinding: (
    ctx: GenerationContext,
    input: {
      runtimeMetadata?: RuntimeSelection;
      sessionId: string;
    },
  ) => Promise<void>;
  setSnapshotRestoreAllowance: (
    ctx: GenerationContext,
    allowed: boolean,
  ) => Promise<void>;
  getRemainingRunTimeMs: (ctx: Pick<GenerationContext, "deadlineAt">) => number;
  parkGenerationForRunDeadline: (
    ctx: GenerationContext,
    runtimeClient?: RuntimeHarnessClient,
  ) => Promise<void>;
  startExternalInterruptPolling: (ctx: GenerationContext) => void;
  stopExternalInterruptPolling: (ctx: GenerationContext) => void;
  pollExternalInterruptAndSuspendIfNeeded: (
    ctx: GenerationContext,
  ) => Promise<void>;
  awaitPromiseUntilRunDeadline: <T>(
    ctx: Pick<GenerationContext, "deadlineAt">,
    promise: Promise<T>,
  ) => Promise<{ type: "resolved"; value: T } | { type: "timed_out" }>;
  scheduleSave: (ctx: GenerationContext) => void;
  importIntegrationSkillDraftsFromSandbox: (
    ctx: GenerationContext,
  ) => Promise<void>;
  captureUsageFromRuntimeSession: (
    ctx: GenerationContext,
    runtimeClient: RuntimeHarnessClient,
    sessionId: string,
  ) => Promise<void>;
  captureOriginalError: (
    ctx: GenerationContext,
    error: unknown,
    input: { phase?: string; runtimeFailure?: RuntimeFailureClassification },
  ) => void;
  getCurrentPhase: (ctx: GenerationContext) => string | null;
  resolveRuntimeFailure: (
    ctx: GenerationContext,
    runtimeClient?: RuntimeHarnessClient,
  ) => Promise<RuntimeFailureClassification>;
  scheduleRecoveryReattach: (ctx: GenerationContext) => void;
  turnFinalizer: {
    collectAndExposeMentionedSandboxFiles: (
      ctx: GenerationContext,
      input: {
        summaryMessage: (input: {
          discoveredCount: number;
          exposedCount: number;
        }) => string;
        collectionErrorMessage: string;
        uploadErrorMessage: (filePath: string) => string;
      },
    ) => Promise<number>;
  };
};

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message = extractStructuredErrorMessage(error);
    if (message) {
      return message;
    }
    const json = safeJsonStringify(error);
    if (json) {
      return json;
    }
  }
  return String(error);
}

function extractStructuredErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error;
  }

  const nestedCandidates = [record.error, record.data, record.details];
  for (const candidate of nestedCandidates) {
    const nested = extractStructuredErrorMessage(candidate);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function safeJsonStringify(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

function isBootstrapTimeoutError(error: unknown): boolean {
  return formatErrorMessage(error).startsWith(
    "Error: Agent preparation timed out after ",
  );
}

function resolveRuntimeNoProgressTimeoutMs(ctx: GenerationContext): number {
  const override = ctx.executionPolicy.debugRuntimeNoProgressTimeoutMs;
  if (override === undefined) {
    return generationLifecyclePolicy.runtimeNoProgressAfterPromptMs;
  }
  if (
    !Number.isInteger(override) ||
    override < 1_000 ||
    override > generationLifecyclePolicy.runtimeNoProgressAfterPromptMs
  ) {
    throw new Error(
      `debugRuntimeNoProgressTimeoutMs must be an integer between 1000 and ${generationLifecyclePolicy.runtimeNoProgressAfterPromptMs}`,
    );
  }
  return override;
}

export class OpenCodeNormalRunner {
  constructor(private readonly callbacks: NormalRunnerCallbacks) {}

  async run(ctx: GenerationContext): Promise<void> {
    let promptTimeoutTriggered = false;
    let runtimeNoProgressTriggered = false;
    let clearPromptTimeout: (() => void) | undefined;
    let clearRuntimeNoProgressTimeout: (() => void) | undefined;
    let client: RuntimeHarnessClient | undefined;
    try {
      if (
        await this.callbacks.refreshCancellationSignal(ctx, { force: true })
      ) {
        await this.callbacks.finishGeneration(ctx, "cancelled");
        return;
      }

      if (
        parseModelReference(ctx.model).providerID === "anthropic" &&
        !env.ANTHROPIC_API_KEY
      ) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
      }

      const { customSkillNames } = splitCoworkerAllowedSkillSlugs(
        ctx.allowedSkillSlugs ?? [],
      );
      this.callbacks.ensureRemoteRunDebugInfo(ctx);
      const {
        allowedIntegrations,
        cliInstructions,
        integrationEnvs,
        sandboxRuntimeEnv,
        userTimezone,
      } = await resolveRuntimeEnvironmentForTurn(
        {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          allowedIntegrations: ctx.allowedIntegrations,
          remoteIntegrationSource: ctx.remoteIntegrationSource,
        },
        {
          onRemoteCredentialsAttached: ({
            remoteUserEmail,
            allowedIntegrations,
            attachedTokenEnvVarNames,
          }) => {
            if (!ctx.remoteIntegrationSource) {
              return;
            }
            logServerEvent(
              "info",
              "REMOTE_INTEGRATION_CREDENTIALS_ATTACHED",
              {
                targetEnv: ctx.remoteIntegrationSource.targetEnv,
                remoteUserId: ctx.remoteIntegrationSource.remoteUserId,
                remoteUserEmail,
                allowedIntegrations: [...allowedIntegrations].toSorted(),
                attachedTokenEnvVarNames,
              },
              {
                source: "generation-manager",
                traceId: ctx.traceId,
                generationId: ctx.id,
                conversationId: ctx.conversationId,
                userId: ctx.userId,
              },
            );
            this.callbacks.recordRemoteRunPhase(
              ctx,
              "remote_credentials_fetched",
              {
                attachedTokenEnvVarNames,
              },
            );
          },
        },
      );

      // Get conversation for existing session info
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, ctx.conversationId),
      });

      // Determine if we need to replay history (existing conversation)
      const hasExistingMessages = !ctx.isNewConversation;

      const initDeadlineAt = Date.now() + this.callbacks.bootstrapTimeoutMs;
      const buildPreparingTimeoutMessage = () =>
        `Agent preparation timed out after ${Math.round(this.callbacks.bootstrapTimeoutMs / 1000)} seconds.`;
      const remainingPreparingTimeoutMs = () =>
        Math.max(1, initDeadlineAt - Date.now());
      const initWarnAfterMs = 15_000;

      let sessionId: string | undefined;
      let runtimeSandbox: SandboxHandle;
      let runtimeMetadata: RuntimeSelection | undefined;
      let runtimeInit: Awaited<ReturnType<typeof getOrCreateConversationSandbox>>;

      ctx.agentSandboxReadyAt = undefined;
      ctx.agentSandboxMode = undefined;
      this.callbacks.markPhase(ctx, "sandbox_init_started");
      this.callbacks.broadcast(ctx, {
        type: "status_change",
        status: "sandbox_init_started",
      });
      logServerEvent(
        "info",
        "SANDBOX_INIT_STARTED",
        {},
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );
      const sandboxInitWarnTimer = setTimeout(() => {
        const elapsedMs =
          this.callbacks.bootstrapTimeoutMs - remainingPreparingTimeoutMs();
        logServerEvent(
          "warn",
          "SANDBOX_INIT_SLOW",
          { elapsedMs },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
      }, initWarnAfterMs);

      try {
        runtimeInit = await withTimeout(
          getOrCreateConversationSandbox(
            {
              conversationId: ctx.conversationId,
              generationId: ctx.id,
              userId: ctx.userId,
              model: ctx.model,
              openAIAuthSource: ctx.authSource,
              anthropicApiKey: env.ANTHROPIC_API_KEY || "",
              integrationEnvs,
            },
            {
              sandboxProviderOverride: ctx.sandboxProviderOverride,
              title: conv?.title || "Conversation",
              replayHistory: hasExistingMessages,
              allowSnapshotRestore:
                ctx.executionPolicy.allowSnapshotRestoreOnRun !== false,
              telemetry: {
                source: "generation-manager",
                traceId: ctx.traceId,
                generationId: ctx.id,
                conversationId: ctx.conversationId,
                userId: ctx.userId,
              },
              onLifecycle: (stage: string, details: Record<string, unknown> | undefined) => {
                const status = stage.startsWith("sandbox_")
                  ? `sandbox_init_${stage.slice("sandbox_".length)}`
                  : `agent_init_${stage}`;
                this.callbacks.markPhase(ctx, status);
                if (stage === "sandbox_created") {
                  ctx.agentSandboxReadyAt = Date.now();
                  ctx.agentSandboxMode = "created";
                } else if (stage === "sandbox_reused") {
                  ctx.agentSandboxReadyAt = Date.now();
                  ctx.agentSandboxMode = "reused";
                }
                this.callbacks.broadcast(ctx, {
                  type: "status_change",
                  status,
                });
                logServerEvent("info", status.toUpperCase(), details ?? {}, {
                  source: "generation-manager",
                  traceId: ctx.traceId,
                  generationId: ctx.id,
                  conversationId: ctx.conversationId,
                  userId: ctx.userId,
                });
              },
            },
          ),
          remainingPreparingTimeoutMs(),
          buildPreparingTimeoutMessage(),
        );
        runtimeSandbox = runtimeInit.sandbox;
        runtimeMetadata = runtimeInit.metadata as RuntimeSelection | undefined;
      } catch (error) {
        this.callbacks.markPhase(ctx, "sandbox_init_failed");
        this.callbacks.broadcast(ctx, {
          type: "status_change",
          status: "sandbox_init_failed",
        });
        logServerEvent(
          "error",
          "SANDBOX_INIT_FAILED",
          {
            error:
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error),
          },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
        throw error;
      } finally {
        clearTimeout(sandboxInitWarnTimer);
      }

      await this.callbacks.bindRuntimeSandboxToContext(ctx, {
        runtimeSandbox,
        runtimeMetadata,
        executionEnvironment: undefined,
      });
      if (ctx.remoteIntegrationSource) {
        this.callbacks.recordRemoteRunPhase(ctx, "sandbox_created");
      }
      await this.callbacks.setSnapshotRestoreAllowance(ctx, false);

      const agentInitStartedAt = Date.now();
      ctx.agentInitStartedAt = agentInitStartedAt;
      ctx.agentInitReadyAt = undefined;
      ctx.agentInitFailedAt = undefined;
      this.callbacks.markPhase(ctx, "agent_init_started");
      this.callbacks.broadcast(ctx, {
        type: "status_change",
        status: "agent_init_started",
      });
      logServerEvent(
        "info",
        "AGENT_INIT_STARTED",
        {},
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
      );
      const agentInitWarnTimer = setTimeout(() => {
        const elapsedMs = Date.now() - agentInitStartedAt;
        logServerEvent(
          "warn",
          "AGENT_INIT_SLOW",
          { elapsedMs },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
      }, initWarnAfterMs);

      let resolveExecutorSessionMcpServers: (
        value: RuntimeMcpServer[] | undefined,
      ) => void = () => {};
      let rejectExecutorSessionMcpServers: (
        reason?: unknown,
      ) => void = () => {};
      const executorSessionMcpServersPromise: Promise<
        RuntimeMcpServer[] | undefined
      > =
        runtimeMetadata?.runtimeHarness === "opencode"
          ? new Promise((resolve, reject) => {
              resolveExecutorSessionMcpServers = resolve;
              rejectExecutorSessionMcpServers = reject;
            })
          : Promise.resolve(undefined);

      const runtimeSessionPromise = (async () => {
        try {
          const sessionMcpServers = await executorSessionMcpServersPromise;
          const session = await withTimeout(
            runtimeInit.completeAgentInit({ sessionMcpServers }),
            remainingPreparingTimeoutMs(),
            buildPreparingTimeoutMessage(),
          );
          client = session.harnessClient;
          sessionId = session.session.id;
          await this.callbacks.persistRuntimeSessionBinding(ctx, {
            runtimeMetadata,
            sessionId,
          });
          ctx.agentInitReadyAt = Date.now();
          this.callbacks.markPhase(ctx, "agent_init_ready");
          this.callbacks.broadcast(ctx, {
            type: "status_change",
            status: "agent_init_ready",
            metadata: {
              runtimeId: ctx.runtimeId,
              sandboxProvider: runtimeMetadata?.sandboxProvider,
              runtimeHarness: runtimeMetadata?.runtimeHarness,
              runtimeProtocolVersion: runtimeMetadata?.runtimeProtocolVersion,
              sandboxId: runtimeSandbox.sandboxId,
              sessionId,
            },
          });
          logServerEvent(
            "info",
            "AGENT_INIT_READY",
            {
              durationMs: ctx.agentInitReadyAt - agentInitStartedAt,
              sandboxProvider: runtimeMetadata?.sandboxProvider,
              runtimeHarness: runtimeMetadata?.runtimeHarness,
              runtimeProtocolVersion: runtimeMetadata?.runtimeProtocolVersion,
            },
            {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              sessionId,
              sandboxId: runtimeSandbox.sandboxId,
            },
          );
        } catch (error) {
          ctx.agentInitFailedAt = Date.now();
          this.callbacks.markPhase(ctx, "agent_init_failed");
          this.callbacks.broadcast(ctx, {
            type: "status_change",
            status: "agent_init_failed",
          });
          logServerEvent(
            "error",
            "AGENT_INIT_FAILED",
            {
              durationMs: ctx.agentInitFailedAt - agentInitStartedAt,
              error:
                error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : String(error),
            },
            {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
            },
          );
          throw error;
        } finally {
          clearTimeout(agentInitWarnTimer);
        }
      })();

      // Record marker time for file collection and store sandbox reference
      ctx.generationMarkerTime = Date.now();
      ctx.sentFilePaths = new Set();
      ctx.userStagedFilePaths = new Set();
      this.callbacks.markPhase(ctx, "pre_prompt_setup_started");
      const prePromptStartedAt = Date.now();
      const prePromptBreakdown: Record<string, number> = {};
      const markPrePromptStep = (step: string, startedAt: number) => {
        prePromptBreakdown[step] = Date.now() - startedAt;
      };
      const markPrePromptPhase = (
        step: string,
        status: "started" | "completed",
      ) => {
        this.callbacks.markPhase(ctx, `pre_prompt_${step}_${status}`);
      };
      const runPrePromptStep = async <T>(
        step: string,
        metricKey: string,
        action: () => Promise<T>,
      ): Promise<T> => {
        markPrePromptPhase(step, "started");
        const startedAt = Date.now();
        try {
          return await action();
        } finally {
          markPrePromptStep(metricKey, startedAt);
          markPrePromptPhase(step, "completed");
        }
      };

      let memoryInstructions = buildMemorySystemPrompt();
      let executorInstructions: string | null = null;
      let enabledSkillRows: Array<{ name: string; updatedAt: Date }> = [];
      let writtenSkills: string[] = [];
      let writtenIntegrationSkills: string[] = [];
      let prePromptCacheHit = false;
      let startPostPromptCacheWrite: (() => Promise<void>) | null = null;

      const memorySyncPromise = (async () => {
        try {
          await runPrePromptStep(
            "memory_sync",
            "syncMemoryFilesToSandboxMs",
            async () => {
              await syncMemoryFilesToSandbox(ctx.userId, runtimeSandbox);
            },
          );
        } catch (err) {
          console.error(
            "[GenerationManager] Failed to sync memory to sandbox:",
            err,
          );
          memoryInstructions = buildMemorySystemPrompt();
        }
      })();

      const runtimeContextWritePromise = (async () => {
        try {
          await runPrePromptStep(
            "runtime_context_write",
            "writeRuntimeContextMs",
            async () => {
              if (
                ctx.runtimeId &&
                ctx.runtimeCallbackToken &&
                ctx.runtimeTurnSeq
              ) {
                const runtimeContext: RuntimeContextFile = {
                  runtimeId: ctx.runtimeId,
                  turnSeq: ctx.runtimeTurnSeq,
                  callbackToken: ctx.runtimeCallbackToken,
                  updatedAt: new Date().toISOString(),
                };
                await writeRuntimeContextToSandbox(
                  runtimeSandbox,
                  runtimeContext,
                );
              }
              await writeRuntimeEnvToSandbox(runtimeSandbox, sandboxRuntimeEnv);
            },
          );
        } catch (error) {
          console.error(
            "[GenerationManager] Failed to write runtime metadata to sandbox:",
            error,
          );
        }
      })();

      const executorPreparePromise = (async (): Promise<
        () => Promise<void>
      > => {
        const preparedExecutor = await stageExecutorPrePrompt({
          runtimeSandbox,
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          allowedExecutorSourceIds: ctx.allowedExecutorSourceIds,
          runtimeId: ctx.runtimeId,
          reuseExistingState: ctx.agentSandboxMode === "reused",
          prerequisites: [runtimeContextWritePromise, memorySyncPromise],
          resolveSessionMcpServers: resolveExecutorSessionMcpServers,
          rejectSessionMcpServers: rejectExecutorSessionMcpServers,
          markPhase: (phase) => this.callbacks.markPhase(ctx, phase),
          recordMetric: (metricName, durationMs) => {
            prePromptBreakdown[metricName] = durationMs;
          },
          logContext: () => ({
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sandboxId: runtimeSandbox.sandboxId,
            sessionId: sessionId ?? ctx.sessionId ?? undefined,
          }),
        });
        executorInstructions = preparedExecutor.instructions;
        return preparedExecutor.runFinalize;
      })();

      const skillAssetPreparePromise = (async () => {
        const preparedAssets = await stagePrePromptAssets({
          runtimeSandbox,
          userId: ctx.userId,
          generationId: ctx.id,
          allowedIntegrations,
          allowedCustomIntegrations: ctx.allowedCustomIntegrations,
          allowedSkillSlugs: ctx.allowedSkillSlugs,
          selectedPlatformSkillSlugs: ctx.selectedPlatformSkillSlugs,
          customSkillNames,
          agentSandboxMode: ctx.agentSandboxMode,
          runStep: runPrePromptStep,
          markPhase: (phase) => this.callbacks.markPhase(ctx, phase),
          recordMetric: (metricName, durationMs) => {
            prePromptBreakdown[metricName] = durationMs;
          },
          logContext: () => ({
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sandboxId: runtimeSandbox.sandboxId,
            sessionId: ctx.sessionId ?? undefined,
          }),
        });
        enabledSkillRows = preparedAssets.enabledSkillRows;
        writtenSkills = preparedAssets.writtenSkills;
        writtenIntegrationSkills = preparedAssets.writtenIntegrationSkills;
        prePromptCacheHit = preparedAssets.prePromptCacheHit;
        startPostPromptCacheWrite = preparedAssets.startPostPromptCacheWrite;
      })();

      const [, , runExecutorPrepareFinalize] = await Promise.all([
        memorySyncPromise,
        runtimeContextWritePromise,
        executorPreparePromise,
        skillAssetPreparePromise,
        runtimeSessionPromise,
      ]);

      if (!sessionId) {
        throw new Error("Runtime session ID is unavailable.");
      }
      if (!client) {
        throw new Error("Runtime harness client is unavailable.");
      }

      await this.callbacks.bindRuntimeSessionToContext(ctx, {
        runtimeSandbox,
        runtimeMetadata,
        sessionId,
      });
      const activeSessionId = sessionId;

      if (writtenSkills.length === 0) {
        writtenSkills = enabledSkillRows.map((entry) => entry.name);
      }
      const skillsInstructions = getSkillsSystemPrompt(writtenSkills);
      const integrationSkillsInstructions = getIntegrationSkillsSystemPrompt(
        writtenIntegrationSkills,
      );

      const promptSpecInput = buildOpencodePromptSpecInputForContext(ctx, {
        cliInstructions,
        executorInstructions,
        skillsInstructions,
        integrationSkillsInstructions,
        memoryInstructions,
        userTimezone,
      });
      const promptSpec = await runPrePromptStep(
        "prompt_spec_compose",
        "composePromptSpecMs",
        async () => composeOpencodePromptSpec(promptSpecInput),
      );
      const runtimeClient = client;

      const verboseOpenCodeEventLogs =
        process.env.OPENCODE_VERBOSE_EVENTS === "1";
      let stagedCoworkerDocumentCount = 0;
      let stagedUploadCount = 0;
      let stagedUploadFailureCount = 0;
      let lastExternalInterruptPollAt = 0;
      let reconciledTerminalIdle = false;

      // Subscribe to SSE events BEFORE sending the prompt
      const promptTimeoutController = new AbortController();
      const eventResult = await runPrePromptStep(
        "event_stream_subscribe",
        "subscribeEventStreamMs",
        async () =>
          await runtimeClient.subscribe(
            {},
            {
              signal: promptTimeoutController.signal,
            },
          ),
      );
      const eventStream = eventResult.stream;

      const parsedModel = parseModelReference(ctx.model);

      // Resolve provider from model reference
      const modelConfig = {
        providerID: parsedModel.providerID,
        modelID: parsedModel.modelID,
      };

      const promptParts: RuntimePromptPart[] = [
        { type: "text", text: ctx.userMessageContent },
      ];
      const stagedPromptAttachments = await stageRuntimePromptAttachments({
        runtimeSandbox,
        coworkerId: ctx.coworkerId,
        attachments: ctx.attachments,
        userStagedFilePaths: ctx.userStagedFilePaths,
        runStep: runPrePromptStep,
        logAttachmentWriteError: (sandboxPath, error) => {
          console.error(
            `[GenerationManager] Failed to write file to sandbox: ${sandboxPath}`,
            error,
          );
        },
      });
      promptParts.push(...stagedPromptAttachments.promptParts);
      stagedCoworkerDocumentCount =
        stagedPromptAttachments.stagedCoworkerDocumentCount;
      stagedUploadCount = stagedPromptAttachments.stagedUploadCount;
      stagedUploadFailureCount =
        stagedPromptAttachments.stagedUploadFailureCount;
      if (
        stagedCoworkerDocumentCount > 0 ||
        stagedUploadCount > 0 ||
        stagedUploadFailureCount > 0
      ) {
        logServerEvent(
          "info",
          "ATTACHMENTS_STAGED",
          {
            stagedCoworkerDocumentCount,
            stagedUploadCount,
            stagedUploadFailureCount,
          },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId: activeSessionId,
          },
        );
      }

      markPrePromptStep("prePromptSetupTotalMs", prePromptStartedAt);
      logServerEvent(
        "info",
        "PRE_PROMPT_BREAKDOWN",
        {
          cacheHit: prePromptCacheHit,
          sandboxMode: ctx.agentSandboxMode ?? "unknown",
          ...prePromptBreakdown,
        },
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          sandboxId: runtimeSandbox.sandboxId,
          sessionId: ctx.sessionId,
        },
      );

      // Send the prompt to OpenCode
      logServerEvent(
        "info",
        "OPENCODE_PROMPT_SENT",
        {},
        {
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          sessionId: activeSessionId,
        },
      );
      if (ctx.remoteIntegrationSource) {
        this.callbacks.recordRemoteRunPhase(ctx, "prompt_sent");
      }
      this.callbacks.markPhase(ctx, "prompt_sent");
      void runExecutorPrepareFinalize();
      if (startPostPromptCacheWrite !== null) {
        void (startPostPromptCacheWrite as () => Promise<void>)();
      }
      const promptSentAtMs = Date.now();
      const remainingRunTimeMs = this.callbacks.getRemainingRunTimeMs(ctx);
      if (remainingRunTimeMs <= 0) {
        await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      const runtimeNoProgressTimeoutMs = resolveRuntimeNoProgressTimeoutMs(ctx);
      const forceRuntimeNoProgress =
        ctx.executionPolicy.debugForceRuntimeNoProgressAfterPrompt === true;
      const promptTimeoutId = setTimeout(() => {
        promptTimeoutTriggered = true;
        promptTimeoutController.abort();
        logServerEvent(
          "error",
          "OPENCODE_PROMPT_TIMEOUT",
          { timeoutMs: remainingRunTimeMs },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId: activeSessionId,
          },
        );
        void runtimeClient
          .abort({ sessionID: activeSessionId })
          .catch((err) => {
            console.error(
              "[GenerationManager] Failed to abort timed out OpenCode session:",
              err,
            );
          });
      }, remainingRunTimeMs);
      clearPromptTimeout = () => {
        clearTimeout(promptTimeoutId);
        clearPromptTimeout = undefined;
      };
      // Guard the in-flight prompt so runtime rejections stay scoped to this generation.
      let promptResultSettled = false;
      const promptResultPromise = runtimeClient
        .prompt({
          sessionID: activeSessionId,
          parts: promptParts,
          agent: promptSpec.agentId,
          system: promptSpec.systemPrompt,
          model: modelConfig,
        })
        .then(
          (data) => {
            promptResultSettled = true;
            return { ok: true as const, data };
          },
          (error) => {
            promptResultSettled = true;
            return { ok: false as const, error };
          },
        );
      this.callbacks.startExternalInterruptPolling(ctx);

      const eventLoop = this.callbacks.opencodeTurnEvents.createEventLoop({
        ctx,
        client: runtimeClient,
        mode: "normal",
        verboseEventLogs: verboseOpenCodeEventLogs,
        pollExternalInterruptAndSuspendIfNeeded: async () => {
          if (Date.now() - lastExternalInterruptPollAt >= 1_000) {
            lastExternalInterruptPollAt = Date.now();
            await this.callbacks.pollExternalInterruptAndSuspendIfNeeded(ctx);
          }
        },
        onIdle: () => {
          this.callbacks.markPhase(ctx, "session_idle");
          console.log("[GenerationManager] Session idle - generation complete");
        },
        onSessionError: (errorMessage) => {
          logServerEvent(
            "error",
            "OPENCODE_SESSION_ERROR",
            {
              errorMessage,
            },
            {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              sessionId: activeSessionId,
            },
          );
          if (ctx.remoteIntegrationSource) {
            this.callbacks.recordRemoteRunPhase(ctx, "session_error", {
              sessionErrorMessage: errorMessage,
            });
          }
        },
      });

      let resolveRuntimeNoProgress:
        | ((value: { type: "runtime_no_progress" }) => void)
        | undefined;
      const runtimeNoProgressPromise = new Promise<{
        type: "runtime_no_progress";
      }>((resolve) => {
        resolveRuntimeNoProgress = resolve;
      });
      if (remainingRunTimeMs > runtimeNoProgressTimeoutMs) {
        const runtimeNoProgressTimeoutId = setTimeout(() => {
          const snapshot = eventLoop.snapshot();
          if (
            (!forceRuntimeNoProgress && promptResultSettled) ||
            (!forceRuntimeNoProgress && snapshot.stats.progressEventCount > 0) ||
            snapshot.sawSessionIdle ||
            snapshot.sessionErrorMessage ||
            ctx.abortController.signal.aborted
          ) {
            return;
          }

          runtimeNoProgressTriggered = true;
          promptTimeoutController.abort();
          logServerEvent(
            "error",
            "OPENCODE_RUNTIME_NO_PROGRESS_AFTER_PROMPT",
            {
              timeoutMs: runtimeNoProgressTimeoutMs,
              eventStats: snapshot.stats,
            },
            {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              sessionId: activeSessionId,
            },
          );
          resolveRuntimeNoProgress?.({ type: "runtime_no_progress" });
          void runtimeClient
            .abort({ sessionID: activeSessionId })
            .catch((err) => {
              console.error(
                "[GenerationManager] Failed to abort no-progress OpenCode session:",
                err,
              );
            });
        }, runtimeNoProgressTimeoutMs);
        clearRuntimeNoProgressTimeout = () => {
          clearTimeout(runtimeNoProgressTimeoutId);
          clearRuntimeNoProgressTimeout = undefined;
        };
      }

      // Process SSE events
      try {
        await eventLoop.consume(eventStream);
      } catch (error) {
        if (!runtimeNoProgressTriggered) {
          throw error;
        }
      }

      if (runtimeNoProgressTriggered) {
        clearPromptTimeout?.();
        clearRuntimeNoProgressTimeout?.();
        const diagnosticSnapshot =
          await captureRuntimeNoProgressDiagnosticSnapshot({
            ctx,
            runtimeClient,
            sandbox: runtimeSandbox,
            sandboxProvider: runtimeSandbox.provider,
            sessionId: activeSessionId,
            timeoutMs: runtimeNoProgressTimeoutMs,
            promptSentAtMs,
            eventLoopSnapshot: eventLoop.snapshot(),
          });
        ctx.debugInfo = {
          ...(ctx.debugInfo ?? {}),
          runtimeDiagnosticSnapshot: diagnosticSnapshot,
        };
        this.callbacks.setCompletionReason(
          ctx,
          "runtime_no_progress_after_prompt",
        );
        this.callbacks.markPhase(ctx, "runtime_no_progress_after_prompt");
        ctx.errorMessage = RUNTIME_NO_PROGRESS_USER_MESSAGE;
        this.callbacks.scheduleSave(ctx);
        await this.callbacks.finishGeneration(ctx, "error");
        return;
      }

      if (
        !eventLoop.snapshot().sawSessionIdle &&
        !eventLoop.snapshot().sessionErrorMessage &&
        !ctx.abortController.signal.aborted &&
        !promptTimeoutTriggered
      ) {
        const terminalOutcomeResult = await Promise.race([
          waitForOpenCodeTerminalStateAfterEarlyStreamEnd({
            runtimeClient,
            sessionId: activeSessionId,
            maxReattachAttempts: OPENCODE_EARLY_STREAM_REATTACH_ATTEMPTS,
            reattachWaitMs: OPENCODE_EARLY_STREAM_REATTACH_WAIT_MS,
            statusPollIntervalMs: OPENCODE_STATUS_POLL_INTERVAL_MS,
            getRemainingRunTimeMs: () =>
              this.callbacks.getRemainingRunTimeMs(ctx),
            isAbortRequested: () =>
              ctx.abortController.signal.aborted ||
              runtimeNoProgressTriggered ||
              promptTimeoutTriggered,
            refreshCancellationSignal: () =>
              this.callbacks.refreshCancellationSignal(ctx),
            pollExternalInterruptAndSuspendIfNeeded: () =>
              this.callbacks.pollExternalInterruptAndSuspendIfNeeded(ctx),
            onEvent: (rawEvent) => eventLoop.process(rawEvent),
            logReattachFailure: (attempt, error) => {
              console.warn(
                `[GenerationManager] OpenCode terminal reattach failed attempt=${attempt} generationId=${ctx.id}:`,
                error,
              );
            },
            logStatusPollError: (error) => {
              console.warn(
                "[GenerationManager] OpenCode status poll returned an error:",
                error,
              );
            },
            logStatusReconciliationFailure: (error) => {
              console.warn(
                "[GenerationManager] OpenCode status reconciliation failed:",
                error,
              );
            },
          }).then((value) => ({ type: "terminal" as const, value })),
          runtimeNoProgressPromise,
        ]);
        if (terminalOutcomeResult.type === "runtime_no_progress") {
          clearPromptTimeout?.();
          clearRuntimeNoProgressTimeout?.();
          const diagnosticSnapshot =
            await captureRuntimeNoProgressDiagnosticSnapshot({
              ctx,
              runtimeClient,
              sandbox: runtimeSandbox,
              sandboxProvider: runtimeSandbox.provider,
              sessionId: activeSessionId,
              timeoutMs: runtimeNoProgressTimeoutMs,
              promptSentAtMs,
              eventLoopSnapshot: eventLoop.snapshot(),
            });
          ctx.debugInfo = {
            ...(ctx.debugInfo ?? {}),
            runtimeDiagnosticSnapshot: diagnosticSnapshot,
          };
          this.callbacks.setCompletionReason(
            ctx,
            "runtime_no_progress_after_prompt",
          );
          this.callbacks.markPhase(ctx, "runtime_no_progress_after_prompt");
          ctx.errorMessage = RUNTIME_NO_PROGRESS_USER_MESSAGE;
          this.callbacks.scheduleSave(ctx);
          await this.callbacks.finishGeneration(ctx, "error");
          return;
        }
        const terminalOutcome = terminalOutcomeResult.value;
        if (terminalOutcome === "idle") {
          reconciledTerminalIdle = true;
          if (!ctx.phaseMarks?.session_idle) {
            this.callbacks.markPhase(ctx, "session_idle");
          }
        } else if (terminalOutcome === "timed_out") {
          await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
          return;
        } else if (terminalOutcome === "aborted") {
          if (ctx.abortForInterruptPark) {
            return;
          }
          await this.callbacks.finishGeneration(ctx, "cancelled");
          return;
        }
        if (terminalOutcome !== "unknown") {
          console.info(
            `[GenerationManager] OpenCode early stream reconciliation outcome=${terminalOutcome} generationId=${ctx.id} conversationId=${ctx.conversationId}`,
          );
        }
      }

      const promptResultOutcome = await Promise.race([
        this.callbacks.awaitPromiseUntilRunDeadline(ctx, promptResultPromise),
        runtimeNoProgressPromise,
      ]);
      this.callbacks.stopExternalInterruptPolling(ctx);
      clearPromptTimeout?.();
      clearRuntimeNoProgressTimeout?.();
      if (promptResultOutcome.type === "runtime_no_progress") {
        const diagnosticSnapshot =
          await captureRuntimeNoProgressDiagnosticSnapshot({
            ctx,
            runtimeClient,
            sandbox: runtimeSandbox,
            sandboxProvider: runtimeSandbox.provider,
            sessionId: activeSessionId,
            timeoutMs: runtimeNoProgressTimeoutMs,
            promptSentAtMs,
            eventLoopSnapshot: eventLoop.snapshot(),
          });
        ctx.debugInfo = {
          ...(ctx.debugInfo ?? {}),
          runtimeDiagnosticSnapshot: diagnosticSnapshot,
        };
        this.callbacks.setCompletionReason(
          ctx,
          "runtime_no_progress_after_prompt",
        );
        this.callbacks.markPhase(ctx, "runtime_no_progress_after_prompt");
        ctx.errorMessage = RUNTIME_NO_PROGRESS_USER_MESSAGE;
        this.callbacks.scheduleSave(ctx);
        await this.callbacks.finishGeneration(ctx, "error");
        return;
      }
      if (promptResultOutcome.type === "timed_out" || promptTimeoutTriggered) {
        await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      const promptResultEnvelope = promptResultOutcome.value;
      const observedTerminalIdle =
        eventLoop.snapshot().sawSessionIdle || reconciledTerminalIdle;
      const sessionErrorMessage = eventLoop.snapshot().sessionErrorMessage;
      if (sessionErrorMessage) {
        throw new Error(sessionErrorMessage);
      }
      const promptElapsedMs = Date.now() - promptSentAtMs;
      if (promptElapsedMs >= remainingRunTimeMs) {
        await this.callbacks.parkGenerationForRunDeadline(ctx, runtimeClient);
        return;
      }
      this.callbacks.markPhase(ctx, "prompt_completed");

      const completionResolution = await resolveOpenCodePromptCompletion({
        promptResultEnvelope,
        runtimeClient,
        sessionId: activeSessionId,
        sandbox: ctx.sandbox,
        needsAssistantText: !ctx.assistantContent.trim(),
        observedTerminalIdle,
        logPromptTransportErrorAfterIdle: (error) => {
          console.warn(
            "[GenerationManager] Ignoring prompt transport error after session idle:",
            error,
          );
        },
        logOpaquePromptResultError: (error) => {
          console.warn(
            "[GenerationManager] Treating opaque prompt result error as empty completion:",
            error,
          );
        },
        logFallbackMessagesError: (error) => {
          console.warn(
            "[GenerationManager] Failed fallback session.messages fetch:",
            error,
          );
        },
      });

      if (!ctx.assistantContent.trim() && completionResolution.assistantText) {
        if (!ctx.phaseMarks?.first_visible_output_emitted) {
          this.callbacks.markPhase(ctx, "first_visible_output_emitted");
        }
        if (!ctx.phaseMarks?.first_token_emitted) {
          this.callbacks.markPhase(ctx, "first_token_emitted");
        }
        ctx.assistantContent = completionResolution.assistantText;
        ctx.contentParts.push({
          type: "text",
          text: completionResolution.assistantText,
        });
        this.callbacks.broadcast(ctx, {
          type: "text",
          content: completionResolution.assistantText,
        });
        this.callbacks.scheduleSave(ctx);
        logServerEvent(
          "info",
          completionResolution.assistantTextSource === "session_messages"
            ? "OPENCODE_FALLBACK_ASSISTANT_APPLIED"
            : "OPENCODE_PROMPT_RESULT_ASSISTANT_APPLIED",
          { chars: completionResolution.assistantText.length },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            sessionId: activeSessionId,
          },
        );
      }

      if (!ctx.assistantContent.trim()) {
        await this.callbacks.refreshCancellationSignal(ctx, { force: true });
        if (ctx.abortController.signal.aborted) {
          if (ctx.abortForInterruptPark) {
            return;
          }
          await this.callbacks.finishGeneration(ctx, "cancelled");
          return;
        }

        if (!ctx.assistantContent.trim() && !observedTerminalIdle) {
          const emptyCompletionDiagnostics =
            completionResolution.emptyCompletionDiagnostics;
          if (!emptyCompletionDiagnostics) {
            throw new Error(
              "OpenCode empty-completion diagnostics were not collected.",
            );
          }
          const bestTranscriptError = completionResolution.bestTranscriptError;
          this.callbacks.setCompletionReason(ctx, "runtime_error");
          ctx.errorMessage = !isOpaqueDiagnosticMessage(bestTranscriptError)
            ? `The sandbox run finished without producing any assistant output. Loading the runtime transcript also failed: ${bestTranscriptError}`
            : "The sandbox run finished without producing any assistant output. The runtime produced no assistant text, no terminal event, and the transcript endpoint returned no usable error details.";
          this.callbacks.captureOriginalError(
            ctx,
            new Error(
              !isOpaqueDiagnosticMessage(bestTranscriptError)
                ? `OpenCode transcript fetch failed after empty completion: ${bestTranscriptError}`
                : "OpenCode returned no assistant text or transcript after prompt completion.",
            ),
            {
              phase: "prompt_completed",
            },
          );
          logServerEvent(
            "error",
            "OPENCODE_EMPTY_COMPLETION",
            {
              sessionIdleObserved: observedTerminalIdle,
              fallbackMessagesError: completionResolution.fallbackMessagesError,
              fallbackMessagesErrorDetail:
                completionResolution.fallbackMessagesErrorDetail,
              fallbackMessagesPayloadShape:
                completionResolution.fallbackMessagesPayloadShape,
              promptResultDataShape: completionResolution.promptResultDataShape,
              sessionGetError: emptyCompletionDiagnostics.sessionGetError,
              sessionGetErrorDetail:
                emptyCompletionDiagnostics.sessionGetErrorDetail,
              sessionGetDataShape:
                emptyCompletionDiagnostics.sessionGetDataShape,
              sessionGetDataDetail:
                emptyCompletionDiagnostics.sessionGetDataDetail,
              opencodeLogTail: emptyCompletionDiagnostics.opencodeLogTail,
              opencodeLogReadError:
                emptyCompletionDiagnostics.opencodeLogReadError,
            },
            {
              source: "generation-manager",
              traceId: ctx.traceId,
              generationId: ctx.id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              sessionId: activeSessionId,
            },
          );
          await this.callbacks.finishGeneration(ctx, "error");
          return;
        }
      }

      await this.callbacks.refreshCancellationSignal(ctx, { force: true });
      this.callbacks.markPhase(ctx, "post_processing_started");

      if (ctx.sandbox) {
        try {
          await this.callbacks.importIntegrationSkillDraftsFromSandbox(ctx);
        } catch (error) {
          console.error(
            "[GenerationManager] Failed to import integration skill drafts:",
            error,
          );
        }
      }

      // Collect new files created in the sandbox during generation
      let uploadedSandboxFileCount = 0;
      const { stats: opencodeStats } = eventLoop.snapshot();
      const shouldCollectSandboxFiles =
        opencodeStats.toolCallCount > 0 || stagedUploadCount > 0;
      if (
        ctx.sandbox &&
        ctx.generationMarkerTime &&
        shouldCollectSandboxFiles
      ) {
        uploadedSandboxFileCount =
          await this.callbacks.turnFinalizer.collectAndExposeMentionedSandboxFiles(
            ctx,
            {
              summaryMessage: ({ discoveredCount, exposedCount }) =>
                `[GenerationManager] Found ${discoveredCount} new files in E2B sandbox; exposing ${exposedCount} based on final-answer mentions`,
              collectionErrorMessage:
                "[GenerationManager] Failed to collect sandbox files:",
              uploadErrorMessage: (filePath) =>
                `[GenerationManager] Failed to upload sandbox file ${filePath}:`,
            },
          );
      }
      this.callbacks.markPhase(ctx, "post_processing_completed");
      await this.callbacks.captureUsageFromRuntimeSession(
        ctx,
        runtimeClient,
        activeSessionId,
      );

      // Check if aborted
      if (ctx.abortController.signal.aborted) {
        if (ctx.abortForInterruptPark) {
          return;
        }
        console.info(
          `[GenerationManager][SUMMARY] status=cancelled generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} opencodeEvents=${opencodeStats.eventCount} toolCalls=${opencodeStats.toolCallCount} permissions=${opencodeStats.permissionCount} questions=${opencodeStats.questionCount} stagedUploads=${stagedUploadCount} uploadedFiles=${uploadedSandboxFileCount}`,
        );
        await this.callbacks.finishGeneration(ctx, "cancelled");
        return;
      }

      // Complete the generation
      console.info(
        `[GenerationManager][SUMMARY] status=completed generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} opencodeEvents=${opencodeStats.eventCount} toolCalls=${opencodeStats.toolCallCount} permissions=${opencodeStats.permissionCount} questions=${opencodeStats.questionCount} stagedUploads=${stagedUploadCount} uploadedFiles=${uploadedSandboxFileCount}`,
      );
      await this.callbacks.finishGeneration(ctx, "completed");
    } catch (error) {
      this.callbacks.stopExternalInterruptPolling(ctx);
      clearPromptTimeout?.();
      clearRuntimeNoProgressTimeout?.();
      if (error instanceof GenerationSuspendedError) {
        logServerEvent(
          "info",
          "GENERATION_SUSPENDED_FOR_INTERRUPT",
          {
            interruptId: error.interruptId,
            interruptKind: error.kind,
            remainingRunMs: ctx.remainingRunMs,
          },
          {
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
        );
        return;
      }
      if (isBootstrapTimeoutError(error)) {
        this.callbacks.captureOriginalError(ctx, error, {
          phase: this.callbacks.getCurrentPhase(ctx) ?? "agent_init_failed",
        });
        this.callbacks.setCompletionReason(ctx, "bootstrap_timeout");
        ctx.errorMessage =
          error instanceof Error ? error.message : formatErrorMessage(error);
        await this.callbacks.finishGeneration(ctx, "error");
        return;
      }
      if (error instanceof ExecutorPromptReadyError) {
        this.callbacks.captureOriginalError(ctx, error.cause ?? error, {
          phase:
            this.callbacks.getCurrentPhase(ctx) ??
            "pre_prompt_executor_prepare_failed",
        });
        this.callbacks.setCompletionReason(ctx, "runtime_error");
        ctx.errorMessage = error.message;
        await this.callbacks.finishGeneration(ctx, "error");
        return;
      }
      if (promptTimeoutTriggered) {
        await this.callbacks.parkGenerationForRunDeadline(ctx, client);
        return;
      }
      console.error("[GenerationManager] Error:", error);
      const runtimeFailure = await this.callbacks.resolveRuntimeFailure(
        ctx,
        client,
      );
      this.callbacks.captureOriginalError(ctx, error, { runtimeFailure });
      if (runtimeFailure === "recoverable_live_runtime") {
        this.callbacks.scheduleRecoveryReattach(ctx);
        return;
      }
      if (
        runtimeFailure === "waiting_approval" ||
        runtimeFailure === "waiting_auth"
      ) {
        return;
      }
      if (runtimeFailure === "sandbox_missing") {
        this.callbacks.setCompletionReason(ctx, "sandbox_missing");
        ctx.errorMessage =
          "The sandbox stopped while this run was still active. Retry the task to continue.";
      } else if (runtimeFailure === "broken_runtime_state") {
        this.callbacks.setCompletionReason(ctx, "broken_runtime_state");
        ctx.errorMessage =
          "The runtime ended in a non-terminal state and could not be recovered. Retry the task to continue.";
      } else if (runtimeFailure === "terminal_failed") {
        this.callbacks.setCompletionReason(ctx, "runtime_error");
      } else if (runtimeFailure === "terminal_completed") {
        this.callbacks.setCompletionReason(ctx, "completed");
      } else if (!ctx.completionReason) {
        this.callbacks.setCompletionReason(ctx, "infra_disconnect");
      }
      if (!ctx.errorMessage && runtimeFailure !== "terminal_completed") {
        ctx.errorMessage =
          error instanceof Error ? error.message : "Unknown error";
      }
      if (runtimeFailure === "terminal_completed") {
        if (client && ctx.sessionId) {
          await this.callbacks.captureUsageFromRuntimeSession(
            ctx,
            client,
            ctx.sessionId,
          );
        }
        await this.callbacks.finishGeneration(ctx, "completed");
        return;
      }
      console.info(
        `[GenerationManager][SUMMARY] status=error generationId=${ctx.id} conversationId=${ctx.conversationId} durationMs=${Date.now() - ctx.startedAt.getTime()} error=${JSON.stringify(ctx.errorMessage)}`,
      );
      await this.callbacks.finishGeneration(ctx, "error");
    }
  }
}
