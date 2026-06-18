import { msg } from "gt-react";
import { Timer } from "lucide-react";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import {
  createGenerationRuntime,
  type RuntimeActivitySegment,
  type RuntimeSnapshot,
} from "@/lib/generation-runtime";
import { ActivityFeed, type ActivityItemData } from "../activity-feed";
import { formatDuration } from "../chat-performance-metrics";
import type { Message } from "../message-list";
import type { PersistedContentPart } from "./chat-message-mapping";

export type ActivitySegment = Omit<RuntimeActivitySegment, "items"> & {
  items: ActivityItemData[];
};

export type HistoricalActivityBlock = {
  id: string;
  generationId: string;
  items: ActivityItemData[];
  integrationsUsed: DisplayIntegrationType[];
  runtimeLimitMs: number | null;
  awaitingResume: boolean;
};

export type PendingRunDeadlineResumeState = {
  generationId: string;
  debugRunDeadlineMs: number | null;
};

export const RUN_DEADLINE_DEFAULT_MS = 15 * 60 * 1000;
export const RUN_DEADLINE_RESUME_SEGMENT_ID = "runtime-deadline-resume";
export const RUN_DEADLINE_RESUME_TOOL_USE_ID = "runtime-deadline-resume-tool";
export const EMPTY_ACTIVITY_ITEMS: ActivityItemData[] = [];
export const NOOP_ACTIVITY_TOGGLE = () => {};

export function stripResolvedInterruptFromSegments(
  segments: ActivitySegment[],
  interruptId: string,
  kind: "approval" | "auth",
): ActivitySegment[] {
  return segments.flatMap((segment) => {
    const nextSegment: ActivitySegment = {
      ...segment,
      items: [...segment.items],
      approval:
        kind === "approval" && segment.approval?.interruptId === interruptId
          ? undefined
          : segment.approval,
      auth: kind === "auth" && segment.auth?.interruptId === interruptId ? undefined : segment.auth,
    };

    if (
      nextSegment.items.length === 0 &&
      !nextSegment.approval &&
      !nextSegment.auth &&
      segments.length > 1
    ) {
      return [];
    }

    return [nextSegment];
  });
}

export function markResolvedAuthInterruptInSegments(
  segments: ActivitySegment[],
  interruptId: string,
  integration: string,
): ActivitySegment[] {
  return segments.map((segment) => {
    if (segment.auth?.interruptId !== interruptId) {
      return segment;
    }

    const connectedIntegrations = segment.auth.connectedIntegrations.includes(integration)
      ? segment.auth.connectedIntegrations
      : [...segment.auth.connectedIntegrations, integration];
    const remainingIntegrations = segment.auth.integrations.filter(
      (candidate) => !connectedIntegrations.includes(candidate),
    );

    return {
      ...segment,
      auth: {
        ...segment.auth,
        connectedIntegrations,
        status: remainingIntegrations.length === 0 ? "completed" : "connecting",
      },
    };
  });
}

export function markResolvedApprovalInterruptInSegments(
  segments: ActivitySegment[],
  interruptId: string,
  questionAnswers?: string[][],
): ActivitySegment[] {
  return segments.map((segment) => {
    if (segment.approval?.interruptId !== interruptId) {
      return segment;
    }

    return {
      ...segment,
      approval: {
        ...segment.approval,
        interruptId: undefined,
        status: "approved",
        questionAnswers,
      },
    };
  });
}

export function buildRunDeadlineResumeSegment(
  pendingRunDeadline: PendingRunDeadlineResumeState,
): ActivitySegment {
  const runtimeLimitLabel = formatDuration(
    pendingRunDeadline.debugRunDeadlineMs ?? RUN_DEADLINE_DEFAULT_MS,
  );

  return {
    id: RUN_DEADLINE_RESUME_SEGMENT_ID,
    items: EMPTY_ACTIVITY_ITEMS,
    isExpanded: false,
    approval: {
      toolUseId: RUN_DEADLINE_RESUME_TOOL_USE_ID,
      toolName: "question",
      toolInput: {
        questions: [
          {
            header: "Runtime limit reached",
            question: `This run hit the ${runtimeLimitLabel} max runtime and stopped. Do you want to continue from where it left off?`,
            options: [
              {
                label: msg("Yes"),
                description: msg("Resume this run in a new sandbox."),
              },
            ],
          },
        ],
      },
      integration: "bap",
      operation: "question",
      status: "pending",
    },
  };
}

export function buildHistoricalActivityBlock(params: {
  generationId: string;
  runtimeLimitMs: number | null;
  snapshot: RuntimeSnapshot;
}): HistoricalActivityBlock | null {
  const items = params.snapshot.segments.flatMap((segment) =>
    segment.items.map((item) => ({
      ...item,
      integration: item.integration as DisplayIntegrationType | undefined,
    })),
  );

  if (items.length === 0) {
    return null;
  }

  const integrationsUsed = Array.from(
    new Set(
      items
        .map((item) => item.integration)
        .filter((integration): integration is DisplayIntegrationType => Boolean(integration)),
    ),
  );

  return {
    id: `historical-${params.generationId}`,
    generationId: params.generationId,
    items,
    integrationsUsed,
    runtimeLimitMs: params.runtimeLimitMs,
    awaitingResume: true,
  };
}

export function buildHistoricalActivityBlockFromContentParts(params: {
  generationId: string;
  runtimeLimitMs: number | null;
  contentParts: PersistedContentPart[];
}): HistoricalActivityBlock | null {
  const runtime = createGenerationRuntime();

  for (const part of params.contentParts) {
    switch (part.type) {
      case "text":
        runtime.handleText(part.text);
        break;
      case "thinking":
        runtime.handleThinking({
          thinkingId: part.id,
          content: part.content,
        });
        break;
      case "tool_use":
        runtime.handleToolUse({
          toolName: part.name,
          toolInput: part.input,
          toolUseId: part.id,
          integration: part.integration,
          operation: part.operation,
        });
        break;
      case "tool_result":
        runtime.handleToolResult("tool_result", part.content, part.tool_use_id);
        break;
      case "approval":
        runtime.handleApproval({
          toolUseId: part.tool_use_id,
          toolName: part.tool_name,
          toolInput: part.tool_input,
          integration: part.integration,
          operation: part.operation,
          command: part.command,
          status: part.status,
          questionAnswers: part.question_answers,
        });
        break;
      case "system":
        runtime.handleSystem(part.content);
        break;
      case "coworker_invocation":
        runtime.handleSystem(part.message);
        break;
      default:
        break;
    }
  }

  return buildHistoricalActivityBlock({
    generationId: params.generationId,
    runtimeLimitMs: params.runtimeLimitMs,
    snapshot: runtime.snapshot,
  });
}

export function isContinueMessage(message: Message): boolean {
  return message.role === "user" && message.content.trim().toLowerCase() === "continue";
}

export function renderHistoricalActivityBlock(block: HistoricalActivityBlock) {
  const runtimeLimitLabel = formatDuration(block.runtimeLimitMs ?? RUN_DEADLINE_DEFAULT_MS);

  return (
    <div key={block.id} className="space-y-2 py-4">
      <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs">
        <Timer className="h-3.5 w-3.5" />
        <span>
          {block.awaitingResume
            ? `Stopped after max runtime of ${runtimeLimitLabel}.`
            : `Stopped after max runtime of ${runtimeLimitLabel}. Resumed below.`}
        </span>
      </div>
      <ActivityFeed
        items={block.items}
        isStreaming={false}
        isExpanded={false}
        onToggleExpand={NOOP_ACTIVITY_TOGGLE}
        integrationsUsed={block.integrationsUsed}
      />
    </div>
  );
}
