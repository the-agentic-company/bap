import { useParams as useTanStackParams, useRouterState } from "@tanstack/react-router";
import { T } from "gt-react";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";
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
import { useCoworkerRun, useCoworkerRunImpersonationTarget } from "@/orpc/hooks/coworkers";

export default function CoworkerRunPage() {
  const params = useTanStackParams({ strict: false, shouldThrow: false }) as { id?: string };
  const { pathname, searchStr } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      searchStr: state.location.searchStr,
    }),
  });
  const searchParams = useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);
  const runId = params?.id;
  const { data: run, isLoading } = useCoworkerRun(runId);
  const shouldLoadImpersonationTarget = Boolean(runId && !isLoading && !run);
  const { data: impersonationTarget, isLoading: isImpersonationTargetLoading } =
    useCoworkerRunImpersonationTarget(runId, null, {
      enabled: shouldLoadImpersonationTarget,
    });
  const redirectPath = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : (pathname ?? `/agents/runs/${runId}`);
  }, [pathname, runId, searchParams]);

  if (isLoading || (shouldLoadImpersonationTarget && isImpersonationTargetLoading)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!run) {
    if (impersonationTarget) {
      return <ImpersonationRequiredPage target={impersonationTarget} redirectPath={redirectPath} />;
    }

    return (
      <div className="text-muted-foreground p-6 text-sm">
        <T>Run not found.</T>
      </div>
    );
  }

  const remoteRunSource = extractRemoteRunSourceDetails(run);
  const runnerDeclaredFailure = isRunnerDeclaredFailure(run.failureKind);

  if (!run.conversationId) {
    return (
      <div className="space-y-4 p-6">
        <h3 className="text-lg font-semibold">
          <T>Run details unavailable in chat view</T>
        </h3>
        <RemoteRunSourceBanner source={remoteRunSource} />
        <p className="text-muted-foreground text-sm">
          <T>
            This run does not have a linked conversation, so it cannot be opened in the chat
            interface.
          </T>
        </p>
        {runnerDeclaredFailure ? (
          <RunnerDeclaredFailureNote className="rounded-md border" debugInfo={run.debugInfo} />
        ) : (
          <RunDebugDetails
            debugInfo={run.debugInfo}
            fallbackTimestamp={run.finishedAt ?? run.startedAt}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <RemoteRunSourceBanner source={remoteRunSource} />
      {(run.status === "error" || run.status === "cancelled") && !runnerDeclaredFailure && (
        <div className="border-b p-4">
          <p className="text-sm font-medium">
            {run.status === "cancelled" ? <T>Run cancelled</T> : <T>Run failed</T>}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {run.status === "cancelled" ? "Run cancelled." : (run.errorMessage ?? "Run failed.")}
          </p>
          <RunDebugDetails
            debugInfo={run.debugInfo}
            fallbackTimestamp={run.finishedAt ?? run.startedAt}
          />
        </div>
      )}
      <RunnerDeclaredFailureChatArea
        conversationId={run.conversationId}
        debugInfo={run.debugInfo}
        runnerDeclaredFailure={runnerDeclaredFailure}
      />
    </div>
  );
}
