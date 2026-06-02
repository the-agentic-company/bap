"use client";

import {
  DEFAULT_CONNECTED_CHATGPT_MODEL,
  resolveDefaultChatModel,
  shouldMigrateLegacyDefaultModel,
} from "@cmdclaw/core/lib/chat-model-defaults";
import { GENERATION_ERROR_PHASES } from "@cmdclaw/core/lib/generation-errors";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Activity,
  Check,
  CircleCheck,
  ListTree,
  PenLine,
  Search,
  Sparkles,
  Timer,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { usePostHog } from "posthog-js/react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import type { StatusChangeMetadata } from "@/lib/generation-stream";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { useChatHeaderActions } from "@/app/chat/chat-header-actions-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DualPanelWorkspace } from "@/components/ui/dual-panel-workspace";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useVoiceRecording, blobToBase64 } from "@/hooks/use-voice-recording";
import { isModelAccessibleForNewChat } from "@/lib/chat-model-access";
import { normalizeChatModelReference } from "@/lib/chat-model-reference";
import {
  normalizeChatModelSelection,
  resolveDefaultChatModelSelection,
} from "@/lib/chat-model-selection";
import { normalizeGenerationError, type NormalizedGenerationError } from "@/lib/generation-errors";
import {
  createGenerationRuntime,
  type GenerationRuntime,
  type RuntimeActivityStats,
  type RuntimeActivitySegment,
  type RuntimeSnapshot,
} from "@/lib/generation-runtime";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import { buildProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import { client } from "@/orpc/client";
import {
  useConversation,
  useTranscribe,
  useGeneration,
  useSubmitApproval,
  useSubmitAuthResult,
  useGetAuthUrl,
  useActiveGeneration,
  useCancelGeneration,
  useDetectUserMessageLanguage,
  useConversationQueuedMessages,
  useEnqueueConversationMessage,
  useRemoveConversationQueuedMessage,
  useUpdateConversationQueuedMessage,
  usePlatformSkillList,
  useSkillList,
  useUpdateAutoApprove,
  useProviderAuthStatus,
  useOpencodeFreeModels,
  type SandboxFileData,
} from "@/orpc/hooks";
import { ActivityFeed, type ActivityItemData } from "./activity-feed";
import { AuthRequestCard } from "./auth-request-card";
import { BottomActionBar } from "./bottom-action-bar";
import {
  ChatDebugPopover,
  type ArmedDebugPreset,
  type ChatDebugSnapshot,
} from "./chat-debug-popover";
import { mergePersistedConversationMessages } from "./chat-message-sync";
import { useChatModelStore } from "./chat-model-store";
import { formatDuration } from "./chat-performance-metrics";
import { useChatSkillStore } from "./chat-skill-store";
import { MessageList, type Message, type MessagePart, type AttachmentData } from "./message-list";
import { ModelSelector } from "./model-selector";
import { OutputHtmlPreviewPanel } from "./output-html-preview-panel";
import { findLatestOutputHtmlFile } from "./output-preview-selection";
import { isQuestionApprovalRequest } from "./question-approval-utils";
import { ToolApprovalCard } from "./tool-approval-card";
import { VoiceIndicator } from "./voice-indicator";

type TraceStatus = RuntimeSnapshot["traceStatus"];
type ActivitySegment = Omit<RuntimeActivitySegment, "items"> & {
  items: ActivityItemData[];
};

type HistoricalActivityBlock = {
  id: string;
  generationId: string;
  items: ActivityItemData[];
  integrationsUsed: DisplayIntegrationType[];
  runtimeLimitMs: number | null;
  awaitingResume: boolean;
};

type Props = {
  conversationId?: string;
  forceCoworkerQuerySync?: boolean;
  coworkerIdForSync?: string;
  onCoworkerSync?: (payload: { coworkerId: string; prompt?: string; updatedAt?: string }) => void;
  skillSelectionScopeKey?: string;
  initialPrefillText?: string | null;
  authCompletion?: { integration: string; interruptId: string } | null;
  enableOutputPreview?: boolean;
};

type QueuedMessage = {
  id: string;
  content: string;
  status: "queued" | "processing";
  attachments?: AttachmentData[];
  selectedPlatformSkillSlugs?: string[];
};

type RunGenerationOptions = {
  selectedSkillKeysOverride?: string[];
  resumePausedGenerationId?: string;
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
};

type PendingRunDeadlineResumeState = {
  generationId: string;
  debugRunDeadlineMs: number | null;
};

function stripResolvedInterruptFromSegments(
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

function markResolvedAuthInterruptInSegments(
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

function markResolvedApprovalInterruptInSegments(
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

function getQueuedMessageSummary(queuedMessage: QueuedMessage): string {
  if (queuedMessage.content) {
    return queuedMessage.content;
  }

  const attachmentCount = queuedMessage.attachments?.length ?? 0;
  return `${attachmentCount} queued attachment${attachmentCount === 1 ? "" : "s"}`;
}

function mergeDebugSnapshot(
  previous: ChatDebugSnapshot,
  update: Partial<ChatDebugSnapshot>,
): ChatDebugSnapshot {
  return {
    ...previous,
    ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)),
  };
}

type QueuedMessageRowProps = {
  queuedMessage: QueuedMessage;
  index: number;
  onSend: (queuedMessage: QueuedMessage) => void;
  onClear: (queuedMessage: QueuedMessage) => void;
  onEdit: (queuedMessage: QueuedMessage) => void;
};

function QueuedMessageRow({
  queuedMessage,
  index,
  onSend,
  onClear,
  onEdit,
}: QueuedMessageRowProps) {
  const isQueued = queuedMessage.status === "queued";
  const handleSend = useCallback(() => {
    onSend(queuedMessage);
  }, [onSend, queuedMessage]);
  const handleClear = useCallback(() => {
    onClear(queuedMessage);
  }, [onClear, queuedMessage]);
  const handleEdit = useCallback(() => {
    onEdit(queuedMessage);
  }, [onEdit, queuedMessage]);

  return (
    <div className="flex items-center justify-between gap-3 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {index + 1}. {getQueuedMessageSummary(queuedMessage)}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {queuedMessage.status === "processing"
            ? "Starting now."
            : "Queued and waiting for its turn."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {index === 0 ? (
          <Button
            size="sm"
            className="h-8 rounded-full px-3"
            variant="secondary"
            onClick={handleSend}
            disabled={!isQueued}
          >
            Steer
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleEdit}
          aria-label={`Edit queued message ${index + 1}`}
          className="rounded-full"
          disabled={!isQueued}
        >
          <PenLine className="h-4 w-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleClear}
          aria-label={`Delete queued message ${index + 1}`}
          className="rounded-full"
          disabled={!isQueued}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

type InputPrefillRequest = {
  id: string;
  text: string;
  mode?: "replace" | "append";
};

type ChatExternalSendDetail = {
  conversationId: string;
  content: string;
  attachments?: AttachmentData[];
};

type ChatStarter = {
  label: string;
  prompt: string;
};

type ChatStarterSection = {
  title: string;
  description: string;
  items: ChatStarter[];
};

export const CHAT_EXTERNAL_SEND_EVENT = "chat:external-send";

const CHAT_CONVERSATION_ID_SYNC_EVENT = "chat:conversation-id-sync";
const EMPTY_SELECTED_SKILLS: string[] = [];
const EMPTY_ACTIVITY_ITEMS: ActivityItemData[] = [];
const NON_ERROR_INIT_END_REASONS = new Set(["cancelled", "user_stopped"]);
const CUSTOM_SKILL_PREFIX = "custom:";
const DEFAULT_VISIBLE_CHAT_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;
const RUN_DEADLINE_DEFAULT_MS = 15 * 60 * 1000;
const RUN_DEADLINE_RESUME_SEGMENT_ID = "runtime-deadline-resume";
const RUN_DEADLINE_RESUME_TOOL_USE_ID = "runtime-deadline-resume-tool";
const NOOP_ACTIVITY_TOGGLE = () => {};
const NOOP_APPROVAL = () => {};
const NOOP_APPROVAL_WITH_ANSWERS = (() => {}) as (questionAnswers?: string[][]) => void;

function buildRunDeadlineResumeSegment(
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
                label: "Yes",
                description: "Resume this run in a new sandbox.",
              },
            ],
          },
        ],
      },
      integration: "cmdclaw",
      operation: "question",
      status: "pending",
    },
  };
}

function buildHistoricalActivityBlock(params: {
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

function buildHistoricalActivityBlockFromContentParts(params: {
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

function isContinueMessage(message: Message): boolean {
  return message.role === "user" && message.content.trim().toLowerCase() === "continue";
}

function renderHistoricalActivityBlock(block: HistoricalActivityBlock) {
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

function extractCoworkerSyncDataFromToolResult(result: unknown): {
  coworkerId?: string;
  prompt?: string;
  updatedAt?: string;
} {
  if (typeof result === "object" && result !== null) {
    const maybeCoworkerId = (result as { coworkerId?: unknown }).coworkerId;
    const maybeCoworker = (
      result as {
        coworker?: { prompt?: unknown; updatedAt?: unknown };
      }
    ).coworker;
    return {
      coworkerId: typeof maybeCoworkerId === "string" ? maybeCoworkerId : undefined,
      prompt: typeof maybeCoworker?.prompt === "string" ? maybeCoworker.prompt : undefined,
      updatedAt: typeof maybeCoworker?.updatedAt === "string" ? maybeCoworker.updatedAt : undefined,
    };
  }

  if (typeof result !== "string") {
    return {};
  }

  try {
    return extractCoworkerSyncDataFromToolResult(JSON.parse(result));
  } catch {
    return {};
  }
}

type PersistedContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      integration?: string;
      operation?: string;
    }
  | { type: "tool_result"; tool_use_id: string; content: unknown }
  | {
      type: "approval";
      tool_use_id: string;
      tool_name: string;
      tool_input: unknown;
      integration: string;
      operation: string;
      command?: string;
      status: "approved" | "denied";
      question_answers?: string[][];
    }
  | {
      type: "coworker_invocation";
      coworker_id: string;
      username: string;
      name: string;
      run_id: string;
      conversation_id: string;
      generation_id: string | null;
      status:
        | "running"
        | "needs_user_input"
        | "awaiting_approval"
        | "awaiting_auth"
        | "paused"
        | "completed"
        | "error"
        | "cancelled";
      attachment_names?: string[];
      message: string;
    }
  | { type: "thinking"; id: string; content: string }
  | { type: "system"; content: string };

type PersistedConversationMessage = {
  id: string;
  role: string;
  content: string;
  contentParts?: PersistedContentPart[];
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  sandboxFiles?: Array<{
    fileId: string;
    path: string;
    filename: string;
    mimeType: string;
    sizeBytes: number | null;
  }>;
  timing?: {
    endToEndDurationMs?: number;
    sandboxStartupDurationMs?: number;
    sandboxStartupMode?: "created" | "reused" | "unknown";
    generationDurationMs?: number;
    phaseDurationsMs?: {
      sandboxConnectOrCreateMs?: number;
      opencodeReadyMs?: number;
      sessionReadyMs?: number;
      agentInitMs?: number;
      prePromptSetupMs?: number;
      waitForFirstEventMs?: number;
      modelStreamMs?: number;
      postProcessingMs?: number;
    };
    phaseTimestamps?: Array<{
      phase: string;
      at: string;
      elapsedMs: number;
    }>;
    activityDurationsMs?: {
      totalToolCalls?: number;
      completedToolCalls?: number;
      totalToolDurationMs?: number;
      maxToolDurationMs?: number;
      perToolUseIdMs?: Record<string, number>;
    };
  };
};

function mapPersistedMessageToChatMessage(m: PersistedConversationMessage): Message {
  let parts: MessagePart[] | undefined;
  if (m.contentParts && m.contentParts.length > 0) {
    const toolResults = new Map<string, unknown>();
    for (const part of m.contentParts) {
      if (part.type === "tool_result") {
        toolResults.set(part.tool_use_id, part.content);
      }
    }
    parts = m.contentParts
      .filter((p) => p.type !== "tool_result")
      .map((p) => {
        if (p.type === "text") {
          return { type: "text" as const, content: p.text };
        }
        if (p.type === "thinking") {
          return {
            type: "thinking" as const,
            id: p.id,
            content: p.content,
          };
        }
        if (p.type === "system") {
          return { type: "system" as const, content: p.content };
        }
        if (p.type === "approval") {
          return {
            type: "approval" as const,
            toolUseId: p.tool_use_id,
            toolName: p.tool_name,
            toolInput: p.tool_input,
            integration: p.integration,
            operation: p.operation,
            command: p.command,
            status: p.status,
            questionAnswers: p.question_answers,
          };
        }
        if (p.type === "coworker_invocation") {
          return {
            type: "coworker_invocation" as const,
            coworkerId: p.coworker_id,
            username: p.username,
            name: p.name,
            runId: p.run_id,
            conversationId: p.conversation_id,
            generationId: p.generation_id,
            status: p.status,
            attachmentNames: p.attachment_names ?? [],
            message: p.message,
          };
        }
        return {
          type: "tool_call" as const,
          id: p.id,
          name: p.name,
          input: p.input,
          result: toolResults.get(p.id),
          integration: p.integration,
          operation: p.operation,
        };
      });
  }

  const attachments =
    m.attachments && m.attachments.length > 0
      ? m.attachments.map((a) => ({
          id: a.id,
          name: a.filename,
          mimeType: a.mimeType,
          dataUrl: "",
        }))
      : undefined;

  const sandboxFiles =
    m.sandboxFiles && m.sandboxFiles.length > 0
      ? m.sandboxFiles.map((f) => ({
          fileId: f.fileId,
          path: f.path,
          filename: f.filename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
        }))
      : undefined;

  return {
    id: m.id,
    role: m.role as Message["role"],
    content: m.content,
    parts,
    attachments,
    sandboxFiles,
    timing: m.timing,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withEndToEndDuration(
  timing: Message["timing"] | undefined,
  startedAtMs: number | undefined,
  completedAtMs = Date.now(),
): Message["timing"] | undefined {
  if (!startedAtMs) {
    return timing;
  }
  return {
    ...timing,
    endToEndDurationMs: Math.max(0, completedAtMs - startedAtMs),
  };
}

function withActivityDurations(
  timing: Message["timing"] | undefined,
  stats: RuntimeActivityStats,
): Message["timing"] | undefined {
  if (stats.totalToolCalls === 0) {
    return timing;
  }
  return {
    ...timing,
    activityDurationsMs: {
      ...timing?.activityDurationsMs,
      totalToolCalls: stats.totalToolCalls,
      completedToolCalls: stats.completedToolCalls,
      totalToolDurationMs: stats.totalToolDurationMs,
      maxToolDurationMs: stats.maxToolDurationMs,
      perToolUseIdMs: {
        ...timing?.activityDurationsMs?.perToolUseIdMs,
        ...stats.perToolUseIdMs,
      },
    },
  };
}

function buildSkillInstructionBlock(skillSlugs: string[], isFrench: boolean): string {
  const heading = isFrench
    ? "Utilise les skills suivants pour résoudre la tâche:"
    : "use the following skills to solve the task:";
  const skillsList = skillSlugs.map((skillSlug) => `- "${skillSlug}"`).join("\n");
  return `${heading}\n${skillsList}`;
}

function getAgentInitLabel(status: string | null): string {
  switch (status) {
    case "sandbox_init_started":
      return "Preparing sandbox...";
    case "sandbox_init_checking_cache":
      return "Checking sandbox...";
    case "sandbox_init_reused":
      return "Reusing sandbox...";
    case "sandbox_init_creating":
      return "Creating sandbox...";
    case "sandbox_init_created":
      return "Sandbox created...";
    case "sandbox_init_failed":
      return "Sandbox initialization failed...";
    case "agent_init_started":
      return "Preparing agent...";
    case "agent_init_opencode_starting":
      return "Starting agent server...";
    case "agent_init_opencode_waiting_ready":
      return "Waiting for agent server...";
    case "agent_init_opencode_ready":
      return "Agent server ready...";
    case "agent_init_session_reused":
      return "Reusing agent session...";
    case "agent_init_session_creating":
      return "Creating agent session...";
    case "agent_init_session_created":
      return "Agent session created...";
    case "agent_init_session_replay_started":
      return "Restoring previous context...";
    case "agent_init_session_replay_completed":
      return "Context restored...";
    case "agent_init_session_init_completed":
      return "Finalizing agent...";
    case "agent_init_ready":
      return "Agent ready...";
    case "agent_init_failed":
      return "Agent initialization failed...";
    default:
      return "Creating agent...";
  }
}

const CHAT_PLACEHOLDER_PROMPTS = [
  "What are my latest unread emails?",
  "Summarize unread Slack messages mentioning me",
  "What meetings do I have today and what should I know first?",
  "Every morning, send me a digest of unread emails and urgent Slack threads",
  "When a customer email sounds urgent, tag it and alert me in Slack",
  "Every afternoon, summarize calendar changes and open follow-ups",
];

const CHAT_QUICK_STARTERS: ChatStarter[] = [
  {
    label: "Latest emails",
    prompt:
      "What are my latest unread emails? Group them by urgency and tell me what needs a reply first.",
  },
  {
    label: "Unread Slack",
    prompt:
      "Show unread Slack messages and mentions that likely need my attention. Summarize each thread in one line.",
  },
  {
    label: "Today's meetings",
    prompt:
      "What meetings do I have today? List the time, attendees, and any preparation I should do before each one.",
  },
  {
    label: "Daily digest",
    prompt:
      "Create a daily digest workflow that sends me a morning summary of unread emails, important Slack threads, and today's meetings.",
  },
];

const CHAT_DISCOVER_SECTIONS: ChatStarterSection[] = [
  {
    title: "Ask Right Now",
    description: "One-shot prompts that pull from connected tools immediately.",
    items: [
      {
        label: "Inbox triage",
        prompt:
          "Review my latest unread emails, highlight the critical ones, and draft short reply points for the top 3.",
      },
      {
        label: "Slack catch-up",
        prompt:
          "Catch me up on unread Slack threads, especially anything blocking me or asking for a decision.",
      },
      {
        label: "Meeting prep",
        prompt:
          "Look at today's calendar and give me a prep brief for each meeting with likely action items.",
      },
      {
        label: "Follow-up list",
        prompt:
          "Find emails and messages from the last 48 hours that I should follow up on but have not answered yet.",
      },
    ],
  },
  {
    title: "Automate For Me",
    description: "Recurring or triggered workflows you can turn into a coworker.",
    items: [
      {
        label: "Morning brief",
        prompt:
          "Every morning at 8am, send me a digest of unread emails, urgent Slack threads, and today's meetings.",
      },
      {
        label: "Urgent email routing",
        prompt:
          "When a new email sounds urgent or frustrated, summarize it, suggest a reply, and alert me in Slack.",
      },
      {
        label: "Post-meeting recap",
        prompt:
          "After each calendar event ends, generate a recap draft with next steps and send it to me for review.",
      },
      {
        label: "End-of-day wrap-up",
        prompt:
          "Every weekday at 5pm, summarize what changed across email, Slack, and calendar and list unresolved items.",
      },
    ],
  },
];

const CHAT_STARTER_VARIANTS = {
  hidden: { opacity: 0, y: 6 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, delay: index * 0.04 },
  }),
} as const;

const CHAT_DISCOVER_PANEL_VARIANTS = {
  hidden: { opacity: 0, height: 0 },
  visible: {
    opacity: 1,
    height: "auto",
    transition: { duration: 0.25, ease: "easeInOut" },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.25, ease: "easeInOut" },
  },
} as const;

const CHAT_DISCOVER_ITEM_VARIANTS = {
  hidden: { opacity: 0, x: -4 },
  visible: (index: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.2, delay: index * 0.03 },
  }),
} as const;

export function ChatArea({
  conversationId,
  forceCoworkerQuerySync = false,
  coworkerIdForSync,
  onCoworkerSync,
  skillSelectionScopeKey: skillSelectionScopeKeyOverride,
  initialPrefillText,
  authCompletion,
  enableOutputPreview = false,
}: Props) {
  const { setHeaderActions } = useChatHeaderActions();
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const { data: platformSkills, isLoading: isPlatformSkillsLoading } = usePlatformSkillList();
  const { data: accessibleSkills, isLoading: isAccessibleSkillsLoading } = useSkillList();
  const { data: existingConversation, isLoading } = useConversation(conversationId);
  const { startGeneration, subscribeToGeneration, abort } = useGeneration();
  const { mutateAsync: submitApproval, isPending: isApproving } = useSubmitApproval();
  const { mutateAsync: submitAuthResult, isPending: isSubmittingAuth } = useSubmitAuthResult();
  const { mutateAsync: getAuthUrl } = useGetAuthUrl();
  const { mutateAsync: cancelGeneration } = useCancelGeneration();
  const { mutateAsync: detectUserMessageLanguage } = useDetectUserMessageLanguage();
  const { mutateAsync: enqueueConversationMessage } = useEnqueueConversationMessage();
  const { mutateAsync: removeConversationQueuedMessage } = useRemoveConversationQueuedMessage();
  const { mutateAsync: updateConversationQueuedMessage } = useUpdateConversationQueuedMessage();
  const { data: activeGeneration } = useActiveGeneration(conversationId);
  const { data: providerAuthStatus } = useProviderAuthStatus();
  const { data: opencodeFreeModelsData } = useOpencodeFreeModels();
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();

  // Track current generation ID
  const currentGenerationIdRef = useRef<string | undefined>(undefined);
  const locallyStoppedGenerationIdRef = useRef<string | null>(null);
  const runtimeRef = useRef<GenerationRuntime | null>(null);
  const coworkerEditToolUseIdsRef = useRef(new Set<string>());
  const authCompletionRef = useRef<{ integration: string; interruptId: string } | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingParts, setStreamingParts] = useState<MessagePart[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [localAutoApprove, setLocalAutoApprove] = useState(false);
  const selectedModel = useChatModelStore((state) => state.selectedModel);
  const selectedAuthSource = useChatModelStore((state) => state.selectedAuthSource);
  const setSelection = useChatModelStore((state) => state.setSelection);
  const normalizedSelectedSelection = useMemo(
    () =>
      normalizeChatModelSelection({
        model: selectedModel,
        authSource: selectedAuthSource,
      }),
    [selectedAuthSource, selectedModel],
  );
  const normalizedSelectedModel = useMemo(
    () => normalizedSelectedSelection.model || normalizeChatModelReference(selectedModel),
    [normalizedSelectedSelection.model, selectedModel],
  );
  const queueingEnabled = true;
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [inputPrefillRequest, setInputPrefillRequest] = useState<InputPrefillRequest | null>(null);
  const [armedDebugPreset, setArmedDebugPreset] = useState<ArmedDebugPreset | null>(null);
  const [chatDebugSnapshot, setChatDebugSnapshot] = useState<ChatDebugSnapshot>({});
  const [isResumingPausedRunDeadline, setIsResumingPausedRunDeadline] = useState(false);
  const [pendingRunDeadlineResume, setPendingRunDeadlineResume] =
    useState<PendingRunDeadlineResumeState | null>(null);
  const [historicalActivityBlocks, setHistoricalActivityBlocks] = useState<
    HistoricalActivityBlock[]
  >([]);
  const [dismissedRunDeadlineGenerationId, setDismissedRunDeadlineGenerationId] = useState<
    string | null
  >(null);
  const [editingQueuedMessageId, setEditingQueuedMessageId] = useState<string | null>(null);
  const [isDiscoverOpen, setIsDiscoverOpen] = useState(false);
  const initialPrefillAppliedRef = useRef(false);
  const [draftConversationId, setDraftConversationId] = useState<string | undefined>(
    conversationId,
  );
  const [isOutputPreviewCollapsed, setIsOutputPreviewCollapsed] = useState(false);
  const skillSelectionScopeKey = useMemo(
    () => skillSelectionScopeKeyOverride ?? draftConversationId ?? conversationId ?? "new-chat",
    [conversationId, draftConversationId, skillSelectionScopeKeyOverride],
  );
  const outputPreviewStorageKey = useMemo(() => {
    if (!enableOutputPreview) {
      return null;
    }
    return `chat-output-preview:${draftConversationId ?? conversationId ?? "new-chat"}`;
  }, [conversationId, draftConversationId, enableOutputPreview]);
  const selectedSkillSlugsByScope = useChatSkillStore((state) => state.selectedSkillSlugsByScope);
  const selectedSkillKeys =
    selectedSkillSlugsByScope[skillSelectionScopeKey] ?? EMPTY_SELECTED_SKILLS;
  const toggleSelectedSkillSlug = useChatSkillStore((state) => state.toggleSelectedSkillSlug);
  const clearSelectedSkillSlugs = useChatSkillStore((state) => state.clearSelectedSkillSlugs);
  const connectedProviders = providerAuthStatus?.connected;
  const sharedConnectedProviders = providerAuthStatus?.shared;

  // Segmented activity feed state
  const [segments, setSegments] = useState<ActivitySegment[]>([]);
  const [, setIntegrationsUsed] = useState<Set<DisplayIntegrationType>>(new Set());
  const [, setTraceStatus] = useState<TraceStatus>("complete");
  const [agentInitStatus, setAgentInitStatus] = useState<string | null>(null);
  const [streamClockNow, setStreamClockNow] = useState(() => Date.now());
  const [resumeGenerationNonce, setResumeGenerationNonce] = useState(0);

  // Sandbox files collected during streaming
  const [, setStreamingSandboxFiles] = useState<SandboxFileData[]>([]);

  const updateChatDebugSnapshot = useCallback((update: Partial<ChatDebugSnapshot>) => {
    setChatDebugSnapshot((previous) => mergeDebugSnapshot(previous, update));
  }, []);

  // Current conversation ID (may be set during streaming for new conversations)
  const currentConversationIdRef = useRef<string | undefined>(conversationId);
  const viewedConversationIdRef = useRef<string | undefined>(conversationId);
  const streamScopeRef = useRef(0);
  const interactiveConversationId =
    currentConversationIdRef.current ?? draftConversationId ?? conversationId ?? null;
  const queueConversationId = draftConversationId ?? conversationId;
  const { data: queuedMessages } = useConversationQueuedMessages(queueConversationId);
  const normalizedQueuedMessages = useMemo<QueuedMessage[]>(
    () =>
      (queuedMessages ?? []).map((queuedMessage) => ({
        id: queuedMessage.id,
        content: queuedMessage.content,
        status: queuedMessage.status,
        attachments: queuedMessage.fileAttachments,
        selectedPlatformSkillSlugs: queuedMessage.selectedPlatformSkillSlugs,
      })),
    [queuedMessages],
  );
  const queuedMessagesRef = useRef<QueuedMessage[]>([]);
  const autoApproveEnabled = useMemo(() => localAutoApprove, [localAutoApprove]);
  const isUserOpenAIConnected = Boolean(connectedProviders?.openai);
  const isSharedOpenAIConnected = Boolean(sharedConnectedProviders?.openai);
  const isOpenAIConnected = isUserOpenAIConnected || isSharedOpenAIConnected;
  const providerAvailability = useMemo(
    () =>
      buildProviderAuthAvailabilityByProvider({
        connectedProviders,
        sharedConnectedProviders,
      }),
    [connectedProviders, sharedConnectedProviders],
  );
  const runDeadlineResumeState = useMemo<PendingRunDeadlineResumeState | null>(() => {
    if (
      pendingRunDeadlineResume &&
      pendingRunDeadlineResume.generationId !== dismissedRunDeadlineGenerationId
    ) {
      return pendingRunDeadlineResume;
    }

    if (
      activeGeneration?.status === "paused" &&
      activeGeneration.pauseReason === "run_deadline" &&
      activeGeneration.generationId &&
      activeGeneration.generationId !== dismissedRunDeadlineGenerationId
    ) {
      return {
        generationId: activeGeneration.generationId,
        debugRunDeadlineMs: activeGeneration.debugRunDeadlineMs ?? null,
      };
    }

    return null;
  }, [
    activeGeneration?.debugRunDeadlineMs,
    activeGeneration?.generationId,
    activeGeneration?.pauseReason,
    activeGeneration?.status,
    dismissedRunDeadlineGenerationId,
    pendingRunDeadlineResume,
  ]);
  const displaySegments = useMemo(
    () =>
      runDeadlineResumeState
        ? [...segments, buildRunDeadlineResumeSegment(runDeadlineResumeState)]
        : segments,
    [runDeadlineResumeState, segments],
  );
  const visibleActivityItemsBySegmentId = useMemo(
    () =>
      new Map<string, ActivityItemData[]>(
        displaySegments.map((segment) => [segment.id, segment.items]),
      ),
    [displaySegments],
  );
  const resolvedDefaultModel = useMemo(
    () =>
      isOpenAIConnected
        ? resolveDefaultChatModel({
            isOpenAIConnected,
            availableOpencodeFreeModelIDs: (opencodeFreeModelsData?.models ?? []).map(
              (model) => model.id,
            ),
          })
        : DEFAULT_VISIBLE_CHAT_MODEL,
    [isOpenAIConnected, opencodeFreeModelsData],
  );
  const resolvedDefaultSelection = useMemo(
    () =>
      resolveDefaultChatModelSelection({
        model: resolvedDefaultModel,
        providerAvailabilityByProvider: providerAvailability,
      }),
    [providerAvailability, resolvedDefaultModel],
  );
  const conversationModel = (
    existingConversation as
      | {
          model?: string;
          authSource?: "user" | "shared" | null;
        }
      | null
      | undefined
  )?.model;
  const conversationAuthSource = (
    existingConversation as
      | {
          model?: string;
          authSource?: "user" | "shared" | null;
        }
      | null
      | undefined
  )?.authSource;
  const normalizedConversationSelection = useMemo(
    () =>
      normalizeChatModelSelection({
        model: conversationModel,
        authSource: conversationAuthSource,
      }),
    [conversationAuthSource, conversationModel],
  );
  const conversationType = (
    existingConversation as
      | {
          type?: "chat" | "coworker";
        }
      | null
      | undefined
  )?.type;
  const isCoworkerConversation = conversationType === "coworker";
  const showModelSwitchWarning = Boolean(
    conversationId &&
    normalizedConversationSelection.model &&
    (normalizedSelectedModel !== normalizedConversationSelection.model ||
      selectedAuthSource !== normalizedConversationSelection.authSource) &&
    !isCoworkerConversation,
  );

  useEffect(() => {
    viewedConversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (initialPrefillAppliedRef.current) {
      return;
    }
    const text = initialPrefillText?.trim();
    if (!text) {
      return;
    }
    initialPrefillAppliedRef.current = true;
    setInputPrefillRequest({
      id: `initial-prefill-${Date.now()}`,
      text,
    });
  }, [initialPrefillText]);

  const isEmptyChat = messages.length === 0 && !isStreaming;

  useEffect(() => {
    if (!isEmptyChat && isDiscoverOpen) {
      setIsDiscoverOpen(false);
    }
  }, [isDiscoverOpen, isEmptyChat]);

  useEffect(() => {
    if (
      !normalizedSelectedSelection.model ||
      (normalizedSelectedSelection.model === selectedModel &&
        normalizedSelectedSelection.authSource === selectedAuthSource)
    ) {
      return;
    }
    setSelection(normalizedSelectedSelection);
  }, [normalizedSelectedSelection, selectedAuthSource, selectedModel, setSelection]);

  useEffect(() => {
    if (conversationId || isAdminLoading) {
      return;
    }

    const shouldMigrateLegacyModel = shouldMigrateLegacyDefaultModel({
      currentModel: normalizedSelectedModel,
      isOpenAIConnected,
    });
    const isAccessible = isModelAccessibleForNewChat({
      model: normalizedSelectedModel,
      authSource: selectedAuthSource,
      isAdmin,
      providerAvailabilityByProvider: providerAvailability,
    });
    const isHiddenOpencodeModel = normalizedSelectedModel.startsWith("opencode/");

    if (
      (shouldMigrateLegacyModel || !isAccessible || isHiddenOpencodeModel) &&
      (resolvedDefaultSelection.model !== normalizedSelectedModel ||
        resolvedDefaultSelection.authSource !== selectedAuthSource)
    ) {
      setSelection(resolvedDefaultSelection);
    }
  }, [
    conversationId,
    isAdmin,
    isAdminLoading,
    isOpenAIConnected,
    normalizedSelectedModel,
    providerAvailability,
    resolvedDefaultSelection,
    selectedAuthSource,
    setSelection,
  ]);

  useEffect(() => {
    const shouldRunStreamTimer = isStreaming && initTrackingStartedAtRef.current !== null;
    if (!shouldRunStreamTimer) {
      return;
    }
    const interval = window.setInterval(() => setStreamClockNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [isStreaming]);

  const handleStarterSelect = useCallback((prompt: string) => {
    setInputPrefillRequest({
      id: `starter-${Date.now()}`,
      text: prompt,
    });
  }, []);

  const handleStarterButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const prompt = event.currentTarget.dataset.prompt;
      if (!prompt) {
        return;
      }
      handleStarterSelect(prompt);
    },
    [handleStarterSelect],
  );

  const handleToggleDiscover = useCallback(() => {
    setIsDiscoverOpen((open) => !open);
  }, []);

  const handleCloseDiscover = useCallback(() => {
    setIsDiscoverOpen(false);
  }, []);

  const isStreamEventForActiveScope = useCallback(
    ({
      scope,
      streamGenerationId,
      eventGenerationId,
      eventConversationId,
    }: {
      scope: number;
      streamGenerationId?: string;
      eventGenerationId?: string;
      eventConversationId?: string;
    }): boolean => {
      if (streamScopeRef.current !== scope) {
        return false;
      }

      const activeGenerationId = currentGenerationIdRef.current;
      const generationId = eventGenerationId ?? streamGenerationId;
      if (activeGenerationId && generationId && activeGenerationId !== generationId) {
        return false;
      }

      const viewedConversationId = viewedConversationIdRef.current;
      if (
        viewedConversationId &&
        eventConversationId &&
        viewedConversationId !== eventConversationId
      ) {
        return false;
      }

      return true;
    },
    [],
  );

  useEffect(() => {
    queuedMessagesRef.current = normalizedQueuedMessages;
  }, [normalizedQueuedMessages]);

  useEffect(() => {
    if (
      editingQueuedMessageId &&
      !normalizedQueuedMessages.some((queuedMessage) => queuedMessage.id === editingQueuedMessageId)
    ) {
      setEditingQueuedMessageId(null);
    }
  }, [editingQueuedMessageId, normalizedQueuedMessages]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const userScrolledUpRef = useRef(false);
  const initTrackingStartedAtRef = useRef<number | null>(null);
  const initSignalReceivedAtRef = useRef<number | null>(null);
  const initSignalEventTypeRef = useRef<string | null>(null);
  const initTimeoutEventSentRef = useRef(false);
  const initWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetInitTracking = useCallback(() => {
    initTrackingStartedAtRef.current = null;
    initSignalReceivedAtRef.current = null;
    initSignalEventTypeRef.current = null;
    initTimeoutEventSentRef.current = false;
    if (initWatchdogTimerRef.current) {
      clearTimeout(initWatchdogTimerRef.current);
      initWatchdogTimerRef.current = null;
    }
    setAgentInitStatus(null);
  }, []);

  const beginInitTracking = useCallback(
    (source: "new_generation" | "reconnect", startedAtMs?: number) => {
      const startedAt = startedAtMs ?? Date.now();
      resetInitTracking();
      initTrackingStartedAtRef.current = startedAt;
      setAgentInitStatus("sandbox_init_started");
      console.info(
        `[AgentInit][Client] started source=${source} conversationId=${currentConversationIdRef.current ?? "new"}`,
      );
      posthog?.capture("agent_creation_started", {
        source,
        startedAtMs: startedAt,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: currentGenerationIdRef.current ?? null,
        model: normalizedSelectedModel,
      });

      initWatchdogTimerRef.current = setTimeout(() => {
        if (!initTrackingStartedAtRef.current || initSignalReceivedAtRef.current) {
          return;
        }
        initTimeoutEventSentRef.current = true;
        const elapsedMs = Date.now() - initTrackingStartedAtRef.current;
        console.warn(
          `[AgentInit][Client] timeout_no_init elapsedMs=${elapsedMs} conversationId=${currentConversationIdRef.current ?? "new"} generationId=${currentGenerationIdRef.current ?? "unknown"}`,
        );
        posthog?.capture("agent_init_timeout", {
          elapsedMs,
          conversationId: currentConversationIdRef.current ?? null,
          generationId: currentGenerationIdRef.current ?? null,
          model: normalizedSelectedModel,
        });
      }, 20_000);
    },
    [normalizedSelectedModel, posthog, resetInitTracking],
  );

  const markInitSignal = useCallback(
    (eventType: string, metadata?: Record<string, unknown>) => {
      if (!initTrackingStartedAtRef.current || initSignalReceivedAtRef.current) {
        return;
      }
      const now = Date.now();
      const elapsedMs = now - initTrackingStartedAtRef.current;
      initSignalReceivedAtRef.current = now;
      initSignalEventTypeRef.current = eventType;
      if (initWatchdogTimerRef.current) {
        clearTimeout(initWatchdogTimerRef.current);
        initWatchdogTimerRef.current = null;
      }

      console.info(
        `[AgentInit][Client] init_signal_received event=${eventType} elapsedMs=${elapsedMs} conversationId=${currentConversationIdRef.current ?? "new"} generationId=${currentGenerationIdRef.current ?? "unknown"}`,
      );
      posthog?.capture("agent_init_signal_received", {
        eventType,
        elapsedMs,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: currentGenerationIdRef.current ?? null,
        model: normalizedSelectedModel,
        ...metadata,
      });
    },
    [normalizedSelectedModel, posthog],
  );

  const markInitMissingAtEnd = useCallback(
    (endReason: string, metadata?: Record<string, unknown>) => {
      if (!initTrackingStartedAtRef.current || initSignalReceivedAtRef.current) {
        return;
      }

      const elapsedMs = Date.now() - initTrackingStartedAtRef.current;
      if (initWatchdogTimerRef.current) {
        clearTimeout(initWatchdogTimerRef.current);
        initWatchdogTimerRef.current = null;
      }

      const conversationId = currentConversationIdRef.current ?? "new";
      const generationId =
        typeof metadata?.generationId === "string"
          ? metadata.generationId
          : (currentGenerationIdRef.current ?? "unknown");
      const logMessage = `[AgentInit][Client] missing_init endReason=${endReason} elapsedMs=${elapsedMs} conversationId=${conversationId} generationId=${generationId}`;
      if (NON_ERROR_INIT_END_REASONS.has(endReason)) {
        console.info(logMessage);
      } else {
        console.error(logMessage);
      }
      posthog?.capture("agent_init_missing", {
        endReason,
        elapsedMs,
        didTimeout: initTimeoutEventSentRef.current,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: generationId === "unknown" ? null : generationId,
        model: normalizedSelectedModel,
        ...metadata,
      });
    },
    [normalizedSelectedModel, posthog],
  );

  const streamElapsedMs = useMemo(() => {
    if (!initTrackingStartedAtRef.current) {
      return null;
    }
    return Math.max(0, streamClockNow - initTrackingStartedAtRef.current);
  }, [streamClockNow]);

  const clearTrackedCoworkerEditToolUses = useCallback(() => {
    coworkerEditToolUseIdsRef.current.clear();
  }, []);
  const triggerCoworkerSync = useCallback(
    ({
      coworkerId,
      prompt,
      updatedAt,
    }: {
      coworkerId: string;
      prompt?: string;
      updatedAt?: string;
    }) => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
      queryClient.invalidateQueries({ queryKey: ["coworker", "get", coworkerId] });
      onCoworkerSync?.({ coworkerId, prompt, updatedAt });
    },
    [onCoworkerSync, queryClient],
  );
  const trackCoworkerEditToolUse = useCallback(
    ({
      toolUseId,
      integration,
      operation,
    }: {
      toolUseId?: string;
      integration?: string;
      operation?: string;
    }) => {
      if (!forceCoworkerQuerySync || !toolUseId) {
        return;
      }

      if (integration === "coworker" && operation === "edit") {
        coworkerEditToolUseIdsRef.current.add(toolUseId);
        return;
      }

      coworkerEditToolUseIdsRef.current.delete(toolUseId);
    },
    [forceCoworkerQuerySync],
  );
  const syncCoworkerAfterToolResult = useCallback(
    (toolUseId: string | undefined, result: unknown) => {
      if (!forceCoworkerQuerySync || !toolUseId) {
        return;
      }

      if (!coworkerEditToolUseIdsRef.current.has(toolUseId)) {
        return;
      }
      coworkerEditToolUseIdsRef.current.delete(toolUseId);

      const syncData = extractCoworkerSyncDataFromToolResult(result);
      const syncedCoworkerId = syncData.coworkerId ?? coworkerIdForSync;
      if (!syncedCoworkerId) {
        return;
      }

      triggerCoworkerSync({
        coworkerId: syncedCoworkerId,
        prompt: syncData.prompt,
        updatedAt: syncData.updatedAt,
      });
    },
    [coworkerIdForSync, forceCoworkerQuerySync, triggerCoworkerSync],
  );

  const initElapsedLabel = useMemo(() => {
    if (!isStreaming || segments.length > 0 || streamElapsedMs === null) {
      return null;
    }
    return formatDuration(streamElapsedMs);
  }, [isStreaming, segments.length, streamElapsedMs]);

  const handleGenerationParkedUi = useCallback(() => {
    setIsStreaming(false);
    setStreamingParts([]);
    setStreamingSandboxFiles([]);
    setTraceStatus("complete");
    currentGenerationIdRef.current = undefined;
    runtimeRef.current = null;
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();
  }, [clearTrackedCoworkerEditToolUses, resetInitTracking]);

  const handleInitStatusChange = useCallback(
    (status: string, metadata?: StatusChangeMetadata) => {
      console.info(
        `[AgentInit][Client] status_change status=${status} generationId=${currentGenerationIdRef.current ?? "unknown"}`,
      );
      updateChatDebugSnapshot({
        conversationId:
          currentConversationIdRef.current ?? draftConversationId ?? conversationId ?? null,
        generationId: currentGenerationIdRef.current ?? activeGeneration?.generationId ?? null,
        runtimeId: metadata?.runtimeId,
        sandboxProvider: metadata?.sandboxProvider,
        sandboxId: metadata?.sandboxId,
        sessionId: metadata?.sessionId,
        lastParkedStatus:
          status === "approval_parked" ||
          status === "auth_parked" ||
          status === "run_deadline_parked"
            ? status
            : undefined,
        releasedSandboxId: metadata?.releasedSandboxId,
      });
      if (!status.startsWith("sandbox_init_") && !status.startsWith("agent_init_")) {
        if (status === "run_deadline_parked") {
          const parkedGenerationId =
            currentGenerationIdRef.current ?? activeGeneration?.generationId ?? "unknown";
          const runtimeLimitMs =
            activeGeneration?.debugRunDeadlineMs ?? armedDebugPreset?.debugRunDeadlineMs ?? null;
          const runtimeSnapshot = runtimeRef.current?.snapshot;
          if (runtimeSnapshot) {
            const historicalBlock = buildHistoricalActivityBlock({
              generationId: parkedGenerationId,
              runtimeLimitMs,
              snapshot: runtimeSnapshot,
            });
            if (historicalBlock) {
              setHistoricalActivityBlocks((current) => [
                ...current.filter((block) => block.generationId !== parkedGenerationId),
                historicalBlock,
              ]);
            }
          }
          setPendingRunDeadlineResume({
            generationId: parkedGenerationId,
            debugRunDeadlineMs: runtimeLimitMs,
          });
        }
        if (
          status === "approval_parked" ||
          status === "auth_parked" ||
          status === "run_deadline_parked"
        ) {
          handleGenerationParkedUi();
          queryClient.invalidateQueries({
            queryKey: ["generation", "active", currentConversationIdRef.current ?? conversationId],
          });
        }
        return;
      }

      setAgentInitStatus(status);
      posthog?.capture("agent_init_status", {
        status,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: currentGenerationIdRef.current ?? null,
        model: normalizedSelectedModel,
      });

      if (status === "agent_init_ready") {
        markInitSignal("agent_init_ready");
      } else if (status === "sandbox_init_failed") {
        markInitMissingAtEnd("sandbox_init_failed");
        setStreamingParts([]);
        setStreamingSandboxFiles([]);
        setIsStreaming(false);
        setTraceStatus("complete");
        setStreamError("Sandbox initialization failed. Please retry.");
        currentGenerationIdRef.current = undefined;
        runtimeRef.current = null;
        clearTrackedCoworkerEditToolUses();
        resetInitTracking();
      } else if (status === "agent_init_failed") {
        markInitMissingAtEnd("agent_init_failed");
        setStreamingParts([]);
        setStreamingSandboxFiles([]);
        setIsStreaming(false);
        setTraceStatus("complete");
        setStreamError("Agent initialization failed. Please retry.");
        currentGenerationIdRef.current = undefined;
        runtimeRef.current = null;
        clearTrackedCoworkerEditToolUses();
        resetInitTracking();
      }
    },
    [
      activeGeneration?.debugRunDeadlineMs,
      activeGeneration?.generationId,
      clearTrackedCoworkerEditToolUses,
      conversationId,
      draftConversationId,
      handleGenerationParkedUi,
      markInitMissingAtEnd,
      markInitSignal,
      normalizedSelectedModel,
      armedDebugPreset?.debugRunDeadlineMs,
      posthog,
      queryClient,
      resetInitTracking,
      updateChatDebugSnapshot,
      setPendingRunDeadlineResume,
    ],
  );

  const syncFromRuntime = useCallback((runtime: GenerationRuntime) => {
    const snapshot = runtime.snapshot;
    setStreamingParts(snapshot.parts as MessagePart[]);
    setSegments(
      snapshot.segments.map((seg) => ({
        ...seg,
        items: seg.items.map((item) => ({
          ...item,
          integration: item.integration as DisplayIntegrationType | undefined,
        })),
      })),
    );
    setIntegrationsUsed(new Set(snapshot.integrationsUsed as DisplayIntegrationType[]));
    setStreamingSandboxFiles(snapshot.sandboxFiles as SandboxFileData[]);
    setTraceStatus(snapshot.traceStatus);
  }, []);

  const optimisticallyResumeInterruptedGeneration = useCallback(
    (
      interruptId: string,
      kind: "approval" | "auth",
      options?: { connectedIntegration?: string; questionAnswers?: string[][] },
    ) => {
      setStreamError(null);
      setSegments((current) => {
        if (kind === "approval") {
          return markResolvedApprovalInterruptInSegments(
            current,
            interruptId,
            options?.questionAnswers,
          );
        }
        if (kind === "auth" && options?.connectedIntegration) {
          return markResolvedAuthInterruptInSegments(
            current,
            interruptId,
            options.connectedIntegration,
          );
        }

        return stripResolvedInterruptFromSegments(current, interruptId, kind);
      });
      setTraceStatus("streaming");
      setIsStreaming(true);
      const generationId = currentGenerationIdRef.current ?? activeGeneration?.generationId ?? null;
      if (generationId) {
        currentGenerationIdRef.current = generationId;
      }
      const reconnectStartedAtMs = activeGeneration?.startedAt
        ? Date.parse(activeGeneration.startedAt)
        : NaN;
      beginInitTracking(
        "reconnect",
        Number.isFinite(reconnectStartedAtMs) ? reconnectStartedAtMs : undefined,
      );
      updateChatDebugSnapshot({
        conversationId:
          currentConversationIdRef.current ?? draftConversationId ?? conversationId ?? null,
        generationId,
        status: "generating",
        pauseReason: null,
      });
      const activeConversationId =
        currentConversationIdRef.current ?? draftConversationId ?? conversationId;
      if (activeConversationId) {
        void queryClient.refetchQueries({
          queryKey: ["generation", "active", activeConversationId],
          exact: true,
        });
      }
      setResumeGenerationNonce((current) => current + 1);
    },
    [
      activeGeneration?.generationId,
      activeGeneration?.startedAt,
      beginInitTracking,
      conversationId,
      draftConversationId,
      queryClient,
      updateChatDebugSnapshot,
    ],
  );

  useEffect(() => {
    if (!authCompletion) {
      return;
    }

    authCompletionRef.current = authCompletion;

    const runtime = runtimeRef.current;
    if (!runtime) {
      optimisticallyResumeInterruptedGeneration(authCompletion.interruptId, "auth", {
        connectedIntegration: authCompletion.integration,
      });
      return;
    }

    runtime.resolveAuthSuccess(authCompletion.integration);
    syncFromRuntime(runtime);
  }, [authCompletion, optimisticallyResumeInterruptedGeneration, syncFromRuntime]);

  const clearActiveGenerationUi = useCallback(() => {
    setStreamingParts([]);
    setStreamingSandboxFiles([]);
    setIsStreaming(false);
    setTraceStatus("complete");
    currentGenerationIdRef.current = undefined;
    runtimeRef.current = null;
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();
    setPendingRunDeadlineResume(null);
  }, [clearTrackedCoworkerEditToolUses, resetInitTracking]);

  const handleVisibleGenerationError = useCallback(
    (error: NormalizedGenerationError, runtime?: GenerationRuntime | null) => {
      if (runtime) {
        runtime.handleError();
        syncFromRuntime(runtime);
      }

      console.error("Generation error:", error);
      posthog?.capture("generation_error_visible", {
        phase: error.phase,
        generationErrorCode: error.code,
        transportCode: error.transportCode ?? null,
        message: error.message,
        conversationId: currentConversationIdRef.current ?? null,
        generationId: currentGenerationIdRef.current ?? null,
        model: normalizedSelectedModel,
      });
      markInitMissingAtEnd("error", {
        message: error.message,
        phase: error.phase,
        generationErrorCode: error.code,
        transportCode: error.transportCode ?? null,
      });
      updateChatDebugSnapshot({
        status: "error",
        pauseReason: null,
      });
      clearActiveGenerationUi();
      setStreamError(error.message);
    },
    [
      clearActiveGenerationUi,
      markInitMissingAtEnd,
      normalizedSelectedModel,
      posthog,
      syncFromRuntime,
      updateChatDebugSnapshot,
    ],
  );

  const handleGenerationDoneUi = useCallback(() => {
    setStreamingParts([]);
    setStreamingSandboxFiles([]);
    setIsStreaming(false);
    setSegments([]);
    setTraceStatus("complete");
    setStreamError(null);
    currentGenerationIdRef.current = undefined;
    runtimeRef.current = null;
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();
    setPendingRunDeadlineResume(null);
    setDismissedRunDeadlineGenerationId(null);
    updateChatDebugSnapshot({
      generationId: null,
      status: "complete",
      pauseReason: null,
    });
  }, [
    clearTrackedCoworkerEditToolUses,
    resetInitTracking,
    setDismissedRunDeadlineGenerationId,
    updateChatDebugSnapshot,
  ]);

  const handleGenerationCancelledUi = useCallback(() => {
    setIsStreaming(false);
    currentGenerationIdRef.current = undefined;
    runtimeRef.current = null;
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();
    setPendingRunDeadlineResume(null);
    updateChatDebugSnapshot({
      generationId: null,
      status: null,
      pauseReason: null,
    });
  }, [clearTrackedCoworkerEditToolUses, resetInitTracking, updateChatDebugSnapshot]);

  const upsertMessageById = useCallback((nextMessage: Message) => {
    setMessages((prev) => {
      const existingIndex = prev.findIndex((message) => message.id === nextMessage.id);
      if (existingIndex === -1) {
        return [...prev, nextMessage];
      }
      const updated = [...prev];
      updated[existingIndex] = nextMessage;
      return updated;
    });
  }, []);

  const hydrateAssistantMessage = useCallback(
    async (newConversationId: string, messageId: string, fallback: Message): Promise<Message> => {
      const maxAttempts = 6;
      const retryDelayMs = 300;
      const fallbackHasFiles =
        (fallback.attachments?.length ?? 0) > 0 || (fallback.sandboxFiles?.length ?? 0) > 0;

      const attemptHydration = async (attempt: number): Promise<Message> => {
        try {
          const conversation = await client.conversation.get({ id: newConversationId });
          queryClient.setQueryData(["conversation", "get", newConversationId], conversation);

          const persisted = conversation.messages.find((m) => m.id === messageId);
          if (persisted) {
            const mapped = mapPersistedMessageToChatMessage(
              persisted as PersistedConversationMessage,
            );
            const mappedHasFiles =
              (mapped.attachments?.length ?? 0) > 0 || (mapped.sandboxFiles?.length ?? 0) > 0;

            if (mappedHasFiles || fallbackHasFiles || attempt === maxAttempts - 1) {
              return mapped;
            }
          }
        } catch (error) {
          if (attempt === maxAttempts - 1) {
            console.error("Failed to hydrate assistant message after completion:", error);
          }
        }

        if (attempt < maxAttempts - 1) {
          await sleep(retryDelayMs);
          return attemptHydration(attempt + 1);
        }
        return fallback;
      };

      return attemptHydration(0);
    },
    [queryClient],
  );

  const notifyConversationIdSync = useCallback((id: string) => {
    window.dispatchEvent(
      new CustomEvent(CHAT_CONVERSATION_ID_SYNC_EVENT, {
        detail: { conversationId: id },
      }),
    );
  }, []);

  const syncConversationForNewChat = useCallback(
    (id: string) => {
      currentConversationIdRef.current = id;
      setDraftConversationId(id);
      notifyConversationIdSync(id);
      if (!conversationId) {
        window.history.replaceState(null, "", `/chat/${id}`);
      }
    },
    [conversationId, notifyConversationIdSync],
  );

  const persistInterruptedRuntimeMessage = useCallback(
    (runtime: GenerationRuntime, messageId?: string, timing?: Message["timing"]) => {
      runtime.handleCancelled();
      const assistant = runtime.buildAssistantMessage();
      setMessages((prev) => [
        ...prev,
        {
          id: messageId ?? `cancelled-${Date.now()}`,
          role: "assistant",
          content: assistant.content || "Interrupted by user",
          parts: assistant.parts as MessagePart[],
          integrationsUsed: assistant.integrationsUsed,
          sandboxFiles: assistant.sandboxFiles as SandboxFileData[] | undefined,
          timing,
        } as Message & {
          integrationsUsed?: string[];
          sandboxFiles?: SandboxFileData[];
        },
      ]);
    },
    [],
  );

  // Auto-approve mutation
  const { mutateAsync: updateAutoApprove } = useUpdateAutoApprove();

  // Voice recording
  const { isRecording, error: voiceError, startRecording, stopRecording } = useVoiceRecording();
  const { mutateAsync: transcribe } = useTranscribe();

  // Load existing messages
  useEffect(() => {
    // Don't load messages for new chat - let the reset effect handle clearing
    if (!conversationId) {
      return;
    }

    const conv = existingConversation as
      | {
          model?: string;
          authSource?: "user" | "shared" | null;
          autoApprove?: boolean;
          type?: "chat" | "coworker";
          messages?: PersistedConversationMessage[];
        }
      | null
      | undefined;

    // Sync model from existing conversation
    if (conv?.model) {
      setSelection({
        model: conv.model,
        authSource: conv.authSource,
      });
    }
    if (typeof conv?.autoApprove === "boolean") {
      setLocalAutoApprove(conv.type === "coworker" ? false : conv.autoApprove);
    }

    if (conv?.messages) {
      const persistedMessages = conv.messages.map((m) => mapPersistedMessageToChatMessage(m));
      setMessages((prev) =>
        mergePersistedConversationMessages({
          currentMessages: prev,
          persistedMessages,
          preserveOptimisticMessages: isStreaming || currentGenerationIdRef.current !== undefined,
        }),
      );
    }
  }, [existingConversation, conversationId, isStreaming, setSelection]);

  useEffect(() => () => resetInitTracking(), [resetInitTracking]);

  // Reset when conversation changes
  useEffect(() => {
    streamScopeRef.current += 1;
    abort();

    // Always sync the ref with the prop
    currentConversationIdRef.current = conversationId;
    setDraftConversationId(conversationId);
    runtimeRef.current = null;
    setStreamingParts([]);
    setSegments([]);
    setIntegrationsUsed(new Set());
    setTraceStatus("complete");
    setIsStreaming(false);
    setStreamError(null);
    setStreamingSandboxFiles([]);
    currentGenerationIdRef.current = undefined;
    setPendingRunDeadlineResume(null);
    setHistoricalActivityBlocks([]);
    setDismissedRunDeadlineGenerationId(null);
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();

    if (!conversationId) {
      setMessages([]);
      setLocalAutoApprove(false);
    }
  }, [abort, clearTrackedCoworkerEditToolUses, conversationId, resetInitTracking]);

  // Listen for "new-chat" event to reset state when user clicks New Chat
  useEffect(() => {
    const handleNewChat = () => {
      streamScopeRef.current += 1;
      abort();
      runtimeRef.current = null;
      setMessages([]);
      setStreamingParts([]);
      setSegments([]);
      setIntegrationsUsed(new Set());
      setTraceStatus("complete");
      setIsStreaming(false);
      setStreamError(null);
      setStreamingSandboxFiles([]);
      currentGenerationIdRef.current = undefined;
      locallyStoppedGenerationIdRef.current = null;
      currentConversationIdRef.current = undefined;
      viewedConversationIdRef.current = undefined;
      setDraftConversationId(undefined);
      setLocalAutoApprove(false);
      setArmedDebugPreset(null);
      setChatDebugSnapshot({});
      setIsResumingPausedRunDeadline(false);
      setPendingRunDeadlineResume(null);
      setHistoricalActivityBlocks([]);
      setDismissedRunDeadlineGenerationId(null);
      clearTrackedCoworkerEditToolUses();
      resetInitTracking();
    };
    window.addEventListener("new-chat", handleNewChat);
    return () => window.removeEventListener("new-chat", handleNewChat);
  }, [abort, clearTrackedCoworkerEditToolUses, resetInitTracking]);

  // Reconnect to active generation on mount
  useEffect(() => {
    if (
      activeGeneration?.generationId &&
      activeGeneration.generationId !== locallyStoppedGenerationIdRef.current &&
      (activeGeneration.status === "generating" ||
        activeGeneration.status === "awaiting_approval" ||
        activeGeneration.status === "awaiting_auth")
    ) {
      if (runtimeRef.current && currentGenerationIdRef.current === activeGeneration.generationId) {
        return;
      }

      // There's an active generation - reconnect to it
      currentGenerationIdRef.current = activeGeneration.generationId;
      setIsStreaming(true);
      const reconnectStartedAtMs = activeGeneration.startedAt
        ? Date.parse(activeGeneration.startedAt)
        : NaN;
      beginInitTracking(
        "reconnect",
        Number.isFinite(reconnectStartedAtMs) ? reconnectStartedAtMs : undefined,
      );
      setTraceStatus(
        activeGeneration.status === "awaiting_approval"
          ? "waiting_approval"
          : activeGeneration.status === "awaiting_auth"
            ? "waiting_auth"
            : "streaming",
      );

      const runtime = createGenerationRuntime();
      runtimeRef.current = runtime;
      runtime.setStatus(
        activeGeneration.status === "awaiting_approval"
          ? "waiting_approval"
          : activeGeneration.status === "awaiting_auth"
            ? "waiting_auth"
            : "streaming",
      );
      if (segments.length === 0) {
        syncFromRuntime(runtime);
      }
      const streamScope = streamScopeRef.current;
      const streamGenerationId = activeGeneration.generationId;
      let acceptFurtherEvents = true;

      subscribeToGeneration(activeGeneration.generationId, {
        onText: (text) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          markInitSignal("text");
          runtime.handleText(text);
          syncFromRuntime(runtime);
        },
        onSystem: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          runtime.handleSystem(data.content);
          syncFromRuntime(runtime);
          if (forceCoworkerQuerySync && data.coworkerId) {
            triggerCoworkerSync({ coworkerId: data.coworkerId });
          }
        },
        onThinking: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          markInitSignal("thinking");
          runtime.handleThinking(data);
          syncFromRuntime(runtime);
        },
        onToolUse: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          markInitSignal("tool_use", { toolName: data.toolName });
          trackCoworkerEditToolUse(data);
          runtime.handleToolUse(data);
          syncFromRuntime(runtime);
        },
        onToolResult: (toolName, result, toolUseId) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          markInitSignal("tool_result", { toolName });
          runtime.handleToolResult(toolName, result, toolUseId);
          syncCoworkerAfterToolResult(toolUseId, result);
          syncFromRuntime(runtime);
        },
        onPendingApproval: async (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: data.generationId,
              eventConversationId: data.conversationId,
            })
          ) {
            return;
          }
          markInitSignal("pending_approval", { toolName: data.toolName });
          currentGenerationIdRef.current = data.generationId;
          if (data.conversationId) {
            syncConversationForNewChat(data.conversationId);
          }
          runtime.handlePendingApproval(data);
          syncFromRuntime(runtime);
          if (
            autoApproveEnabled &&
            !isQuestionApprovalRequest({
              toolName: data.toolName,
              integration: data.integration,
              operation: data.operation,
            })
          ) {
            try {
              await submitApproval({
                interruptId: data.interruptId,
                decision: "approve",
              });
            } catch (err) {
              console.error("Failed to auto-approve tool use:", err);
            }
          }
        },
        onApprovalResult: (toolUseId, decision) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          runtime.handleApprovalResult(toolUseId, decision);
          syncFromRuntime(runtime);
        },
        onApproval: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          runtime.handleApproval(data);
          syncFromRuntime(runtime);
        },
        onAuthNeeded: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: data.generationId,
              eventConversationId: data.conversationId,
            })
          ) {
            return;
          }
          markInitSignal("auth_needed", { integrations: data.integrations });
          currentGenerationIdRef.current = data.generationId;
          if (data.conversationId) {
            syncConversationForNewChat(data.conversationId);
          }
          runtime.handleAuthNeeded(data);
          if (
            authCompletionRef.current &&
            authCompletionRef.current.interruptId === data.interruptId &&
            data.integrations.includes(authCompletionRef.current.integration)
          ) {
            runtime.resolveAuthSuccess(authCompletionRef.current.integration);
          }
          syncFromRuntime(runtime);
        },
        onAuthProgress: (connected, remaining) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          runtime.handleAuthProgress(connected, remaining);
          syncFromRuntime(runtime);
        },
        onAuthResult: (success) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          runtime.handleAuthResult(success);
          syncFromRuntime(runtime);
        },
        onSandboxFile: (file) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          markInitSignal("sandbox_file", { filename: file.filename });
          runtime.handleSandboxFile(file);
          syncFromRuntime(runtime);
        },
        onStatusChange: (status, metadata) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          handleInitStatusChange(status, metadata);
        },
        onDone: async (generationId, newConversationId, messageId, _usage, artifacts) => {
          if (
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: generationId,
              eventConversationId: newConversationId,
            })
          ) {
            return;
          }
          acceptFurtherEvents = false;
          const timing = artifacts?.timing;
          markInitSignal("done");
          runtime.handleDone({
            generationId,
            conversationId: newConversationId,
            messageId,
          });
          const assistant = runtime.buildAssistantMessage();
          const fallbackAssistant: Message = {
            id: messageId,
            role: "assistant",
            content: assistant.content,
            parts: assistant.parts as MessagePart[],
            integrationsUsed: assistant.integrationsUsed,
            attachments: artifacts?.attachments?.map((attachment) => ({
              id: attachment.id,
              name: attachment.filename,
              mimeType: attachment.mimeType,
              dataUrl: "",
            })),
            sandboxFiles:
              artifacts?.sandboxFiles ?? (assistant.sandboxFiles as SandboxFileData[] | undefined),
            timing,
          };
          upsertMessageById(fallbackAssistant);
          handleGenerationDoneUi();
          const hydratedAssistant = await hydrateAssistantMessage(
            newConversationId,
            messageId,
            fallbackAssistant,
          );
          if (
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: generationId,
              eventConversationId: newConversationId,
            })
          ) {
            return;
          }
          upsertMessageById(hydratedAssistant);
          if (!conversationId && newConversationId) {
            syncConversationForNewChat(newConversationId);
          }
        },
        onError: (message) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          acceptFurtherEvents = false;
          handleVisibleGenerationError(message, runtime);
        },
        onCancelled: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: data.generationId,
              eventConversationId: data.conversationId,
            })
          ) {
            return;
          }
          acceptFurtherEvents = false;
          if (runtimeRef.current === runtime) {
            persistInterruptedRuntimeMessage(runtime, data.messageId);
          }
          markInitMissingAtEnd("cancelled");
          handleGenerationCancelledUi();
        },
      });
    }
  }, [
    activeGeneration?.generationId,
    activeGeneration?.startedAt,
    activeGeneration?.status,
    autoApproveEnabled,
    beginInitTracking,
    clearTrackedCoworkerEditToolUses,
    conversationId,
    forceCoworkerQuerySync,
    handleInitStatusChange,
    markInitMissingAtEnd,
    markInitSignal,
    handleGenerationCancelledUi,
    handleGenerationDoneUi,
    onCoworkerSync,
    persistInterruptedRuntimeMessage,
    resetInitTracking,
    segments.length,
    syncCoworkerAfterToolResult,
    submitApproval,
    subscribeToGeneration,
    syncFromRuntime,
    syncConversationForNewChat,
    trackCoworkerEditToolUse,
    triggerCoworkerSync,
    handleVisibleGenerationError,
    hydrateAssistantMessage,
    isStreamEventForActiveScope,
    resumeGenerationNonce,
    upsertMessageById,
  ]);

  useEffect(() => {
    if (activeGeneration?.status !== "error") {
      return;
    }
    handleVisibleGenerationError(
      normalizeGenerationError(
        activeGeneration.errorMessage,
        GENERATION_ERROR_PHASES.PERSISTED_ERROR,
      ),
    );
  }, [activeGeneration?.errorMessage, activeGeneration?.status, handleVisibleGenerationError]);

  // Track if user is near bottom of scroll
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const threshold = 100; // pixels from bottom
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom < threshold;

    // If user scrolls back to bottom, reset the scrolled-up flag
    if (isNearBottomRef.current) {
      userScrolledUpRef.current = false;
    }
  }, []);

  // Detect user-initiated scroll up via wheel/touch
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const handleUserScroll = () => {
      // Check after a tick so the scroll position has updated
      requestAnimationFrame(() => {
        if (!isNearBottomRef.current) {
          userScrolledUpRef.current = true;
        }
      });
    };

    container.addEventListener("wheel", handleUserScroll, { passive: true });
    container.addEventListener("touchmove", handleUserScroll, {
      passive: true,
    });
    return () => {
      container.removeEventListener("wheel", handleUserScroll);
      container.removeEventListener("touchmove", handleUserScroll);
    };
  }, []);

  // Auto-scroll only if user hasn't scrolled up
  useEffect(() => {
    if (isNearBottomRef.current && !userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingParts]);

  const handleStop = useCallback(async () => {
    const runtime = runtimeRef.current;
    const generationId = currentGenerationIdRef.current ?? activeGeneration?.generationId;
    if (generationId) {
      locallyStoppedGenerationIdRef.current = generationId;
      queryClient.setQueryData(["generation", "active", conversationId], {
        generationId: null,
        startedAt: null,
        errorMessage: null,
        status: null,
        pauseReason: null,
        debugRunDeadlineMs: null,
        contentParts: null,
      });
    }
    if (runtime) {
      persistInterruptedRuntimeMessage(runtime);
    }
    runtimeRef.current = null;
    currentGenerationIdRef.current = undefined;

    abort();
    // Cancel the generation on the backend too
    if (generationId) {
      try {
        await cancelGeneration(generationId);
      } catch (err) {
        console.error("Failed to cancel generation:", err);
      }
    }

    setIsStreaming(false);
    setStreamingParts([]);
    setStreamingSandboxFiles([]);
    setSegments([]);
    setTraceStatus("complete");
    markInitMissingAtEnd("user_stopped", {
      generationId,
    });
    clearTrackedCoworkerEditToolUses();
    resetInitTracking();
  }, [
    abort,
    activeGeneration?.generationId,
    cancelGeneration,
    clearTrackedCoworkerEditToolUses,
    conversationId,
    markInitMissingAtEnd,
    persistInterruptedRuntimeMessage,
    queryClient,
    resetInitTracking,
  ]);

  // Helper to toggle segment expansion
  const toggleSegmentExpand = useCallback((segmentId: string) => {
    setSegments((prev) =>
      prev.map((seg) => (seg.id === segmentId ? { ...seg, isExpanded: !seg.isExpanded } : seg)),
    );
  }, []);
  const segmentToggleHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    for (const segment of segments) {
      handlers.set(segment.id, () => {
        toggleSegmentExpand(segment.id);
      });
    }
    return handlers;
  }, [segments, toggleSegmentExpand]);

  const runGeneration = useCallback(
    async (content: string, attachments?: AttachmentData[], options?: RunGenerationOptions) => {
      // Reset scroll lock so auto-scroll works for the new response
      userScrolledUpRef.current = false;
      setStreamError(null);
      const userMessage: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content,
        attachments,
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setStreamingParts([]);
      setStreamingSandboxFiles([]);

      // Reset segments for new message
      setSegments([]);
      setIntegrationsUsed(new Set());
      setTraceStatus("streaming");
      beginInitTracking("new_generation");
      clearTrackedCoworkerEditToolUses();
      setPendingRunDeadlineResume(null);
      setDismissedRunDeadlineGenerationId(null);
      if (!options?.resumePausedGenerationId) {
        setHistoricalActivityBlocks([]);
      }

      const runtime = createGenerationRuntime();
      runtimeRef.current = runtime;
      syncFromRuntime(runtime);
      const streamScope = streamScopeRef.current;
      let streamGenerationId: string | undefined;
      let acceptFurtherEvents = true;
      const generationRequestStartedAtMs = Date.now();

      const selectedKeys = options?.selectedSkillKeysOverride ?? selectedSkillKeys;
      const selectedPlatformSkillSlugs = selectedKeys.filter(
        (key) => !key.startsWith(CUSTOM_SKILL_PREFIX),
      );
      const effectiveConversationId = currentConversationIdRef.current ?? conversationId;
      const startInput = {
        conversationId: effectiveConversationId,
        content,
        model: normalizedSelectedModel,
        authSource: selectedAuthSource,
        autoApprove: autoApproveEnabled,
        resumePausedGenerationId: options?.resumePausedGenerationId,
        ...(options?.debugRunDeadlineMs !== undefined
          ? { debugRunDeadlineMs: options.debugRunDeadlineMs }
          : {}),
        ...(options?.debugApprovalHotWaitMs !== undefined
          ? { debugApprovalHotWaitMs: options.debugApprovalHotWaitMs }
          : {}),
        selectedPlatformSkillSlugs,
        fileAttachments: attachments,
      };
      void startGeneration(startInput, {
        onStarted: (generationId, newConversationId) => {
          if (streamScopeRef.current !== streamScope) {
            return;
          }
          streamGenerationId = generationId;
          currentGenerationIdRef.current = generationId;
          locallyStoppedGenerationIdRef.current = null;
          updateChatDebugSnapshot({
            conversationId: newConversationId,
            generationId,
            status: "generating",
            pauseReason: null,
          });
          if (forceCoworkerQuerySync && coworkerIdForSync) {
            triggerCoworkerSync({ coworkerId: coworkerIdForSync });
          }
          console.info(
            `[AgentInit][Client] generation_started generationId=${generationId} conversationId=${newConversationId}`,
          );
          if (!conversationId && newConversationId) {
            syncConversationForNewChat(newConversationId);
          }
        },
        onText: (text) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          markInitSignal("text");
          runtime.handleText(text);
          syncFromRuntime(runtime);
        },
        onSystem: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          runtime.handleSystem(data.content);
          syncFromRuntime(runtime);
          if (forceCoworkerQuerySync && data.coworkerId) {
            triggerCoworkerSync({ coworkerId: data.coworkerId });
          }
        },
        onThinking: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          markInitSignal("thinking");
          runtime.handleThinking(data);
          syncFromRuntime(runtime);
        },
        onToolUse: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          markInitSignal("tool_use", { toolName: data.toolName });
          trackCoworkerEditToolUse(data);
          runtime.handleToolUse(data);
          syncFromRuntime(runtime);
        },
        onToolResult: (toolName, result, toolUseId) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          markInitSignal("tool_result", { toolName });
          runtime.handleToolResult(toolName, result, toolUseId);
          syncCoworkerAfterToolResult(toolUseId, result);
          syncFromRuntime(runtime);
        },
        onPendingApproval: async (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: data.generationId,
              eventConversationId: data.conversationId,
            })
          ) {
            return;
          }
          markInitSignal("pending_approval", { toolName: data.toolName });
          currentGenerationIdRef.current = data.generationId;
          if (data.conversationId) {
            syncConversationForNewChat(data.conversationId);
          }
          runtime.handlePendingApproval(data);
          syncFromRuntime(runtime);
          if (
            autoApproveEnabled &&
            !isQuestionApprovalRequest({
              toolName: data.toolName,
              integration: data.integration,
              operation: data.operation,
            })
          ) {
            try {
              await submitApproval({
                interruptId: data.interruptId,
                decision: "approve",
              });
            } catch (err) {
              console.error("Failed to auto-approve tool use:", err);
            }
          }
        },
        onApprovalResult: (toolUseId, decision) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          runtime.handleApprovalResult(toolUseId, decision);
          syncFromRuntime(runtime);
        },
        onApproval: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          runtime.handleApproval(data);
          syncFromRuntime(runtime);
        },
        onAuthNeeded: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: data.generationId,
              eventConversationId: data.conversationId,
            })
          ) {
            return;
          }
          markInitSignal("auth_needed", { integrations: data.integrations });
          currentGenerationIdRef.current = data.generationId;
          if (data.conversationId) {
            syncConversationForNewChat(data.conversationId);
          }
          runtime.handleAuthNeeded(data);
          if (
            authCompletionRef.current &&
            authCompletionRef.current.interruptId === data.interruptId &&
            data.integrations.includes(authCompletionRef.current.integration)
          ) {
            runtime.resolveAuthSuccess(authCompletionRef.current.integration);
          }
          syncFromRuntime(runtime);
        },
        onAuthProgress: (connected, remaining) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          runtime.handleAuthProgress(connected, remaining);
          syncFromRuntime(runtime);
        },
        onAuthResult: (success) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          runtime.handleAuthResult(success);
          syncFromRuntime(runtime);
        },
        onSandboxFile: (file) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          markInitSignal("sandbox_file", { filename: file.filename });
          runtime.handleSandboxFile(file);
          syncFromRuntime(runtime);
        },
        onStatusChange: (status, metadata) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          handleInitStatusChange(status, metadata);
        },
        onDone: async (generationId, newConversationId, messageId, _usage, artifacts) => {
          if (
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: generationId,
              eventConversationId: newConversationId,
            })
          ) {
            return;
          }
          acceptFurtherEvents = false;
          const doneAtMs = Date.now();
          const timing = withActivityDurations(
            withEndToEndDuration(artifacts?.timing, generationRequestStartedAtMs, doneAtMs),
            runtime.getActivityStats(),
          );
          markInitSignal("done");
          runtime.handleDone({
            generationId,
            conversationId: newConversationId,
            messageId,
          });
          const assistant = runtime.buildAssistantMessage();
          const fallbackAssistant: Message = {
            id: messageId,
            role: "assistant",
            content: assistant.content,
            parts: assistant.parts as MessagePart[],
            integrationsUsed: assistant.integrationsUsed,
            attachments: artifacts?.attachments?.map((attachment) => ({
              id: attachment.id,
              name: attachment.filename,
              mimeType: attachment.mimeType,
              dataUrl: "",
            })),
            sandboxFiles:
              artifacts?.sandboxFiles ?? (assistant.sandboxFiles as SandboxFileData[] | undefined),
            timing,
          };
          upsertMessageById(fallbackAssistant);
          handleGenerationDoneUi();
          const hydratedAssistant = await hydrateAssistantMessage(
            newConversationId,
            messageId,
            fallbackAssistant,
          );
          if (
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: generationId,
              eventConversationId: newConversationId,
            })
          ) {
            return;
          }
          upsertMessageById(hydratedAssistant);

          // Invalidate conversation queries to refresh sidebar
          queryClient.invalidateQueries({ queryKey: ["conversation"] });

          // Update URL for new conversations without remounting
          if (!conversationId && newConversationId) {
            syncConversationForNewChat(newConversationId);
          }
        },
        onError: (message) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({ scope: streamScope, streamGenerationId })
          ) {
            return;
          }
          acceptFurtherEvents = false;
          handleVisibleGenerationError(message, runtime);
        },
        onCancelled: (data) => {
          if (
            !acceptFurtherEvents ||
            !isStreamEventForActiveScope({
              scope: streamScope,
              streamGenerationId,
              eventGenerationId: data.generationId,
              eventConversationId: data.conversationId,
            })
          ) {
            return;
          }
          acceptFurtherEvents = false;
          if (runtimeRef.current === runtime) {
            persistInterruptedRuntimeMessage(runtime, data.messageId);
          }
          markInitMissingAtEnd("cancelled");
          handleGenerationCancelledUi();
        },
      });
    },
    [
      beginInitTracking,
      autoApproveEnabled,
      clearTrackedCoworkerEditToolUses,
      conversationId,
      coworkerIdForSync,
      forceCoworkerQuerySync,
      handleInitStatusChange,
      markInitMissingAtEnd,
      markInitSignal,
      handleGenerationCancelledUi,
      handleGenerationDoneUi,
      persistInterruptedRuntimeMessage,
      queryClient,
      selectedSkillKeys,
      normalizedSelectedModel,
      selectedAuthSource,
      startGeneration,
      submitApproval,
      syncCoworkerAfterToolResult,
      syncFromRuntime,
      syncConversationForNewChat,
      trackCoworkerEditToolUse,
      triggerCoworkerSync,
      updateChatDebugSnapshot,
      handleVisibleGenerationError,
      hydrateAssistantMessage,
      isStreamEventForActiveScope,
      upsertMessageById,
    ],
  );

  const buildOutgoingContent = useCallback(
    async (content: string, selectedSkillNames: string[]): Promise<string> => {
      if (selectedSkillNames.length === 0) {
        return content;
      }

      let isFrench = false;
      try {
        const result = await detectUserMessageLanguage({ text: content });
        isFrench = result.language === "french";
      } catch (error) {
        console.error("Failed to detect user message language:", error);
      }

      const instructions = buildSkillInstructionBlock(selectedSkillNames, isFrench);
      return `${content}\n\n${instructions}`;
    },
    [detectUserMessageLanguage],
  );

  const handleArmDebugPreset = useCallback((preset: ArmedDebugPreset) => {
    setArmedDebugPreset(preset);
    setInputPrefillRequest({
      id: `debug-preset-${preset.key}-${Date.now()}`,
      text: preset.prompt,
      mode: "replace",
    });
  }, []);

  const handleClearDebugPreset = useCallback(() => {
    setArmedDebugPreset(null);
  }, []);

  const handleResumePausedRunDeadline = useCallback(async () => {
    if (isStreaming) {
      return;
    }

    const pausedGenerationId =
      pendingRunDeadlineResume?.generationId ??
      (activeGeneration?.status === "paused" && activeGeneration.pauseReason === "run_deadline"
        ? activeGeneration.generationId
        : null);

    if (!pausedGenerationId) {
      return;
    }
    setIsResumingPausedRunDeadline(true);
    setPendingRunDeadlineResume(null);
    setDismissedRunDeadlineGenerationId(null);
    setHistoricalActivityBlocks((current) =>
      current.map((block) =>
        block.generationId === pausedGenerationId ? { ...block, awaitingResume: false } : block,
      ),
    );
    try {
      await runGeneration("continue", undefined, {
        resumePausedGenerationId: pausedGenerationId,
      });
    } finally {
      setIsResumingPausedRunDeadline(false);
    }
  }, [
    pendingRunDeadlineResume?.generationId,
    activeGeneration?.generationId,
    activeGeneration?.pauseReason,
    activeGeneration?.status,
    isStreaming,
    runGeneration,
  ]);

  const handleSend = useCallback(
    async (content: string, attachments?: AttachmentData[]) => {
      try {
        const armedPresetSnapshot = armedDebugPreset;
        const selectedSkillKeysSnapshot = [...selectedSkillKeys];
        const selectedPlatformSkillSlugs = selectedSkillKeysSnapshot.filter(
          (key) => !key.startsWith(CUSTOM_SKILL_PREFIX),
        );
        const selectedSkillNamesSnapshot = selectedSkillKeysSnapshot.map((key) =>
          key.startsWith(CUSTOM_SKILL_PREFIX) ? key.slice(CUSTOM_SKILL_PREFIX.length) : key,
        );
        const outgoingContent = await buildOutgoingContent(content, selectedSkillNamesSnapshot);
        const editingQueuedMessage = editingQueuedMessageId
          ? queuedMessagesRef.current.find(
              (queuedMessage) => queuedMessage.id === editingQueuedMessageId,
            )
          : null;

        if (editingQueuedMessage) {
          const targetConversationId = currentConversationIdRef.current ?? queueConversationId;
          if (!targetConversationId) {
            setStreamError("Queue is not ready yet for this chat. Please retry in a second.");
            return false;
          }
          await updateConversationQueuedMessage({
            queuedMessageId: editingQueuedMessage.id,
            conversationId: targetConversationId,
            content: outgoingContent,
            selectedPlatformSkillSlugs: editingQueuedMessage.selectedPlatformSkillSlugs,
            fileAttachments: editingQueuedMessage.attachments,
          });
          setEditingQueuedMessageId(null);
          clearSelectedSkillSlugs(skillSelectionScopeKey);
          return true;
        }

        if (isStreaming) {
          if (!queueingEnabled) {
            setStreamError("Queueing is off. Wait for the current response or stop it first.");
            return;
          }
          const targetConversationId = currentConversationIdRef.current ?? queueConversationId;
          if (!targetConversationId) {
            setStreamError("Queue is not ready yet for this new chat. Please retry in a second.");
            return;
          }
          await enqueueConversationMessage({
            conversationId: targetConversationId,
            content: outgoingContent,
            selectedPlatformSkillSlugs,
            fileAttachments: attachments,
            replaceExisting: false,
          });
          clearSelectedSkillSlugs(skillSelectionScopeKey);
          return true;
        }

        clearSelectedSkillSlugs(skillSelectionScopeKey);
        setArmedDebugPreset(null);
        await runGeneration(outgoingContent, attachments, {
          selectedSkillKeysOverride: selectedSkillKeysSnapshot,
          debugRunDeadlineMs: armedPresetSnapshot?.debugRunDeadlineMs,
          debugApprovalHotWaitMs: armedPresetSnapshot?.debugApprovalHotWaitMs,
        });
        return true;
      } catch (error) {
        console.error("Failed to send chat message:", error);
        setStreamError(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to send message. Please try again.",
        );
        return false;
      }
    },
    [
      armedDebugPreset,
      buildOutgoingContent,
      clearSelectedSkillSlugs,
      editingQueuedMessageId,
      enqueueConversationMessage,
      isStreaming,
      queueConversationId,
      queueingEnabled,
      runGeneration,
      selectedSkillKeys,
      skillSelectionScopeKey,
      updateConversationQueuedMessage,
    ],
  );

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const handleExternalSend = (event: Event) => {
      const customEvent = event as CustomEvent<ChatExternalSendDetail>;
      const detail = customEvent.detail;
      if (!detail) {
        return;
      }

      const activeConversationId = currentConversationIdRef.current ?? conversationId;
      if (!activeConversationId || detail.conversationId !== activeConversationId) {
        return;
      }

      void handleSend(detail.content, detail.attachments);
    };

    window.addEventListener(CHAT_EXTERNAL_SEND_EVENT, handleExternalSend);
    return () => {
      window.removeEventListener(CHAT_EXTERNAL_SEND_EVENT, handleExternalSend);
    };
  }, [conversationId, handleSend]);

  useEffect(() => {
    updateChatDebugSnapshot({
      conversationId:
        currentConversationIdRef.current ?? draftConversationId ?? conversationId ?? null,
      generationId: activeGeneration?.generationId ?? null,
      status: activeGeneration?.status ?? null,
      pauseReason: activeGeneration?.pauseReason ?? null,
    });
  }, [
    activeGeneration?.generationId,
    activeGeneration?.pauseReason,
    activeGeneration?.status,
    conversationId,
    draftConversationId,
    updateChatDebugSnapshot,
  ]);

  useEffect(() => {
    if (
      activeGeneration?.status === "paused" &&
      activeGeneration.pauseReason === "run_deadline" &&
      activeGeneration.generationId
    ) {
      const pausedGenerationId = activeGeneration.generationId;
      const pausedDebugRunDeadlineMs = activeGeneration.debugRunDeadlineMs ?? null;
      setPendingRunDeadlineResume((current) => {
        if (
          current?.generationId === pausedGenerationId &&
          current.debugRunDeadlineMs === pausedDebugRunDeadlineMs
        ) {
          return current;
        }
        return {
          generationId: pausedGenerationId,
          debugRunDeadlineMs: pausedDebugRunDeadlineMs,
        };
      });
      return;
    }

    setPendingRunDeadlineResume((current) => {
      if (!current) {
        return current;
      }
      if (
        activeGeneration?.generationId &&
        current.generationId === activeGeneration.generationId &&
        activeGeneration.status === "paused" &&
        activeGeneration.pauseReason === "run_deadline"
      ) {
        return current;
      }
      return null;
    });
  }, [
    activeGeneration?.debugRunDeadlineMs,
    activeGeneration?.generationId,
    activeGeneration?.pauseReason,
    activeGeneration?.status,
  ]);

  useEffect(() => {
    if (
      activeGeneration?.status !== "paused" ||
      activeGeneration.pauseReason !== "run_deadline" ||
      !activeGeneration.generationId ||
      !Array.isArray(activeGeneration.contentParts)
    ) {
      return;
    }

    const hydratedBlock = buildHistoricalActivityBlockFromContentParts({
      generationId: activeGeneration.generationId,
      runtimeLimitMs: activeGeneration.debugRunDeadlineMs ?? null,
      contentParts: activeGeneration.contentParts as PersistedContentPart[],
    });

    if (!hydratedBlock) {
      return;
    }

    setHistoricalActivityBlocks((current) => {
      const existingIndex = current.findIndex(
        (block) => block.generationId === activeGeneration.generationId,
      );
      if (existingIndex === -1) {
        return [...current, hydratedBlock];
      }
      const next = [...current];
      next[existingIndex] = {
        ...hydratedBlock,
        awaitingResume: current[existingIndex]?.awaitingResume ?? hydratedBlock.awaitingResume,
      };
      return next;
    });
  }, [
    activeGeneration?.contentParts,
    activeGeneration?.debugRunDeadlineMs,
    activeGeneration?.generationId,
    activeGeneration?.pauseReason,
    activeGeneration?.status,
  ]);

  const handleSendQueuedNow = useCallback(
    (queued: QueuedMessage) => {
      const send = async () => {
        if (!queueConversationId) {
          return;
        }
        if (isStreaming) {
          setStreamError("Queued message will run automatically when this response is finished.");
          return;
        }
        await removeConversationQueuedMessage({
          queuedMessageId: queued.id,
          conversationId: queueConversationId,
        });
        await runGeneration(queued.content, queued.attachments, {
          selectedSkillKeysOverride: queued.selectedPlatformSkillSlugs,
        });
      };
      void send();
    },
    [isStreaming, queueConversationId, removeConversationQueuedMessage, runGeneration],
  );

  const handleSendFirstQueuedNow = useCallback(() => {
    const queued = queuedMessagesRef.current[0];
    if (!queued) {
      return;
    }
    handleSendQueuedNow(queued);
  }, [handleSendQueuedNow]);

  const handleClearQueued = useCallback(
    (queued: QueuedMessage) => {
      const clear = async () => {
        if (!queueConversationId) {
          return;
        }
        await removeConversationQueuedMessage({
          queuedMessageId: queued.id,
          conversationId: queueConversationId,
        });
      };
      void clear();
    },
    [queueConversationId, removeConversationQueuedMessage],
  );

  const handleEditQueuedMessage = useCallback((queued: QueuedMessage) => {
    setEditingQueuedMessageId(queued.id);
    setInputPrefillRequest({
      id: `prefill-${Date.now()}`,
      text: queued.content,
    });
  }, []);

  // Handle approval/denial of tool use
  const handleApprove = useCallback(
    async (toolUseId: string, interruptId?: string, questionAnswers?: string[][]) => {
      if (toolUseId === RUN_DEADLINE_RESUME_TOOL_USE_ID) {
        const affirmativeAnswer = questionAnswers?.some((answers) =>
          answers.some((answer) => answer.trim().toLowerCase() === "yes"),
        );
        if (affirmativeAnswer ?? true) {
          await handleResumePausedRunDeadline();
        }
        return;
      }

      if (!interruptId) {
        return;
      }

      const runtime = runtimeRef.current;
      if (runtime) {
        runtime.setApprovalStatus(toolUseId, "approved", questionAnswers);
        syncFromRuntime(runtime);
      } else {
        optimisticallyResumeInterruptedGeneration(interruptId, "approval", {
          questionAnswers,
        });
      }

      try {
        await submitApproval({
          interruptId,
          decision: "approve",
          questionAnswers,
        });
      } catch (err) {
        console.error("Failed to approve tool use:", err);
      }
    },
    [
      handleResumePausedRunDeadline,
      optimisticallyResumeInterruptedGeneration,
      submitApproval,
      syncFromRuntime,
    ],
  );

  const handleDeny = useCallback(
    async (toolUseId: string, interruptId?: string) => {
      if (toolUseId === RUN_DEADLINE_RESUME_TOOL_USE_ID) {
        const generationId =
          pendingRunDeadlineResume?.generationId ?? activeGeneration?.generationId ?? null;
        setPendingRunDeadlineResume(null);
        if (generationId) {
          setDismissedRunDeadlineGenerationId(generationId);
          setHistoricalActivityBlocks((current) =>
            current.map((block) =>
              block.generationId === generationId ? { ...block, awaitingResume: false } : block,
            ),
          );
        }
        return;
      }

      if (!interruptId) {
        return;
      }

      try {
        await submitApproval({
          interruptId,
          decision: "deny",
        });
        if (runtimeRef.current) {
          runtimeRef.current.setApprovalStatus(toolUseId, "denied");
          syncFromRuntime(runtimeRef.current);
        }
      } catch (err) {
        console.error("Failed to deny tool use:", err);
      }
    },
    [
      activeGeneration?.generationId,
      pendingRunDeadlineResume?.generationId,
      submitApproval,
      syncFromRuntime,
    ],
  );

  // Handle auth connect - redirect to OAuth
  const handleAuthConnect = useCallback(
    async (integration: string) => {
      const convId = interactiveConversationId;
      const pendingAuthInterruptId =
        displaySegments.find((segment) => segment.auth?.status === "pending")?.auth?.interruptId ??
        null;
      if (!pendingAuthInterruptId || !convId) {
        return;
      }

      if (runtimeRef.current) {
        runtimeRef.current.setAuthConnecting();
        syncFromRuntime(runtimeRef.current);
      }

      try {
        // Get auth URL and redirect
        const result = await getAuthUrl({
          type: integration as
            | "google_gmail"
            | "outlook"
            | "outlook_calendar"
            | "google_calendar"
            | "google_docs"
            | "google_sheets"
            | "google_drive"
            | "notion"
            | "github"
            | "airtable"
            | "slack"
            | "hubspot"
            | "linkedin"
            | "salesforce"
            | "dynamics"
            | "reddit"
            | "twitter",
          redirectUrl: `${window.location.origin}/chat/${convId}?auth_complete=${integration}&interrupt_id=${pendingAuthInterruptId}`,
        });
        window.location.href = result.authUrl;
      } catch (err) {
        console.error("Failed to get auth URL:", err);
        setStreamError(
          isUnipileMissingCredentialsError(err)
            ? UNIPILE_MISSING_CREDENTIALS_MESSAGE
            : "Failed to start integration connection. Please try again.",
        );
        if (runtimeRef.current) {
          runtimeRef.current.setAuthPending();
          syncFromRuntime(runtimeRef.current);
        }
      }
    },
    [displaySegments, getAuthUrl, interactiveConversationId, syncFromRuntime],
  );

  // Handle auth cancel
  const handleAuthCancel = useCallback(async () => {
    const seg = displaySegments.find((s) => s.auth?.status === "pending");
    const integration = seg?.auth?.integrations[0];
    const interruptId = seg?.auth?.interruptId;
    if (!integration || !interruptId) {
      return;
    }

    try {
      await submitAuthResult({
        interruptId,
        integration,
        success: false,
      });

      if (runtimeRef.current) {
        runtimeRef.current.setAuthCancelled();
        syncFromRuntime(runtimeRef.current);
      }
    } catch (err) {
      console.error("Failed to cancel auth:", err);
    }
  }, [displaySegments, submitAuthResult, syncFromRuntime]);
  const segmentApproveHandlers = useMemo(() => {
    const handlers = new Map<string, (questionAnswers?: string[][]) => void>();
    for (const segment of displaySegments) {
      const toolUseId = segment.approval?.toolUseId;
      if (!toolUseId) {
        continue;
      }
      const interruptId = segment.approval?.interruptId;
      handlers.set(segment.id, (questionAnswers?: string[][]) => {
        void handleApprove(toolUseId, interruptId, questionAnswers);
      });
    }
    return handlers;
  }, [displaySegments, handleApprove]);
  const segmentDenyHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    for (const segment of displaySegments) {
      const toolUseId = segment.approval?.toolUseId;
      if (!toolUseId) {
        continue;
      }
      const interruptId = segment.approval?.interruptId;
      handlers.set(segment.id, () => {
        void handleDeny(toolUseId, interruptId);
      });
    }
    return handlers;
  }, [displaySegments, handleDeny]);
  const handleAutoApproveChange = useCallback(
    (checked: boolean) => {
      if (isCoworkerConversation) {
        setLocalAutoApprove(false);
        return;
      }
      setLocalAutoApprove(checked);
      if (conversationId) {
        updateAutoApprove({
          id: conversationId,
          autoApprove: checked,
        });
      }
    },
    [conversationId, isCoworkerConversation, updateAutoApprove],
  );

  const selectedSkillLabel = useMemo(() => {
    const selectableSkills = [
      ...(platformSkills ?? []).map((skill) => ({
        key: skill.slug,
        title: skill.title,
        searchable: `${skill.title} ${skill.slug}`.toLowerCase(),
      })),
      ...((accessibleSkills ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          key: `${CUSTOM_SKILL_PREFIX}${skill.name}`,
          title: skill.displayName,
          subtitle: skill.isOwnedByCurrentUser
            ? skill.visibility === "public"
              ? "Custom · Public"
              : "Custom · Private"
            : `Shared · ${skill.owner.name ?? skill.owner.email ?? "Workspace"}`,
          searchable: `${skill.displayName} ${skill.name} ${skill.owner.name ?? ""} ${
            skill.owner.email ?? ""
          } ${skill.visibility}`.toLowerCase(),
        })) ?? []),
    ];

    if (selectedSkillKeys.length === 0) {
      return "Skills";
    }
    if (selectedSkillKeys.length === 1) {
      const only = selectableSkills.find((skill) => skill.key === selectedSkillKeys[0]);
      const fallback = selectedSkillKeys[0] ?? "1 skill";
      return only?.title ?? fallback.replace(CUSTOM_SKILL_PREFIX, "");
    }
    return `${selectedSkillKeys.length} skills`;
  }, [platformSkills, accessibleSkills, selectedSkillKeys]);

  const filteredSelectableSkills = useMemo(() => {
    const selectableSkills = [
      ...(platformSkills ?? []).map((skill) => ({
        key: skill.slug,
        title: skill.title,
        subtitle: "Platform",
        searchable: `${skill.title} ${skill.slug}`.toLowerCase(),
      })),
      ...((accessibleSkills ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          key: `${CUSTOM_SKILL_PREFIX}${skill.name}`,
          title: skill.displayName,
          subtitle: skill.isOwnedByCurrentUser
            ? skill.visibility === "public"
              ? "Custom · Public"
              : "Custom · Private"
            : `Shared · ${skill.owner.name ?? skill.owner.email ?? "Workspace"}`,
          searchable: `${skill.displayName} ${skill.name} ${skill.owner.name ?? ""} ${
            skill.owner.email ?? ""
          } ${skill.visibility}`.toLowerCase(),
        })) ?? []),
    ];
    const query = skillSearchQuery.trim().toLowerCase();
    if (!query) {
      return selectableSkills;
    }
    return selectableSkills.filter((skill) => skill.searchable.includes(query));
  }, [platformSkills, accessibleSkills, skillSearchQuery]);

  const handleSkillDropdownSelect = useCallback(
    (event: Event) => {
      event.preventDefault();
      const target = event.currentTarget as HTMLElement | null;
      const key = target?.dataset.skillSlug;
      if (!key) {
        return;
      }
      toggleSelectedSkillSlug(skillSelectionScopeKey, key);
    },
    [skillSelectionScopeKey, toggleSelectedSkillSlug],
  );

  const handleSkillSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSkillSearchQuery(event.target.value);
  }, []);

  const handleCloseSkillsMenu = useCallback(() => {
    setSkillsMenuOpen(false);
  }, []);

  const handleClearSelectedSkills = useCallback(() => {
    clearSelectedSkillSlugs(skillSelectionScopeKey);
  }, [clearSelectedSkillSlugs, skillSelectionScopeKey]);

  const handleOpenSkillsChange = useCallback((open: boolean) => {
    setSkillsMenuOpen(open);
    if (!open) {
      setSkillSearchQuery("");
    }
  }, []);
  const skillsMenuNode = useMemo(
    () => (
      <DropdownMenu open={skillsMenuOpen} onOpenChange={handleOpenSkillsChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={selectedSkillLabel}
            className="text-muted-foreground hover:bg-muted hover:text-foreground relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            {selectedSkillKeys.length > 0 ? (
              <span className="bg-foreground text-background absolute -top-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-medium">
                {selectedSkillKeys.length}
              </span>
            ) : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={12}
          className="border-border/80 bg-background/95 flex h-[360px] w-[320px] flex-col rounded-xl p-0 shadow-xl backdrop-blur-sm"
        >
          <DropdownMenuLabel className="px-3 py-2.5">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
              <Input
                value={skillSearchQuery}
                onChange={handleSkillSearchChange}
                placeholder="Search skills..."
                className="h-9 pl-8"
              />
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {isPlatformSkillsLoading || isAccessibleSkillsLoading ? (
              <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
            ) : filteredSelectableSkills.length === 0 ? (
              <DropdownMenuItem disabled>No skills found</DropdownMenuItem>
            ) : (
              filteredSelectableSkills.map((skill) => {
                const isSelected = selectedSkillKeys.includes(skill.key);
                return (
                  <DropdownMenuItem
                    key={skill.key}
                    data-skill-slug={skill.key}
                    onSelect={handleSkillDropdownSelect}
                  >
                    <Check className={isSelected ? "h-4 w-4 opacity-100" : "h-4 w-4 opacity-0"} />
                    <div className="min-w-0">
                      <div className="truncate">{skill.title}</div>
                      <div className="text-muted-foreground truncate text-[10px]">
                        {skill.subtitle}
                      </div>
                    </div>
                  </DropdownMenuItem>
                );
              })
            )}
          </div>
          <DropdownMenuSeparator />
          <div className="grid grid-cols-2 items-center gap-0 p-1">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClearSelectedSkills}
              disabled={selectedSkillKeys.length === 0}
              className="h-10 rounded-md"
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleCloseSkillsMenu}
              className="h-10 rounded-md"
            >
              Close
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [
      filteredSelectableSkills,
      handleClearSelectedSkills,
      handleCloseSkillsMenu,
      handleOpenSkillsChange,
      handleSkillDropdownSelect,
      handleSkillSearchChange,
      isAccessibleSkillsLoading,
      isPlatformSkillsLoading,
      selectedSkillKeys,
      selectedSkillLabel,
      skillSearchQuery,
      skillsMenuOpen,
    ],
  );
  const modelSelectorNode = useMemo(
    () => (
      <ModelSelector
        selectedModel={normalizedSelectedModel}
        selectedAuthSource={selectedAuthSource}
        providerAvailability={providerAvailability}
        onSelectionChange={setSelection}
        disabled={isStreaming}
      />
    ),
    [isStreaming, normalizedSelectedModel, providerAvailability, selectedAuthSource, setSelection],
  );
  const autoApprovalNode = useMemo(
    () => (
      <div className="flex items-center gap-1.5">
        <Switch
          id="auto-approve"
          checked={isCoworkerConversation ? false : autoApproveEnabled}
          onCheckedChange={handleAutoApproveChange}
          disabled={isCoworkerConversation}
        />
        <label
          htmlFor="auto-approve"
          className="text-muted-foreground flex cursor-pointer items-center gap-1 text-xs select-none"
        >
          <CircleCheck className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Auto-approve</span>
        </label>
      </div>
    ),
    [autoApproveEnabled, handleAutoApproveChange, isCoworkerConversation],
  );
  const debugControlNode = useMemo(() => {
    if (!isAdmin || isAdminLoading) {
      return null;
    }

    return (
      <ChatDebugPopover
        armedPreset={armedDebugPreset}
        snapshot={chatDebugSnapshot}
        disabled={isStreaming}
        onArmPreset={handleArmDebugPreset}
        onClearPreset={handleClearDebugPreset}
        onResumeRunDeadline={handleResumePausedRunDeadline}
        isResumingRunDeadline={isResumingPausedRunDeadline}
      />
    );
  }, [
    armedDebugPreset,
    chatDebugSnapshot,
    handleArmDebugPreset,
    handleClearDebugPreset,
    handleResumePausedRunDeadline,
    isAdmin,
    isAdminLoading,
    isResumingPausedRunDeadline,
    isStreaming,
  ]);

  useEffect(() => {
    setHeaderActions(debugControlNode);
    return () => {
      setHeaderActions(null);
    };
  }, [debugControlNode, setHeaderActions]);

  const transcriptNodes = useMemo(() => {
    const continueMessageIndices = messages.reduce<number[]>((indices, message, index) => {
      if (isContinueMessage(message)) {
        indices.push(index);
      }
      return indices;
    }, []);

    const pairedBlockCount = Math.min(
      historicalActivityBlocks.length,
      continueMessageIndices.length,
    );
    const pairedBlocks = historicalActivityBlocks.slice(0, pairedBlockCount);
    const trailingBlocks = historicalActivityBlocks.slice(pairedBlockCount);

    const nodes: React.ReactNode[] = [];
    let cursor = 0;

    for (let index = 0; index < pairedBlockCount; index += 1) {
      const continueIndex = continueMessageIndices[index];
      const messageSlice = messages.slice(cursor, continueIndex);
      if (messageSlice.length > 0) {
        nodes.push(
          <MessageList key={`messages-before-${continueIndex}`} messages={messageSlice} />,
        );
      }

      const block = pairedBlocks[index];
      if (block) {
        nodes.push(renderHistoricalActivityBlock(block));
      }

      const continueMessage = messages.slice(continueIndex, continueIndex + 1);
      if (continueMessage.length > 0) {
        nodes.push(
          <MessageList key={`messages-continue-${continueIndex}`} messages={continueMessage} />,
        );
      }

      cursor = continueIndex + 1;
    }

    const remainingMessages = messages.slice(cursor);
    if (remainingMessages.length > 0) {
      nodes.push(<MessageList key="messages-remaining" messages={remainingMessages} />);
    }

    for (const block of trailingBlocks) {
      nodes.push(renderHistoricalActivityBlock(block));
    }

    return nodes;
  }, [historicalActivityBlocks, messages]);
  const latestOutputHtmlFile = useMemo(
    () => (enableOutputPreview ? findLatestOutputHtmlFile(messages) : null),
    [enableOutputPreview, messages],
  );

  useEffect(() => {
    if (!outputPreviewStorageKey || !latestOutputHtmlFile || typeof window === "undefined") {
      return;
    }

    setIsOutputPreviewCollapsed(
      window.localStorage.getItem(outputPreviewStorageKey) === "collapsed",
    );
  }, [latestOutputHtmlFile, outputPreviewStorageKey]);

  const handleOutputPreviewCollapsedChange = useCallback(
    (collapsed: boolean) => {
      setIsOutputPreviewCollapsed(collapsed);
      if (outputPreviewStorageKey && typeof window !== "undefined") {
        window.localStorage.setItem(outputPreviewStorageKey, collapsed ? "collapsed" : "open");
      }
    },
    [outputPreviewStorageKey],
  );
  const handleCloseOutputPreview = useCallback(() => {
    handleOutputPreviewCollapsedChange(true);
  }, [handleOutputPreviewCollapsedChange]);

  // Voice recording: stop and transcribe
  const stopRecordingAndTranscribe = useCallback(async () => {
    if (!isRecordingRef.current) {
      return;
    }
    isRecordingRef.current = false;

    const audioBlob = await stopRecording();
    if (!audioBlob || audioBlob.size === 0) {
      return;
    }

    setIsProcessingVoice(true);
    try {
      const base64Audio = await blobToBase64(audioBlob);
      const result = await transcribe({
        audio: base64Audio,
        mimeType: audioBlob.type || "audio/webm",
      });

      if (result.text && result.text.trim()) {
        setInputPrefillRequest({
          id: `voice-prefill-${Date.now()}`,
          text: result.text.trim(),
          mode: "append",
        });
      }
    } catch (err) {
      console.error("Transcription error:", err);
    } finally {
      setIsProcessingVoice(false);
    }
  }, [stopRecording, transcribe]);

  // Start recording handler (for both keyboard and button)
  const handleStartRecording = useCallback(() => {
    if (!isRecordingRef.current && !isStreaming && !isProcessingVoice) {
      isRecordingRef.current = true;
      startRecording();
    }
  }, [startRecording, isStreaming, isProcessingVoice]);

  // Push-to-talk: Ctrl/Cmd + K - start recording on keydown
  useHotkeys(
    "mod+k",
    handleStartRecording,
    {
      keydown: true,
      keyup: false,
      preventDefault: true,
      enableOnFormTags: true,
    },
    [handleStartRecording],
  );

  useHotkeys(
    "mod+enter",
    () => {
      handleSendFirstQueuedNow();
    },
    {
      keydown: true,
      keyup: false,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [handleSendFirstQueuedNow],
  );

  // Push-to-talk: stop recording when any part of the hotkey combo is released
  // On Mac, releasing M while Cmd is held doesn't always fire keyup for M,
  // so we also stop when Meta/Ctrl is released
  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isRecordingRef.current) {
        return;
      }

      const isHotkeyRelease =
        e.key === "k" ||
        e.key === "K" ||
        e.code === "KeyK" ||
        e.key === "Meta" ||
        e.key === "Control";

      if (isHotkeyRelease) {
        stopRecordingAndTranscribe();
      }
    };

    document.addEventListener("keyup", handleKeyUp);
    return () => document.removeEventListener("keyup", handleKeyUp);
  }, [stopRecordingAndTranscribe]);

  const chatContent = useMemo(
    () => (
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-0 flex-1 overflow-y-auto p-4"
        >
          <div className="mx-auto max-w-3xl">
            {showModelSwitchWarning && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Changing model mid-conversation can degrade performance.</span>
              </div>
            )}
            {streamError && (
              <div className="border-destructive/30 bg-destructive/10 text-destructive mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <span>{streamError}</span>
              </div>
            )}
            {transcriptNodes.length > 0 && transcriptNodes}

            {isEmptyChat ? null : (
              <>
                {(isStreaming || displaySegments.length > 0) && (
                  <div className="space-y-4 py-4">
                    {isStreaming && displaySegments.length === 0 && (
                      <div className="border-border/50 bg-muted/30 rounded-lg border">
                        <div className="flex items-center gap-2 px-3 py-2">
                          <Activity className="text-muted-foreground h-4 w-4" />
                          <span className="text-muted-foreground text-sm">
                            {getAgentInitLabel(agentInitStatus)}
                          </span>
                          <div className="flex-1" />
                          {initElapsedLabel && (
                            <div className="text-muted-foreground/70 inline-flex items-center gap-1 text-xs">
                              <Timer className="h-3 w-3" />
                              <span>{initElapsedLabel}</span>
                            </div>
                          )}
                          <div className="flex gap-1">
                            <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
                            <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
                            <span className="bg-muted-foreground/50 h-1.5 w-1.5 animate-bounce rounded-full" />
                          </div>
                        </div>
                      </div>
                    )}
                    {(() => {
                      const renderedSegments = [];

                      for (let index = 0; index < displaySegments.length; index += 1) {
                        const segment = displaySegments[index];
                        const visibleSegmentItems =
                          visibleActivityItemsBySegmentId.get(segment.id) ?? EMPTY_ACTIVITY_ITEMS;

                        const segmentIntegrations = Array.from(
                          new Set(
                            visibleSegmentItems
                              .filter((item) => item.integration)
                              .map((item) => item.integration as DisplayIntegrationType),
                          ),
                        );

                        renderedSegments.push(
                          <div key={segment.id} className="space-y-4">
                            {visibleSegmentItems.length > 0 && (
                              <ActivityFeed
                                items={visibleSegmentItems}
                                isStreaming={
                                  isStreaming &&
                                  index === displaySegments.length - 1 &&
                                  !segment.approval &&
                                  !segment.auth
                                }
                                isExpanded={segment.isExpanded}
                                onToggleExpand={segmentToggleHandlers.get(segment.id)!}
                                integrationsUsed={segmentIntegrations}
                                elapsedMs={streamElapsedMs ?? undefined}
                              />
                            )}

                            {segment.auth && segment.auth.status !== "pending" && (
                              <AuthRequestCard
                                integrations={segment.auth.integrations}
                                connectedIntegrations={segment.auth.connectedIntegrations}
                                reason={segment.auth.reason}
                                status={segment.auth.status}
                                isLoading={isSubmittingAuth}
                                onConnect={handleAuthConnect}
                                onCancel={handleAuthCancel}
                              />
                            )}
                            {segment.approval && segment.approval.status !== "pending" && (
                              <ToolApprovalCard
                                toolUseId={segment.approval.toolUseId}
                                toolName={segment.approval.toolName}
                                toolInput={segment.approval.toolInput}
                                integration={segment.approval.integration}
                                operation={segment.approval.operation}
                                command={segment.approval.command}
                                status={segment.approval.status}
                                questionAnswers={segment.approval.questionAnswers}
                                onApprove={
                                  segmentApproveHandlers.get(segment.id) ??
                                  NOOP_APPROVAL_WITH_ANSWERS
                                }
                                onDeny={segmentDenyHandlers.get(segment.id) ?? NOOP_APPROVAL}
                                readonly
                              />
                            )}
                          </div>,
                        );
                      }

                      return renderedSegments;
                    })()}
                  </div>
                )}
              </>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="bg-background mt-auto shrink-0 p-4">
          <div className="mx-auto w-full max-w-4xl space-y-2">
            {isEmptyChat && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {CHAT_QUICK_STARTERS.map((starter, i) => (
                    <motion.div
                      key={starter.label}
                      custom={i}
                      variants={CHAT_STARTER_VARIANTS}
                      initial="hidden"
                      animate="visible"
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        data-prompt={starter.prompt}
                        onClick={handleStarterButtonClick}
                      >
                        {starter.label}
                      </Button>
                    </motion.div>
                  ))}
                  <motion.div
                    custom={CHAT_QUICK_STARTERS.length}
                    variants={CHAT_STARTER_VARIANTS}
                    initial="hidden"
                    animate="visible"
                  >
                    <Button
                      type="button"
                      variant={isDiscoverOpen ? "outline" : "secondary"}
                      size="sm"
                      className="gap-1.5 rounded-full"
                      onClick={handleToggleDiscover}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Discover
                    </Button>
                  </motion.div>
                </div>

                <AnimatePresence>
                  {isDiscoverOpen && (
                    <motion.div
                      variants={CHAT_DISCOVER_PANEL_VARIANTS}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="overflow-hidden"
                    >
                      <div className="rounded-2xl border bg-stone-50/60 p-3">
                        <div className="mb-2.5 flex items-center justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground -mr-1 h-7 rounded-full px-2 text-xs"
                            onClick={handleCloseDiscover}
                          >
                            Close
                          </Button>
                        </div>

                        <div className="grid gap-2.5 sm:grid-cols-2">
                          {CHAT_DISCOVER_SECTIONS.map((section, sectionIdx) => (
                            <div key={section.title}>
                              <p className="mb-1.5 text-xs font-medium tracking-wide text-stone-500 uppercase">
                                {section.title}
                              </p>
                              <div className="flex flex-col gap-1">
                                {section.items.map((item, itemIdx) => (
                                  <motion.button
                                    key={item.label}
                                    type="button"
                                    custom={sectionIdx * 2 + itemIdx}
                                    variants={CHAT_DISCOVER_ITEM_VARIANTS}
                                    initial="hidden"
                                    animate="visible"
                                    className="hover:bg-background group rounded-xl px-2.5 py-2 text-left transition-colors"
                                    data-prompt={item.prompt}
                                    onClick={handleStarterButtonClick}
                                  >
                                    <span className="block text-sm font-medium">{item.label}</span>
                                    <span className="text-muted-foreground mt-0.5 line-clamp-1 block text-xs leading-relaxed">
                                      {item.prompt}
                                    </span>
                                  </motion.button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {(isRecording || isProcessingVoice || voiceError) && (
              <VoiceIndicator
                isRecording={isRecording}
                isProcessing={isProcessingVoice}
                error={voiceError}
              />
            )}
            {normalizedQueuedMessages.length > 0 && (
              <div className="from-muted/75 to-background rounded-3xl border bg-gradient-to-b px-4 py-3 shadow-[0_1px_0_0_hsl(var(--background))_inset,0_12px_24px_-22px_hsl(var(--foreground)/0.5)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="bg-background/80 border-border/70 inline-flex size-7 items-center justify-center rounded-full border">
                      <ListTree className="text-muted-foreground h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm leading-none font-medium">
                        {normalizedQueuedMessages.length} queued message
                        {normalizedQueuedMessages.length === 1 ? "" : "s"}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {queueingEnabled
                          ? "They run in order as soon as the current response finishes."
                          : "Queueing is off for new messages."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 space-y-1">
                  {normalizedQueuedMessages.map((queuedMessage, index) => (
                    <QueuedMessageRow
                      key={queuedMessage.id}
                      queuedMessage={queuedMessage}
                      index={index}
                      onSend={handleSendQueuedNow}
                      onClear={handleClearQueued}
                      onEdit={handleEditQueuedMessage}
                    />
                  ))}
                </div>
              </div>
            )}

            <BottomActionBar
              segments={displaySegments}
              segmentApproveHandlers={segmentApproveHandlers}
              segmentDenyHandlers={segmentDenyHandlers}
              isApproving={isApproving}
              handleAuthConnect={handleAuthConnect}
              handleAuthCancel={handleAuthCancel}
              isSubmittingAuth={isSubmittingAuth}
              onSubmit={handleSend}
              onStop={handleStop}
              disabled={isRecording || isProcessingVoice}
              isStreaming={isStreaming}
              isRecording={isRecording}
              onStartRecording={handleStartRecording}
              onStopRecording={stopRecordingAndTranscribe}
              prefillRequest={inputPrefillRequest}
              conversationId={draftConversationId}
              placeholder="Send a message..."
              animatedPlaceholders={CHAT_PLACEHOLDER_PROMPTS}
              shouldAnimatePlaceholder={isEmptyChat}
              renderSkills={skillsMenuNode}
              renderModelSelector={modelSelectorNode}
              renderAutoApproval={autoApprovalNode}
            />
          </div>
        </div>
      </div>
    ),
    [
      agentInitStatus,
      autoApprovalNode,
      displaySegments,
      draftConversationId,
      handleAuthCancel,
      handleAuthConnect,
      handleClearQueued,
      handleCloseDiscover,
      handleEditQueuedMessage,
      handleScroll,
      handleSend,
      handleSendQueuedNow,
      handleStartRecording,
      handleStarterButtonClick,
      handleStop,
      handleToggleDiscover,
      initElapsedLabel,
      inputPrefillRequest,
      isApproving,
      isDiscoverOpen,
      isEmptyChat,
      isProcessingVoice,
      isRecording,
      isStreaming,
      isSubmittingAuth,
      modelSelectorNode,
      normalizedQueuedMessages,
      queueingEnabled,
      scrollContainerRef,
      segmentApproveHandlers,
      segmentDenyHandlers,
      segmentToggleHandlers,
      showModelSwitchWarning,
      skillsMenuNode,
      stopRecordingAndTranscribe,
      streamElapsedMs,
      streamError,
      transcriptNodes,
      visibleActivityItemsBySegmentId,
      voiceError,
    ],
  );
  const outputPreviewPanel = useMemo(() => {
    if (!latestOutputHtmlFile) {
      return null;
    }

    return (
      <OutputHtmlPreviewPanel
        outputFile={latestOutputHtmlFile}
        onClose={handleCloseOutputPreview}
      />
    );
  }, [handleCloseOutputPreview, latestOutputHtmlFile]);

  if (conversationId && isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-muted-foreground">Loading conversation...</div>
      </div>
    );
  }

  if (enableOutputPreview && latestOutputHtmlFile && outputPreviewPanel) {
    return (
      <DualPanelWorkspace
        storageKey="chat-output-preview-panels-v1"
        defaultRightWidth={42}
        minRightWidth={34}
        collapsible
        collapsedSidebar
        showExpandedCollapseButton={false}
        showTitles={false}
        rightCollapsed={isOutputPreviewCollapsed}
        onRightCollapsedChange={handleOutputPreviewCollapsedChange}
        leftTitle="Chat"
        rightTitle="output.html"
        leftPanelClassName="border-0 rounded-none"
        separatorClassName="bg-muted/30"
        rightPanelClassName="border-0 rounded-none bg-muted/30 md:min-w-[28rem]"
        left={chatContent}
        right={outputPreviewPanel}
      />
    );
  }

  return chatContent;
}
