import { T } from "gt-react";
import { ArrowLeft, Circle, Loader2 } from "lucide-react";
import {
  extractRemoteRunSourceDetails,
  RemoteRunSourceBanner,
} from "@/components/coworkers/remote-run-source-banner";
import { RunDebugDetails } from "@/components/coworkers/run-debug-details";
import {
  isRunnerDeclaredFailure,
  RunnerDeclaredFailureChatArea,
  RunnerDeclaredFailureNote,
} from "@/components/coworkers/runner-declared-failure";
import { ImpersonationRequiredPage } from "@/components/impersonation/impersonation-required-page";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { cn } from "@/lib/utils";
import { useCoworkerRun, useCoworkerRunImpersonationTarget } from "@/orpc/hooks/coworkers";
import { formatRelativeTime } from "./coworker-editor-utils";

type InlineRunViewerProps = {
  runId: string;
  coworkerId?: string;
  coworkerRouteSlug?: string;
  onBack: () => void;
};

export function InlineRunViewer({
  runId,
  coworkerId,
  coworkerRouteSlug,
  onBack,
}: InlineRunViewerProps) {
  const { data: run, isLoading } = useCoworkerRun(runId);
  const shouldLoadImpersonationTarget = Boolean(runId && !isLoading && !run);
  const { data: impersonationTarget, isLoading: isImpersonationTargetLoading } =
    useCoworkerRunImpersonationTarget(runId, coworkerId, {
      enabled: shouldLoadImpersonationTarget,
    });

  if (isLoading || (shouldLoadImpersonationTarget && isImpersonationTargetLoading)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!run) {
    if (impersonationTarget) {
      return (
        <ImpersonationRequiredPage
          target={impersonationTarget}
          redirectPath={
            coworkerRouteSlug
              ? `/agents/edit/${coworkerRouteSlug}/runs/${runId}`
              : `/agents/runs/${runId}`
          }
          onBack={onBack}
        />
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 px-4 py-2">
          <BackToRunsButton onBack={onBack} />
        </div>
        <div className="text-muted-foreground px-4 text-xs">
          <T>Run not found.</T>
        </div>
      </div>
    );
  }

  const remoteRunSource = extractRemoteRunSourceDetails(run);
  const runnerDeclaredFailure = isRunnerDeclaredFailure(run.failureKind);
  const displayStatus = runnerDeclaredFailure ? "error" : run.status;

  if (!run.conversationId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 px-4 py-2">
          <BackToRunsButton onBack={onBack} />
        </div>
        <RemoteRunSourceBanner source={remoteRunSource} />
        <div className="px-4 py-2">
          <p className="text-muted-foreground text-xs">
            <T>This run does not have a linked conversation.</T>
          </p>
          {runnerDeclaredFailure ? (
            <RunnerDeclaredFailureNote
              className="mt-3 rounded-md border"
              debugInfo={run.debugInfo}
            />
          ) : (
            <RunDebugDetails debugInfo={run.debugInfo} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border/30 flex items-center gap-2 border-b px-4 py-2">
        <BackToRunsButton onBack={onBack} />
        <Circle
          className={cn(
            "ml-1 h-1.5 w-1.5 shrink-0 fill-current",
            displayStatus === "completed"
              ? "text-emerald-500"
              : displayStatus === "running" ||
                  displayStatus === "awaiting_approval" ||
                  displayStatus === "awaiting_auth"
                ? "text-blue-500"
                : displayStatus === "paused"
                  ? "text-amber-500"
                  : displayStatus === "cancelling"
                    ? "text-amber-500"
                    : displayStatus === "needs_user_input"
                      ? "text-emerald-500"
                      : displayStatus === "error" || displayStatus === "cancelled"
                        ? "text-red-500"
                        : "text-muted-foreground",
          )}
        />
        <span className="text-foreground/70 text-xs">
          {getCoworkerRunStatusLabel(displayStatus)}
        </span>
        <span className="text-muted-foreground ml-auto text-xs">
          {formatRelativeTime(run.startedAt)}
        </span>
      </div>
      <RemoteRunSourceBanner source={remoteRunSource} />
      {(displayStatus === "error" || displayStatus === "cancelled") && !runnerDeclaredFailure ? (
        <div className="border-border/20 border-b px-4 py-2">
          <p className="text-muted-foreground text-xs">
            {displayStatus === "cancelled"
              ? (run.errorMessage ?? "Run cancelled.")
              : (run.errorMessage ?? "Run failed.")}
          </p>
          <RunDebugDetails
            className="mt-2"
            debugInfo={run.debugInfo}
            fallbackTimestamp={run.finishedAt ?? run.startedAt}
          />
        </div>
      ) : null}
      <div className="bg-background flex min-h-0 flex-1 overflow-hidden">
        <RunnerDeclaredFailureChatArea
          conversationId={run.conversationId}
          debugInfo={run.debugInfo}
          runnerDeclaredFailure={runnerDeclaredFailure}
        />
      </div>
    </div>
  );
}

function BackToRunsButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="text-muted-foreground hover:text-foreground hover:bg-muted -ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors"
    >
      <ArrowLeft className="h-3 w-3" />
      <T>Runs</T>
    </button>
  );
}
