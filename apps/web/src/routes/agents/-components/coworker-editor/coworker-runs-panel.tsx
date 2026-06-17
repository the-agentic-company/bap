import { T } from "gt-react";
import { Circle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback } from "react";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "./coworker-editor-utils";
import { InlineRunViewer } from "./inline-run-viewer";
import type { CoworkerRunListItem } from "./types";

const runViewerMotionInitial = { opacity: 0, x: 24 } as const;
const runViewerMotionAnimate = { opacity: 1, x: 0 } as const;
const runViewerMotionExit = { opacity: 0, x: 24 } as const;
const runListMotionInitial = { opacity: 0, x: -24 } as const;
const runListMotionAnimate = { opacity: 1, x: 0 } as const;
const runListMotionExit = { opacity: 0, x: -24 } as const;
const runMotionTransition = { duration: 0.2, ease: "easeOut" } as const;

type CoworkerRunsPanelProps = {
  runs: CoworkerRunListItem[] | undefined;
  selectedRunId: string | null;
  coworkerId?: string;
  coworkerRouteSlug?: string;
  onSelectRun: (runId: string) => void;
  onBackToRuns: () => void;
};

export function CoworkerRunsPanel({
  runs,
  selectedRunId,
  coworkerId,
  coworkerRouteSlug,
  onSelectRun,
  onBackToRuns,
}: CoworkerRunsPanelProps) {
  const handleSelectRun = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const runId = event.currentTarget.dataset.runId;
      if (runId) {
        onSelectRun(runId);
      }
    },
    [onSelectRun],
  );

  return (
    <AnimatePresence mode="wait" initial={false}>
      {selectedRunId ? (
        <motion.div
          key="run-viewer"
          initial={runViewerMotionInitial}
          animate={runViewerMotionAnimate}
          exit={runViewerMotionExit}
          transition={runMotionTransition}
          className="flex min-h-0 flex-1 flex-col"
        >
          <InlineRunViewer
            runId={selectedRunId}
            coworkerId={coworkerId}
            coworkerRouteSlug={coworkerRouteSlug}
            onBack={onBackToRuns}
          />
        </motion.div>
      ) : (
        <motion.div
          key="run-list"
          initial={runListMotionInitial}
          animate={runListMotionAnimate}
          exit={runListMotionExit}
          transition={runMotionTransition}
          className="px-4 py-3"
        >
          {runs && runs.length > 0 ? (
            <div className="-mx-1">
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  data-run-id={run.id}
                  onClick={handleSelectRun}
                  className="hover:bg-muted/40 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors"
                >
                  <Circle
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 fill-current",
                      run.status === "completed"
                        ? "text-emerald-500"
                        : run.status === "running" ||
                            run.status === "awaiting_approval" ||
                            run.status === "awaiting_auth"
                          ? "text-blue-500"
                          : run.status === "paused"
                            ? "text-amber-500"
                            : run.status === "needs_user_input"
                              ? "text-emerald-500"
                              : run.status === "error" || run.status === "cancelled"
                                ? "text-red-500"
                                : "text-muted-foreground",
                    )}
                  />
                  <span className="text-foreground/70 text-xs">
                    {getCoworkerRunStatusLabel(run.status)}
                  </span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {formatRelativeTime(run.startedAt)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              <T>No runs yet.</T>
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
