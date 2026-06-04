import { Check, AlertCircle, ChevronRight, Eye, StopCircle, Timer } from "lucide-react";
import { motion, AnimatePresence, type Transition } from "motion/react";
import { useCallback, useMemo, useState } from "react";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { getExecutorDisplayMetadata } from "@/lib/executor-tool";
import { cn } from "@/lib/utils";
import { useWorkspaceMcpServerList } from "@/orpc/hooks/workspace-mcp-servers";
import type { MessageTiming } from "./chat-performance-metrics";
import { ActivityItem, type ActivityItemData } from "./activity-item";
import { formatDuration } from "./chat-performance-metrics";
import { IntegrationBadges } from "./integration-badges";

const COLLAPSED_TRACE_EXPANDED_INITIAL = { height: 0, opacity: 0 };
const COLLAPSED_TRACE_EXPANDED_ANIMATE = { height: "auto", opacity: 1 };
const COLLAPSED_TRACE_EXPANDED_EXIT = { height: 0, opacity: 0 };
const COLLAPSED_TRACE_EXPANDED_TRANSITION: Transition = {
  duration: 0.2,
  ease: "easeInOut",
};
const EMPTY_ACTIVITY_ITEMS: ActivityItemData[] = [];

type Props = {
  messageId: string;
  integrationsUsed: DisplayIntegrationType[];
  hasError: boolean;
  activityItems?: ActivityItemData[];
  timing?: MessageTiming;
  className?: string;
  defaultExpanded?: boolean;
  onToggleExpand?: () => void;
};

export function CollapsedTrace({
  integrationsUsed,
  hasError,
  activityItems = EMPTY_ACTIVITY_ITEMS,
  timing,
  className,
  defaultExpanded = false,
  onToggleExpand,
}: Props) {
  const { data: executorSourceData } = useWorkspaceMcpServerList();
  const executorSources = useMemo(
    () => executorSourceData?.sources ?? [],
    [executorSourceData?.sources],
  );
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasInterrupted = activityItems.some(
    (item) =>
      item.status === "interrupted" ||
      (item.type === "system" && item.content === "Interrupted by user"),
  );
  const hasRunning = activityItems.some((item) => item.status === "running");
  const summaryDuration = useMemo(() => {
    if (timing?.endToEndDurationMs !== undefined) {
      return formatDuration(timing.endToEndDurationMs);
    }
    if (timing?.generationDurationMs !== undefined) {
      return formatDuration(timing.generationDurationMs);
    }
    if (timing?.phaseDurationsMs) {
      const phaseTotalMs = Object.values(timing.phaseDurationsMs).reduce((sum, value) => {
        if (typeof value !== "number") {
          return sum;
        }
        return sum + value;
      }, 0);
      if (phaseTotalMs > 0) {
        return formatDuration(phaseTotalMs);
      }
    }

    const toolElapsedTotal = activityItems.reduce((sum, item) => {
      if (item.type !== "tool_call") {
        return sum;
      }
      return sum + (item.elapsedMs ?? 0);
    }, 0);

    if (toolElapsedTotal > 0) {
      return formatDuration(toolElapsedTotal);
    }

    if (activityItems.length >= 2) {
      const firstTs = activityItems[0]?.timestamp;
      const lastTs = activityItems[activityItems.length - 1]?.timestamp;
      if (typeof firstTs === "number" && typeof lastTs === "number" && lastTs >= firstTs) {
        return formatDuration(lastTs - firstTs);
      }
    }

    return null;
  }, [activityItems, timing]);
  const displayIntegrations = useMemo(() => {
    const next = new Set<DisplayIntegrationType>(integrationsUsed);

    for (const item of activityItems) {
      if (item.type !== "tool_call") {
        continue;
      }

      const derived = getExecutorDisplayMetadata(item.input, executorSources, item.toolName);
      if (derived.integration) {
        next.add(derived.integration);
      }
    }

    return [...next];
  }, [activityItems, executorSources, integrationsUsed]);

  // Handle toggle - use external handler if provided
  const handleToggle = useCallback(() => {
    if (onToggleExpand) {
      onToggleExpand();
    }
    setIsExpanded((prev) => !prev);
  }, [onToggleExpand]);

  return (
    <div
      className={cn("rounded-lg border border-border/50 bg-muted/20 overflow-hidden", className)}
    >
      {/* Header - always visible */}
      <button
        onClick={handleToggle}
        className="hover:bg-muted/30 flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-90",
          )}
        />

        {hasInterrupted ? (
          <>
            <StopCircle className="h-4 w-4 text-orange-500" />
            <span className="text-muted-foreground">Interrupted by user</span>
          </>
        ) : hasError ? (
          <>
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <span className="text-muted-foreground">Completed with error</span>
          </>
        ) : (
          <>
            <Check className="h-4 w-4 text-green-500" />
            <span className="text-muted-foreground">{hasRunning ? "Working..." : "Done"}</span>
          </>
        )}

        <div className="flex-1" />

        <IntegrationBadges integrations={displayIntegrations} size="sm" />

        {summaryDuration && (
          <div className="text-muted-foreground/70 ml-2 inline-flex items-center gap-1 text-xs">
            <Timer className="h-3 w-3" />
            <span>{summaryDuration}</span>
          </div>
        )}

        <div className="text-muted-foreground/60 ml-2 flex items-center gap-1 text-xs">
          <Eye className="h-3 w-3" />
          <span>View</span>
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={COLLAPSED_TRACE_EXPANDED_INITIAL}
            animate={COLLAPSED_TRACE_EXPANDED_ANIMATE}
            exit={COLLAPSED_TRACE_EXPANDED_EXIT}
            transition={COLLAPSED_TRACE_EXPANDED_TRANSITION}
            className="overflow-hidden"
          >
            <div className="border-border/30 max-h-[300px] overflow-y-auto border-t px-3 py-2">
              {activityItems.length > 0 ? (
                <div className="space-y-0.5">
                  {activityItems.map((item) => (
                    <ActivityItem key={item.id} item={item} executorSources={executorSources} />
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs italic">
                  Activity details not available
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
