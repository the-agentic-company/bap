import { T } from "gt-react";
import { AlertCircle } from "lucide-react";
import { useMemo } from "react";
import { ChatArea } from "@/components/chat/chat-area";
import { cn } from "@/lib/utils";

type RunnerDeclaredFailureNoteProps = {
  className?: string;
  debugInfo: unknown;
};

export function isRunnerDeclaredFailure(failureKind?: string | null) {
  return failureKind === "runner_declared_failure";
}

export function getRunnerDeclaredFailureReason(debugInfo: unknown) {
  if (!debugInfo || typeof debugInfo !== "object") {
    return null;
  }

  const reason = (debugInfo as Record<string, unknown>).reason;
  return typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;
}

export function RunnerDeclaredFailureNote({
  className,
  debugInfo,
}: RunnerDeclaredFailureNoteProps) {
  const reason = getRunnerDeclaredFailureReason(debugInfo);

  return (
    <div
      className={cn(
        "border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <T>The agent marked the run as failed with the reason</T>{" "}
        <code className="bg-background/80 text-foreground rounded px-1 py-0.5 text-xs break-all">
          {reason ?? "unknown"}
        </code>
        .
      </span>
    </div>
  );
}

export function RunnerDeclaredFailureChatArea({
  compact,
  conversationId,
  debugInfo,
  hideStreamError,
  runnerDeclaredFailure,
}: {
  compact?: boolean;
  conversationId: string;
  debugInfo: unknown;
  hideStreamError?: boolean;
  runnerDeclaredFailure: boolean;
}) {
  const transcriptFooter = useMemo(
    () =>
      runnerDeclaredFailure ? (
        <RunnerDeclaredFailureNote className="mb-4" debugInfo={debugInfo} />
      ) : null,
    [debugInfo, runnerDeclaredFailure],
  );

  return (
    <ChatArea
      conversationId={conversationId}
      compact={compact}
      hideStreamError={hideStreamError}
      transcriptFooter={transcriptFooter}
    />
  );
}
