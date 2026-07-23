import { T } from "gt-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, useCallback, useEffect } from "react";
import type { AttachmentData } from "@/components/prompt-bar";
import type { RuntimeSegmentApproval, RuntimeSegmentAuth } from "@/lib/generation-runtime";
import type { PromptSegment } from "@/lib/prompt-segments";
import { PromptBar } from "@/components/prompt-bar";
import { cn } from "@/lib/utils";
import { AuthRequestCard } from "./auth-request-card";
import { ToolApprovalCard } from "./tool-approval-card";

const NOOP = () => {};
const NOOP_WITH_ANSWERS = (() => {}) as (questionAnswers?: string[][]) => void;

type PendingItem =
  | {
      type: "approval";
      segmentId: string;
      approval: RuntimeSegmentApproval;
    }
  | {
      type: "auth";
      segmentId: string;
      auth: RuntimeSegmentAuth;
    };

type Segment = {
  id: string;
  approval?: RuntimeSegmentApproval;
  auth?: RuntimeSegmentAuth;
};

type BottomActionBarProps = {
  // Segment data
  segments: Segment[];
  segmentApproveHandlers: Map<string, (questionAnswers?: string[][]) => void>;
  segmentDenyHandlers: Map<string, () => void>;
  isApproving: boolean;

  // Auth handlers
  handleAuthConnect: (integration: string) => void;
  handleAuthCancel: () => void;
  isSubmittingAuth: boolean;
  authIntegrations?: string[];
  authConnectedIntegrations?: string[];

  // PromptBar props passthrough
  onSubmit: (
    text: string,
    attachments?: AttachmentData[],
  ) => void | boolean | Promise<void | boolean>;
  onStop?: () => void;
  isSubmitting?: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  animatedPlaceholders?: string[];
  richAnimatedPlaceholders?: PromptSegment[][];
  onAnimatedPlaceholderIndexChange?: (index: number) => void;
  shouldAnimatePlaceholder?: boolean;
  isRecording?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  voiceInteractionMode?: "press-to-talk" | "toggle";
  interimTranscript?: string;
  conversationId?: string;
  prefillRequest?: { id: string; text: string; mode?: "replace" | "append" } | null;
  renderSkills?: React.ReactNode;
  renderModelSelector?: React.ReactNode;
  renderAutoApproval?: React.ReactNode;
  renderDebugControls?: React.ReactNode;
};

export function BottomActionBar({
  segments,
  segmentApproveHandlers,
  segmentDenyHandlers,
  isApproving,
  handleAuthConnect,
  handleAuthCancel,
  isSubmittingAuth,
  ...promptBarProps
}: BottomActionBarProps) {
  const pendingItems = useMemo(() => {
    const items: PendingItem[] = [];
    for (const segment of segments) {
      if (segment.approval?.status === "pending") {
        items.push({ type: "approval", segmentId: segment.id, approval: segment.approval });
      }
      if (segment.auth?.status === "pending") {
        items.push({ type: "auth", segmentId: segment.id, auth: segment.auth });
      }
    }
    return items;
  }, [segments]);

  const [currentIndex, setCurrentIndex] = useState(0);

  // Reset index when pending items change
  useEffect(() => {
    if (currentIndex >= pendingItems.length) {
      setCurrentIndex(Math.max(0, pendingItems.length - 1));
    }
  }, [pendingItems.length, currentIndex]);

  const handlePrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(pendingItems.length - 1, i + 1));
  }, [pendingItems.length]);

  if (pendingItems.length === 0) {
    return <PromptBar {...promptBarProps} />;
  }

  const currentItem = pendingItems[Math.min(currentIndex, pendingItems.length - 1)];
  if (!currentItem) {
    return <PromptBar {...promptBarProps} />;
  }

  return (
    <div className="border-border/60 overflow-hidden rounded-2xl border bg-stone-50/80 shadow-sm">
      {/* Navigation header when multiple pending items */}
      {pendingItems.length > 1 && (
        <div className="flex items-center justify-between border-b px-4 py-2">
          <button
            type="button"
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              currentIndex === 0
                ? "text-muted-foreground/40 cursor-not-allowed"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-muted-foreground text-sm">
            {currentIndex + 1} <T>of</T> {pendingItems.length}
          </span>
          <button
            type="button"
            onClick={handleNext}
            disabled={currentIndex >= pendingItems.length - 1}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              currentIndex >= pendingItems.length - 1
                ? "text-muted-foreground/40 cursor-not-allowed"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Pending item content */}
      <div className="p-3">
        {currentItem.type === "approval" && (
          <ToolApprovalCard
            toolUseId={currentItem.approval.toolUseId}
            toolName={currentItem.approval.toolName}
            toolInput={currentItem.approval.toolInput}
            integration={currentItem.approval.integration}
            operation={currentItem.approval.operation}
            command={currentItem.approval.command}
            status={currentItem.approval.status}
            isLoading={isApproving}
            onApprove={segmentApproveHandlers.get(currentItem.segmentId) ?? NOOP_WITH_ANSWERS}
            onDeny={segmentDenyHandlers.get(currentItem.segmentId) ?? NOOP}
          />
        )}
        {currentItem.type === "auth" && (
          <AuthRequestCard
            integrations={currentItem.auth.integrations}
            connectedIntegrations={currentItem.auth.connectedIntegrations}
            reason={currentItem.auth.reason}
            status={currentItem.auth.status}
            isLoading={isSubmittingAuth}
            onConnect={handleAuthConnect}
            onCancel={handleAuthCancel}
          />
        )}
      </div>
    </div>
  );
}
