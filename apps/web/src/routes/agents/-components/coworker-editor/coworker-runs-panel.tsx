import { T } from "gt-react";
import { Circle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback } from "react";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { cn } from "@/lib/utils";
import { AppImage as Image } from "../../-lib/app-image";
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
  const groupedRuns = (runs ?? []).reduce<
    Array<{ key: string; scheduled: boolean; runs: CoworkerRunListItem[] }>
  >((groups, run) => {
    const key = run.scheduleOccurrenceId ?? run.id;
    const existing = groups.find((group) => group.key === key);
    if (existing) {
      existing.runs.push(run);
    } else {
      groups.push({ key, scheduled: Boolean(run.scheduleOccurrenceId), runs: [run] });
    }
    return groups;
  }, []);
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
          {groupedRuns.length > 0 ? (
            <div className="-mx-1">
              {groupedRuns.map((group) => (
                <div key={group.key} className="mb-1">
                  {group.scheduled ? (
                    <p className="text-muted-foreground px-2 pb-1 pt-2 text-[11px] font-medium">
                      {new Date(group.runs[0]!.startedAt).toLocaleString()} · {group.runs.length}{" "}
                      <T>member runs</T>
                    </p>
                  ) : null}
                  {group.runs.map((run) => (
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
                                : run.status === "cancelling"
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
                      {run.runner ? (
                        <span className="flex min-w-0 items-center gap-1.5 text-xs">
                          {run.runner.image ? (
                            <Image
                              src={run.runner.image}
                              alt=""
                              width={18}
                              height={18}
                              className="size-[18px] rounded-full object-cover"
                            />
                          ) : (
                            <span className="bg-muted flex size-[18px] items-center justify-center rounded-full text-[8px] font-semibold">
                              {run.runner.name.charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="max-w-32 truncate">{run.runner.name}</span>
                        </span>
                      ) : null}
                      <span className="text-muted-foreground ml-auto text-xs">
                        {formatRelativeTime(run.startedAt)}
                      </span>
                    </button>
                  ))}
                </div>
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
