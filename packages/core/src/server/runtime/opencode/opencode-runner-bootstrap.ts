import { db } from "@bap/db/client";
import { conversation } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import { env } from "../../../env";
import { splitCoworkerAllowedSkillSlugs } from "../../../lib/coworker-tool-policy";
import { parseModelReference } from "../../../lib/model-reference";
import type { RuntimeContextFile } from "../../../lib/runtime-context";
import { stagePrePromptAssets } from "../../execution/pre-prompt-assets";
import { stageRuntimePromptAttachments } from "../../execution/prompt-attachments";
import {
  writeRuntimeContextToSandbox,
  writeRuntimeEnvToSandbox,
} from "../../execution/runtime-context";
import { resolveRuntimeEnvironmentForTurn } from "../../execution/runtime-env";
import { composeOpencodePromptSpec } from "../../prompts/opencode-runtime-prompt";
import type {
  RuntimeHarnessClient,
  RuntimeMcpServer,
  RuntimePromptPart,
  RuntimeSelection,
  SandboxHandle,
} from "../../sandbox/core/types";
import { getOrCreateConversationSandbox } from "../../sandbox/core/orchestrator";
import { buildMemorySystemPrompt, syncMemoryFilesToSandbox } from "../../sandbox/prep/memory-prep";
import {
  getIntegrationSkillsSystemPrompt,
  getSkillsSystemPrompt,
} from "../../sandbox/prep/skills-prep";
import { emitCanonicalServiceEvent, logger } from "../../utils/observability";
import { buildOpencodePromptSpecInputForContext } from "../../services/generation/prompts/opencode-prompt-context";
import type { GenerationContext } from "../../services/generation/types";
import { resolveWorkspaceMcpServersForGeneration } from "../../executor/workspace-sources";
import { resolveBapPlatformMcpServer } from "../../sandbox/platform-mcp-server";
import { buildOpenCodeRuntimeModelConfig } from "./model-config";
import type { NormalRunnerCallbacks } from "./opencode-runner-types";
import { withTimeout } from "./opencode-runner-support";

export type RunnerBootstrapResult = {
  runtimeClient: RuntimeHarnessClient;
  activeSessionId: string;
  runtimeSandbox: SandboxHandle;
  runtimeMetadata: RuntimeSelection | undefined;
  promptSpec: Awaited<ReturnType<typeof composeOpencodePromptSpec>>;
  modelConfig: ReturnType<typeof buildOpenCodeRuntimeModelConfig>;
  promptParts: RuntimePromptPart[];
  eventStream: AsyncIterable<unknown>;
  promptTimeoutController: AbortController;
  verboseOpenCodeEventLogs: boolean;
  stagedUploadCount: number;
  startPostPromptCacheWrite: (() => Promise<void>) | null;
};

// The sandbox + agent bootstrap phase of a normal turn: it provisions (or
// reuses) the conversation sandbox, completes agent init to obtain a live
// runtime client + session id, runs every pre-prompt staging task (memory,
// runtime context/env, workspace MCP reconciliation, skill assets, prompt-spec
// compose, attachment staging), subscribes to the event stream, and returns
// the handful of values the turn loop needs. All telemetry/broadcast side
// effects happen inside; the runner just awaits the result and proceeds to
// send the prompt.
export async function runNormalRunnerBootstrap(
  ctx: GenerationContext,
  callbacks: NormalRunnerCallbacks,
): Promise<RunnerBootstrapResult> {
  if (parseModelReference(ctx.model).providerID === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const { customSkillNames } = splitCoworkerAllowedSkillSlugs(ctx.allowedSkillSlugs ?? []);
  callbacks.ensureRemoteRunDebugInfo(ctx);
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
        logger.info({
          event: "REMOTE_INTEGRATION_CREDENTIALS_ATTACHED",
          ...{
            source: "generation-manager",
            traceId: ctx.traceId,
            generationId: ctx.id,
            conversationId: ctx.conversationId,
            userId: ctx.userId,
          },
          ...{
            targetEnv: ctx.remoteIntegrationSource.targetEnv,
            remoteUserId: ctx.remoteIntegrationSource.remoteUserId,
            remoteUserEmail,
            allowedIntegrations: [...allowedIntegrations].toSorted(),
            attachedTokenEnvVarNames,
          },
        });
        callbacks.recordRemoteRunPhase(ctx, "remote_credentials_fetched", {
          attachedTokenEnvVarNames,
        });
      },
    },
  );

  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, ctx.conversationId),
  });

  const hasExistingMessages = !ctx.isNewConversation;

  const initDeadlineAt = Date.now() + callbacks.bootstrapTimeoutMs;
  const buildPreparingTimeoutMessage = () =>
    `Agent preparation timed out after ${Math.round(callbacks.bootstrapTimeoutMs / 1000)} seconds.`;
  const remainingPreparingTimeoutMs = () => Math.max(1, initDeadlineAt - Date.now());
  const initWarnAfterMs = 15_000;

  let sessionId: string | undefined;
  let client: RuntimeHarnessClient | undefined;
  let runtimeSandbox: SandboxHandle;
  let runtimeMetadata: RuntimeSelection | undefined;
  let runtimeInit: Awaited<ReturnType<typeof getOrCreateConversationSandbox>>;

  ctx.agentSandboxReadyAt = undefined;
  ctx.agentSandboxMode = undefined;
  callbacks.markPhase(ctx, "sandbox_init_started");
  callbacks.broadcast(ctx, {
    type: "status_change",
    status: "sandbox_init_started",
  });
  logger.info({
    event: "SANDBOX_INIT_STARTED",
    ...{
      source: "generation-manager",
      traceId: ctx.traceId,
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      userId: ctx.userId,
    },
  });
  const sandboxInitWarnTimer = setTimeout(() => {
    const elapsedMs = callbacks.bootstrapTimeoutMs - remainingPreparingTimeoutMs();
    logger.warn({
      event: "SANDBOX_INIT_SLOW",
      ...{
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
      ...{ elapsedMs },
    });
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
          allowSnapshotRestore: ctx.executionPolicy.allowSnapshotRestoreOnRun !== false,
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
            callbacks.markPhase(ctx, status);
            if (stage === "sandbox_created") {
              ctx.agentSandboxReadyAt = Date.now();
              ctx.agentSandboxMode = "created";
            } else if (stage === "sandbox_reused") {
              ctx.agentSandboxReadyAt = Date.now();
              ctx.agentSandboxMode = "reused";
            }
            callbacks.broadcast(ctx, {
              type: "status_change",
              status,
            });
            logger.info({
              event: status.toUpperCase(),
              ...{
                source: "generation-manager",
                traceId: ctx.traceId,
                generationId: ctx.id,
                conversationId: ctx.conversationId,
                userId: ctx.userId,
              },
              ...(details ?? {}),
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
    callbacks.markPhase(ctx, "sandbox_init_failed");
    callbacks.broadcast(ctx, {
      type: "status_change",
      status: "sandbox_init_failed",
    });
    logger.error({
      event: "SANDBOX_INIT_FAILED",
      ...{
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
      ...{
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      },
    });
    throw error;
  } finally {
    clearTimeout(sandboxInitWarnTimer);
  }

  await callbacks.bindRuntimeSandboxToContext(ctx, {
    runtimeSandbox,
    runtimeMetadata,
    executionEnvironment: undefined,
  });
  if (ctx.remoteIntegrationSource) {
    callbacks.recordRemoteRunPhase(ctx, "sandbox_created");
  }
  await callbacks.setSnapshotRestoreAllowance(ctx, false);

  const agentInitStartedAt = Date.now();
  ctx.agentInitStartedAt = agentInitStartedAt;
  ctx.agentInitReadyAt = undefined;
  ctx.agentInitFailedAt = undefined;
  callbacks.markPhase(ctx, "agent_init_started");
  callbacks.broadcast(ctx, {
    type: "status_change",
    status: "agent_init_started",
  });
  logger.info({
    event: "AGENT_INIT_STARTED",
    ...{
      source: "generation-manager",
      traceId: ctx.traceId,
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      userId: ctx.userId,
    },
  });
  const agentInitWarnTimer = setTimeout(() => {
    const elapsedMs = Date.now() - agentInitStartedAt;
    logger.warn({
      event: "AGENT_INIT_SLOW",
      ...{
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      },
      ...{ elapsedMs },
    });
  }, initWarnAfterMs);

  let resolveWorkspaceMcpSessionServers: (
    value: RuntimeMcpServer[] | undefined,
  ) => void = () => {};
  let rejectWorkspaceMcpSessionServers: (reason?: unknown) => void = () => {};
  const workspaceMcpSessionServersPromise: Promise<RuntimeMcpServer[] | undefined> =
    runtimeMetadata?.runtimeHarness === "opencode"
      ? new Promise((resolve, reject) => {
          resolveWorkspaceMcpSessionServers = resolve;
          rejectWorkspaceMcpSessionServers = reject;
        })
      : Promise.resolve(undefined);
  const runtimeMcpWarnings: Array<{ serverName: string; message: string }> = [];
  let resolvedWorkspaceMcpServerNames: string[] = [];

  const runtimeSessionPromise = (async () => {
    try {
      const sessionMcpServers = await workspaceMcpSessionServersPromise;
      const session = await withTimeout(
        runtimeInit.completeAgentInit({ sessionMcpServers }),
        remainingPreparingTimeoutMs(),
        buildPreparingTimeoutMessage(),
      );
      client = session.harnessClient;
      sessionId = session.session.id;
      runtimeMcpWarnings.push(...(session.mcpWarnings ?? []));
      await callbacks.persistRuntimeSessionBinding(ctx, {
        runtimeMetadata,
        sessionId,
      });
      ctx.agentInitReadyAt = Date.now();
      callbacks.markPhase(ctx, "agent_init_ready");
      callbacks.broadcast(ctx, {
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
      logger.info({
        event: "AGENT_INIT_READY",
        ...{
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          sessionId,
          sandboxId: runtimeSandbox.sandboxId,
        },
        ...{
          durationMs: ctx.agentInitReadyAt - agentInitStartedAt,
          sandboxProvider: runtimeMetadata?.sandboxProvider,
          runtimeHarness: runtimeMetadata?.runtimeHarness,
          runtimeProtocolVersion: runtimeMetadata?.runtimeProtocolVersion,
        },
      });
    } catch (error) {
      ctx.agentInitFailedAt = Date.now();
      callbacks.markPhase(ctx, "agent_init_failed");
      callbacks.broadcast(ctx, {
        type: "status_change",
        status: "agent_init_failed",
      });
      logger.error({
        event: "AGENT_INIT_FAILED",
        ...{
          source: "generation-manager",
          traceId: ctx.traceId,
          generationId: ctx.id,
          conversationId: ctx.conversationId,
          userId: ctx.userId,
        },
        ...{
          durationMs: ctx.agentInitFailedAt - agentInitStartedAt,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        },
      });
      throw error;
    } finally {
      clearTimeout(agentInitWarnTimer);
    }
  })();

  ctx.generationMarkerTime = Date.now();
  ctx.sentFilePaths = new Set();
  ctx.userStagedFilePaths = new Set();
  callbacks.markPhase(ctx, "pre_prompt_setup_started");
  const prePromptStartedAt = Date.now();
  const prePromptBreakdown: Record<string, number> = {};
  const markPrePromptStep = (step: string, startedAt: number) => {
    prePromptBreakdown[step] = Date.now() - startedAt;
  };
  const markPrePromptPhase = (step: string, status: "started" | "completed") => {
    callbacks.markPhase(ctx, `pre_prompt_${step}_${status}`);
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
  let enabledSkillRows: Array<{ name: string; updatedAt: Date }> = [];
  let writtenSkills: string[] = [];
  let writtenIntegrationSkills: string[] = [];
  let prePromptCacheHit = false;
  let startPostPromptCacheWrite: (() => Promise<void>) | null = null;

  const memorySyncPromise = (async () => {
    try {
      await runPrePromptStep("memory_sync", "syncMemoryFilesToSandboxMs", async () => {
        await syncMemoryFilesToSandbox(ctx.userId, runtimeSandbox);
      });
    } catch (err) {
      console.error("[GenerationManager] Failed to sync memory to sandbox:", err);
      memoryInstructions = buildMemorySystemPrompt();
    }
  })();

  const runtimeContextWritePromise = (async () => {
    try {
      await runPrePromptStep("runtime_context_write", "writeRuntimeContextMs", async () => {
        if (ctx.runtimeId && ctx.runtimeCallbackToken && ctx.runtimeTurnSeq) {
          const runtimeContext: RuntimeContextFile = {
            runtimeId: ctx.runtimeId,
            turnSeq: ctx.runtimeTurnSeq,
            callbackToken: ctx.runtimeCallbackToken,
            updatedAt: new Date().toISOString(),
          };
          await writeRuntimeContextToSandbox(runtimeSandbox, runtimeContext);
        }
        await writeRuntimeEnvToSandbox(runtimeSandbox, sandboxRuntimeEnv);
      });
    } catch (error) {
      console.error("[GenerationManager] Failed to write runtime metadata to sandbox:", error);
    }
  })();

  const workspaceMcpPreparePromise = (async (): Promise<void> => {
    markPrePromptPhase("workspace_mcp_resolve", "started");
    const startedAt = Date.now();
    try {
      const [resolved, platformResolution] = await Promise.all([
        resolveWorkspaceMcpServersForGeneration({
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          allowedWorkspaceMcpServerIds: ctx.allowedWorkspaceMcpServerIds,
          remoteIntegrationSource: ctx.remoteIntegrationSource,
        }),
        // Platform MCP Server (ADR-0013): hard-wired into every generation,
        // independent of the Workspace MCP Server Allowlist.
        resolveBapPlatformMcpServer({
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
          spawnDepth: ctx.spawnDepth,
        }),
      ]);
      for (const unavailable of resolved.unavailableServers) {
        runtimeMcpWarnings.push({
          serverName: unavailable.namespace,
          message: `${unavailable.name} tools are unavailable: ${unavailable.reason}`,
        });
      }
      if (!platformResolution.server) {
        runtimeMcpWarnings.push(platformResolution.warning);
      }
      const sessionServers = [
        ...resolved.requestedServers.map((entry) => entry.server),
        ...(platformResolution.server ? [platformResolution.server] : []),
      ];
      resolvedWorkspaceMcpServerNames = sessionServers.map((server) => server.name);
      resolveWorkspaceMcpSessionServers(sessionServers);
    } catch (error) {
      rejectWorkspaceMcpSessionServers(error);
      throw error;
    } finally {
      markPrePromptStep("resolveWorkspaceMcpServersMs", startedAt);
      markPrePromptPhase("workspace_mcp_resolve", "completed");
    }
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
      markPhase: (phase) => callbacks.markPhase(ctx, phase),
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

  await Promise.all([
    memorySyncPromise,
    runtimeContextWritePromise,
    workspaceMcpPreparePromise,
    skillAssetPreparePromise,
    runtimeSessionPromise,
  ]);

  if (!sessionId) {
    throw new Error("Runtime session ID is unavailable.");
  }
  if (!client) {
    throw new Error("Runtime harness client is unavailable.");
  }

  await callbacks.bindRuntimeSessionToContext(ctx, {
    runtimeSandbox,
    runtimeMetadata,
    sessionId,
  });
  const activeSessionId = sessionId;
  const workspaceMcpWarningNames = runtimeMcpWarnings.map((warning) => warning.serverName);
  logger.info({
    event: "WORKSPACE_MCP_RECONCILIATION_COMPLETED",
    generationId: ctx.id,
    conversationId: ctx.conversationId,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? undefined,
    sandboxId: runtimeSandbox.sandboxId,
    sessionId,
    requestedServerCount: resolvedWorkspaceMcpServerNames.length,
    warningCount: runtimeMcpWarnings.length,
    requestedServers: resolvedWorkspaceMcpServerNames,
    warningServers: workspaceMcpWarningNames,
  });
  emitCanonicalServiceEvent({
    level: runtimeMcpWarnings.length > 0 ? "warn" : "info",
    eventName: "bap.workspace_mcp.reconciliation",
    operationName: "workspace_mcp.reconcile",
    eventId: `generation:${ctx.id}:workspace_mcp_reconcile`,
    outcome: runtimeMcpWarnings.length > 0 ? "degraded" : "connected",
    context: {
      source: "opencode-normal-runner",
      traceId: ctx.traceId,
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      sandboxId: runtimeSandbox.sandboxId,
      sessionId,
    },
    attributes: {
      "bap.generation.id": ctx.id,
      "bap.conversation.id": ctx.conversationId,
      "bap.workspace.id": ctx.workspaceId ?? undefined,
      "bap.workspace_mcp.requested_count": resolvedWorkspaceMcpServerNames.length,
      "bap.workspace_mcp.warning_count": runtimeMcpWarnings.length,
      "bap.workspace_mcp.requested_servers": resolvedWorkspaceMcpServerNames,
      "bap.workspace_mcp.warning_servers": workspaceMcpWarningNames,
    },
  });

  if (runtimeMcpWarnings.length > 0) {
    const warningText = [
      "Some selected tools are unavailable for this run:",
      ...runtimeMcpWarnings.map((warning) => `- ${warning.serverName}: ${warning.message}`),
    ].join("\n");
    ctx.contentParts.push({
      type: "system",
      content: warningText,
    });
    callbacks.broadcast(ctx, {
      type: "system",
      content: warningText,
    });
    await callbacks.saveProgress(ctx);
  }

  if (writtenSkills.length === 0) {
    writtenSkills = enabledSkillRows.map((entry) => entry.name);
  }
  const skillsInstructions = getSkillsSystemPrompt(writtenSkills);
  const integrationSkillsInstructions = getIntegrationSkillsSystemPrompt(writtenIntegrationSkills);

  const promptSpecInput = buildOpencodePromptSpecInputForContext(ctx, {
    cliInstructions,
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

  const verboseOpenCodeEventLogs = process.env.OPENCODE_VERBOSE_EVENTS === "1";
  let stagedCoworkerDocumentCount = 0;
  let stagedUploadCount = 0;
  let stagedUploadFailureCount = 0;

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

  const modelConfig = buildOpenCodeRuntimeModelConfig(ctx.model);

  const promptParts: RuntimePromptPart[] = [{ type: "text", text: ctx.userMessageContent }];
  const stagedPromptAttachments = await stageRuntimePromptAttachments({
    runtimeSandbox,
    coworkerId: ctx.coworkerId,
    workspaceId: ctx.workspaceId,
    attachments: ctx.attachments,
    userStagedFilePaths: ctx.userStagedFilePaths,
    runStep: runPrePromptStep,
    logAttachmentWriteError: (sandboxPath, error) => {
      console.error(`[GenerationManager] Failed to write file to sandbox: ${sandboxPath}`, error);
    },
  });
  promptParts.push(...stagedPromptAttachments.promptParts);
  stagedCoworkerDocumentCount = stagedPromptAttachments.stagedCoworkerDocumentCount;
  stagedUploadCount = stagedPromptAttachments.stagedUploadCount;
  stagedUploadFailureCount = stagedPromptAttachments.stagedUploadFailureCount;
  if (stagedCoworkerDocumentCount > 0 || stagedUploadCount > 0 || stagedUploadFailureCount > 0) {
    logger.info({
      event: "ATTACHMENTS_STAGED",
      ...{
        source: "generation-manager",
        traceId: ctx.traceId,
        generationId: ctx.id,
        conversationId: ctx.conversationId,
        userId: ctx.userId,
        sessionId: activeSessionId,
      },
      ...{
        stagedCoworkerDocumentCount,
        stagedUploadCount,
        stagedUploadFailureCount,
      },
    });
  }

  markPrePromptStep("prePromptSetupTotalMs", prePromptStartedAt);
  logger.info({
    event: "PRE_PROMPT_BREAKDOWN",
    ...{
      source: "generation-manager",
      traceId: ctx.traceId,
      generationId: ctx.id,
      conversationId: ctx.conversationId,
      userId: ctx.userId,
      sandboxId: runtimeSandbox.sandboxId,
      sessionId: ctx.sessionId,
    },
    ...{
      cacheHit: prePromptCacheHit,
      sandboxMode: ctx.agentSandboxMode ?? "unknown",
      ...prePromptBreakdown,
    },
  });

  return {
    runtimeClient,
    activeSessionId,
    runtimeSandbox,
    runtimeMetadata,
    promptSpec,
    modelConfig,
    promptParts,
    eventStream,
    promptTimeoutController,
    verboseOpenCodeEventLogs,
    stagedUploadCount,
    startPostPromptCacheWrite,
  };
}
