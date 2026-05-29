import { logger } from "../utils/observability";
import type { RuntimeMcpServer, SandboxHandle } from "../sandbox/core/types";
import {
  prepareExecutorInSandbox,
  type ExecutorOauthSourceStatus,
} from "../sandbox/prep/executor-prep";

export class ExecutorPromptReadyError extends Error {
  override cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ExecutorPromptReadyError";
    this.cause = cause;
  }
}

type ExecutorPrepLogContext = {
  source: string;
  traceId: string;
  generationId: string;
  conversationId: string;
  userId: string;
  sandboxId: string;
  sessionId?: string;
};

export type StageExecutorPrePromptResult = {
  instructions: string | null;
  runFinalize: () => Promise<void>;
};

function buildExecutorSourceHealthInstructions(
  statuses: ExecutorOauthSourceStatus[],
): string | null {
  if (statuses.length === 0) {
    return null;
  }

  const unavailableSources = statuses.filter((source) => source.status !== "available");
  const lines = [
    "Executor source health after refresh:",
    ...statuses.map((source) => {
      if (source.status === "available") {
        return `- ${source.namespace} (${source.name}): available${
          source.toolCount === null
            ? ""
            : `, ${source.toolCount} tool${source.toolCount === 1 ? "" : "s"}`
        }`;
      }
      return `- ${source.namespace} (${source.name}): ${source.status}, reason=${source.reason}, error=${source.error}`;
    }),
  ];

  if (unavailableSources.length > 0) {
    lines.push(
      "Unavailable Executor source policy:",
      "If the user asks for one of the unavailable sources above, keep the agent loop alive and make the failure visible inside the Executor tool loop.",
      "The next action must be an `executor_execute` tool call that lists Executor sources and throws an error for the matching source. Use this pattern:",
      "```js",
      "const sources = await tools.executor.sources.list();",
      "const source = sources.find((entry) => entry.id === '<namespace>' || entry.name === '<namespace>');",
      "throw new Error(`Executor source ${source?.id ?? '<namespace>'} is unavailable (toolCount=${source?.toolCount ?? 'unknown'}). Refresh/reconnect the source before using it.`);",
      "```",
      "After that Executor tool error, report the source as unavailable and ask the user to reconnect or refresh it.",
      "Do not use `bash` executor CLI commands, GraphQL addSource, coworkers, global searches, or unrelated source tools as a fallback for that request.",
    );
  }

  return lines.join("\n");
}

export async function stageExecutorPrePrompt(input: {
  runtimeSandbox: SandboxHandle;
  workspaceId?: string | null;
  userId: string;
  allowedExecutorSourceIds?: string[] | null;
  runtimeId?: string | null;
  reuseExistingState: boolean;
  prerequisites: Array<Promise<unknown>>;
  resolveSessionMcpServers: (value: RuntimeMcpServer[] | undefined) => void;
  rejectSessionMcpServers: (reason?: unknown) => void;
  markPhase: (phase: string) => void;
  recordMetric: (metricName: string, durationMs: number) => void;
  logContext: () => ExecutorPrepLogContext;
}): Promise<StageExecutorPrePromptResult> {
  input.markPhase("pre_prompt_executor_prepare_started");
  const executorPrepareStartedAt = Date.now();
  let executorPrepareCompleted = false;
  const completeExecutorPrepare = () => {
    if (executorPrepareCompleted) {
      return;
    }
    executorPrepareCompleted = true;
    input.recordMetric("prepareExecutorInSandboxMs", Date.now() - executorPrepareStartedAt);
    input.markPhase("pre_prompt_executor_prepare_completed");
  };

  let executorInstructions: string | null = null;

  try {
    await Promise.all(input.prerequisites);

    const executorBootstrap = await prepareExecutorInSandbox({
      sandbox: input.runtimeSandbox,
      workspaceId: input.workspaceId,
      userId: input.userId,
      allowedSourceIds: input.allowedExecutorSourceIds,
      runtimeId: input.runtimeId,
      reuseExistingState: input.reuseExistingState,
      onPhase: (phase, status) => {
        input.markPhase(`pre_prompt_executor_${phase}_${status}`);
      },
    });
    executorInstructions = executorBootstrap?.instructions ?? null;
    let executorFinalizePromise: Promise<void> | null = null;
    const runFinalize = async () => {
      executorFinalizePromise ??= (async () => {
        let result: {
          oauthCacheHits: number;
          oauthRefreshFailures: Array<{
            sourceId: string;
            name: string;
            namespace: string;
            reason: string;
            error: string;
          }>;
          oauthSourceStatuses: ExecutorOauthSourceStatus[];
        } = { oauthCacheHits: 0, oauthRefreshFailures: [], oauthSourceStatuses: [] };
        try {
          result = executorBootstrap?.finalize ? await executorBootstrap.finalize() : result;
          const sourceHealthInstructions = buildExecutorSourceHealthInstructions(
            result.oauthSourceStatuses,
          );
          if (sourceHealthInstructions) {
            executorInstructions = [
              executorBootstrap?.instructions ?? null,
              sourceHealthInstructions,
            ]
              .filter((entry): entry is string => Boolean(entry))
              .join("\n\n");
          }
          if (result.oauthRefreshFailures.length > 0) {
            logger.warn({
              event: "EXECUTOR_PREP_REFRESH_PARTIAL_FAILED",
              ...input.logContext(),
              ...{
                oauthCacheHits: result.oauthCacheHits,
                oauthRefreshFailureCount: result.oauthRefreshFailures.length,
                oauthRefreshFailureNamespaces: result.oauthRefreshFailures.map(
                  (failure) => failure.namespace,
                ),
                oauthRefreshFailures: result.oauthRefreshFailures.map((failure) => ({
                  namespace: failure.namespace,
                  reason: failure.reason,
                  error: failure.error,
                })),
              },
            });
          }
          const unavailableSelectedSources =
            input.allowedExecutorSourceIds && input.allowedExecutorSourceIds.length > 0
              ? result.oauthSourceStatuses.filter(
                  (source) =>
                    input.allowedExecutorSourceIds?.includes(source.sourceId) &&
                    source.status !== "available",
                )
              : [];
          logger.info({
            event: "EXECUTOR_PREP_COMPLETED",
            ...input.logContext(),
            ...{
              oauthCacheHits: result.oauthCacheHits,
              oauthRefreshFailureCount: result.oauthRefreshFailures.length,
              unavailableSelectedSourceCount: unavailableSelectedSources.length,
            },
          });
        } catch (error) {
          console.error("[GenerationManager] Executor OAuth reconcile failed:", error);
          logger.error({
            event: "EXECUTOR_PREP_FINALIZE_FAILED",
            ...input.logContext(),
            ...{
              error: error instanceof Error ? error.message : String(error),
            },
          });
        } finally {
          completeExecutorPrepare();
        }
      })();
      await executorFinalizePromise;
    };

    await runFinalize();

    input.resolveSessionMcpServers(executorBootstrap?.sessionMcpServers);
    return {
      instructions: executorInstructions,
      runFinalize,
    };
  } catch (error) {
    console.error("[GenerationManager] Failed to prepare executor in sandbox:", error);
    const promptReadyError = new ExecutorPromptReadyError(error);
    input.rejectSessionMcpServers(promptReadyError);
    completeExecutorPrepare();
    throw promptReadyError;
  }
}
