"use client";

import type { ProviderAuthSource } from "@cmdclaw/core/lib/provider-auth-source";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@cmdclaw/core/lib/chat-model-defaults";
import {
  CUSTOM_SKILL_PREFIX,
  type CoworkerToolAccessMode,
} from "@cmdclaw/core/lib/coworker-tool-policy";
import { EMAIL_FORWARDED_TRIGGER_TYPE } from "@cmdclaw/core/lib/email-forwarding";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Loader2,
  Play,
  ChevronDown,
  Circle,
  Shield,
  Upload,
  FileText,
  X,
  ArrowLeft,
  ArrowRight,
  Download,
  Pencil,
  Trash2,
  MessageSquare,
  Wrench,
  CirclePlay,
  Save,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { CHAT_EXTERNAL_SEND_EVENT, ChatArea } from "@/components/chat/chat-area";
import { ChatCopyButton } from "@/components/chat/chat-copy-button";
import { useChatSkillStore } from "@/components/chat/chat-skill-store";
import { ModelSelector } from "@/components/chat/model-selector";
import {
  extractRemoteRunSourceDetails,
  RemoteRunSourceBanner,
} from "@/components/coworkers/remote-run-source-banner";
import { RunDebugDetails } from "@/components/coworkers/run-debug-details";
import { ImpersonationRequiredPage } from "@/components/impersonation/impersonation-required-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DualPanelWorkspace } from "@/components/ui/dual-panel-workspace";
import { Input } from "@/components/ui/input";
import {
  MarkdownEditorModeToggle,
  type MarkdownEditorMode,
} from "@/components/ui/markdown-editor-mode-toggle";
import { MilkdownEditor } from "@/components/ui/milkdown-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AnimatedTabs, AnimatedTab } from "@/components/ui/tabs";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useIsMobile } from "@/hooks/use-mobile";
import { normalizeChatModelSelection } from "@/lib/chat-model-selection";
import { getCoworkerRouteSlug } from "@/lib/coworker-routes";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { normalizeGenerationError } from "@/lib/generation-errors";
import {
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_LOGOS,
  COWORKER_AVAILABLE_INTEGRATION_TYPES,
  isComingSoonIntegration,
  type IntegrationType,
} from "@/lib/integration-icons";
import {
  buildProviderAuthAvailabilityByProvider,
  type ProviderAuthAvailabilityByProvider,
} from "@/lib/provider-auth-availability";
import { cn } from "@/lib/utils";
import {
  useCreateCoworkerForwardingAlias,
  useDeleteCoworkerDocument,
  useDisableCoworkerForwardingAlias,
  useGetCoworkerDocumentUrl,
  useRotateCoworkerForwardingAlias,
  useCoworker,
  useCoworkerList,
  useCoworkerImpersonationTarget,
  useCoworkerForwardingAlias,
  useUpdateCoworker,
  useDeleteCoworker,
  useCoworkerRun,
  useCoworkerRunImpersonationTarget,
  useCoworkerRuns,
  useEnqueueConversationMessage,
  useWorkspaceMcpServerList,
  useTriggerCoworker,
  useGetOrCreateBuilderConversation,
  usePlatformSkillList,
  useProviderAuthStatus,
  useRemoteIntegrationTargets,
  useSearchRemoteIntegrationUsers,
  useSkillList,
  useUploadCoworkerDocument,
  type CoworkerSchedule,
} from "@/orpc/hooks";

const BASE_TRIGGERS = [
  { value: "manual", label: "Manual only" },
  { value: "schedule", label: "Run on a schedule" },
  { value: EMAIL_FORWARDED_TRIGGER_TYPE, label: "Email forwarded to CmdClaw" },
];

const LEGACY_HIDDEN_TRIGGERS = [{ value: "gmail.new_email", label: "New Gmail email" }];

const scheduleMotionInitial = { opacity: 0, y: -8, height: 0 } as const;
const scheduleMotionAnimate = { opacity: 1, y: 0, height: "auto" } as const;
const scheduleMotionExit = { opacity: 0, y: -8, height: 0 } as const;
const scheduleMotionTransition = { duration: 0.22, ease: "easeOut" } as const;
const scheduleMotionStyle = { overflow: "hidden" } as const;
const sectionMotionInitial = { height: 0, opacity: 0 } as const;
const sectionMotionAnimate = { height: "auto" as const, opacity: 1 } as const;
const sectionMotionExit = { height: 0, opacity: 0 } as const;
const sectionMotionTransition = { duration: 0.2 } as const;
const instructionRemarkPlugins = [remarkGfm, remarkBreaks];
const toolboxRevealInitial = { opacity: 0, y: -4 } as const;
const toolboxRevealAnimate = { opacity: 1, y: 0 } as const;
const toolboxRevealTransition = { duration: 0.15 } as const;
const statusTextMotionInitial = { opacity: 0, y: -4 } as const;
const statusTextMotionAnimate = { opacity: 1, y: 0 } as const;
const statusTextMotionExit = { opacity: 0, y: 4 } as const;
const runViewerMotionInitial = { opacity: 0, x: 24 } as const;
const runViewerMotionAnimate = { opacity: 1, x: 0 } as const;
const runViewerMotionExit = { opacity: 0, x: 24 } as const;
const runListMotionInitial = { opacity: 0, x: -24 } as const;
const runListMotionAnimate = { opacity: 1, x: 0 } as const;
const runListMotionExit = { opacity: 0, x: -24 } as const;
const runMotionTransition = { duration: 0.2, ease: "easeOut" } as const;
const statusTextMotionTransition = { duration: 0.15 } as const;
const DEFAULT_COWORKER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;
type CoworkerTab = "chat" | "instruction" | "runs" | "docs" | "toolbox" | "admin";
type RemoteIntegrationTargetEnv = "staging" | "prod";
type RemoteIntegrationUserOption = {
  id: string;
  email: string;
  name: string | null;
  enabledIntegrationTypes: IntegrationType[];
};

type CoworkerDocumentRecord = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  createdAt: Date | string;
};

type UploadAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

type CoworkerEditorPayload = {
  id: string;
  name: string;
  description: string;
  username: string;
  status: "on" | "off";
  triggerType: string;
  prompt: string;
  model: string;
  authSource: ProviderAuthSource | null;
  autoApprove: boolean;
  toolAccessMode: CoworkerToolAccessMode;
  allowedIntegrations: IntegrationType[];
  allowedWorkspaceMcpServerIds: string[];
  allowedSkillSlugs: string[];
  schedule: CoworkerSchedule | null;
  requiresUserInput: boolean;
  userInputPrompt: string | null;
};

const EMPTY_COWORKER_DOCUMENTS: CoworkerDocumentRecord[] = [];

function normalizeScheduleForComparison(schedule: CoworkerSchedule | null) {
  if (!schedule) {
    return null;
  }

  switch (schedule.type) {
    case "interval":
      return {
        type: "interval" as const,
        intervalMinutes: schedule.intervalMinutes,
      };
    case "daily":
      return {
        type: "daily" as const,
        time: schedule.time,
        timezone: schedule.timezone,
      };
    case "weekly":
      return {
        type: "weekly" as const,
        time: schedule.time,
        daysOfWeek: [...schedule.daysOfWeek].toSorted(),
        timezone: schedule.timezone,
      };
    case "monthly":
      return {
        type: "monthly" as const,
        time: schedule.time,
        dayOfMonth: schedule.dayOfMonth,
        timezone: schedule.timezone,
      };
    default:
      return schedule;
  }
}

function stringArraysEqual(left: string[], right: string[]) {
  return JSON.stringify([...left].toSorted()) === JSON.stringify([...right].toSorted());
}

function schedulesEqual(left: CoworkerSchedule | null, right: CoworkerSchedule | null) {
  return (
    JSON.stringify(normalizeScheduleForComparison(left)) ===
    JSON.stringify(normalizeScheduleForComparison(right))
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    const handleLoad = () => {
      reader.removeEventListener("load", handleLoad);
      reader.removeEventListener("error", handleError);
      resolve(String(reader.result ?? ""));
    };

    const handleError = () => {
      reader.removeEventListener("load", handleLoad);
      reader.removeEventListener("error", handleError);
      reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    };

    reader.addEventListener("load", handleLoad);
    reader.addEventListener("error", handleError);
    reader.readAsDataURL(file);
  });
}

function inferUploadMimeType(file: File): string {
  if (file.type.trim()) {
    return file.type;
  }

  const normalizedName = file.name.toLowerCase();
  if (normalizedName.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (normalizedName.endsWith(".doc")) {
    return "application/msword";
  }
  if (normalizedName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (normalizedName.endsWith(".xls")) {
    return "application/vnd.ms-excel";
  }
  if (normalizedName.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (normalizedName.endsWith(".csv")) {
    return "text/csv";
  }
  if (normalizedName.endsWith(".html") || normalizedName.endsWith(".htm")) {
    return "text/html";
  }
  if (normalizedName.endsWith(".txt") || normalizedName.endsWith(".md")) {
    return "text/plain";
  }
  if (normalizedName.endsWith(".png")) {
    return "image/png";
  }
  if (normalizedName.endsWith(".jpg") || normalizedName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalizedName.endsWith(".gif")) {
    return "image/gif";
  }
  if (normalizedName.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalizedName.endsWith(".svg")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildCoworkerDocumentBuilderMessage(filenames: string[]): string {
  return [
    "I uploaded new coworker documents:",
    ...filenames.map((filename) => `- ${filename}`),
    "",
    "Please add them to my agent instruction and use them when relevant.",
  ].join("\n");
}

function buildCoworkerDocumentRemovalBuilderMessage(filenames: string[]): string {
  return [
    "I removed coworker documents:",
    ...filenames.map((filename) => `- ${filename}`),
    "",
    "Please remove them from my agent instruction and stop using them.",
  ].join("\n");
}

function formatRelativeTime(value?: Date | string | null) {
  if (!value) {
    return "just now";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }

  const rawDistance = formatDistanceToNowStrict(date, { roundingMethod: "floor" });
  const [amount, unit] = rawDistance.split(" ");
  if (!amount || !unit || amount === "0") {
    return "just now";
  }

  const shortUnit = unit.startsWith("second")
    ? "s"
    : unit.startsWith("minute")
      ? "m"
      : unit.startsWith("hour")
        ? "h"
        : unit.startsWith("day")
          ? "d"
          : unit.startsWith("month")
            ? "mo"
            : unit.startsWith("year")
              ? "y"
              : unit;

  return `${amount}${shortUnit} ago`;
}

function CoworkerChatPanel({
  conversationId,
  coworkerId,
  onCoworkerSync,
  skillSelectionScopeKey,
  isLoading,
  errorMessage,
  onRetry,
}: {
  conversationId: string | null;
  coworkerId: string;
  onCoworkerSync: (payload: { coworkerId: string; prompt?: string; updatedAt?: string }) => void;
  skillSelectionScopeKey: string;
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
}) {
  if (!conversationId) {
    if (errorMessage) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <p className="text-sm font-medium">Failed to load builder chat</p>
            <p className="text-muted-foreground text-xs">{errorMessage}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className={cn("h-5 w-5 animate-spin", !isLoading && "opacity-60")} />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-end px-4 py-2">
        <ChatCopyButton conversationId={conversationId} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatArea
          conversationId={conversationId}
          forceCoworkerQuerySync
          coworkerIdForSync={coworkerId}
          onCoworkerSync={onCoworkerSync}
          skillSelectionScopeKey={skillSelectionScopeKey}
        />
      </div>
    </div>
  );
}

type CoworkerEditorPageProps = {
  coworkerIdOverride?: string;
  embedded?: boolean;
};

export default function CoworkerEditorPage({
  coworkerIdOverride,
  embedded = false,
}: CoworkerEditorPageProps = {}) {
  const params = useParams<{ id: string }>();
  const routeCoworkerSlug = params?.id;
  const coworkerList = useCoworkerList();
  const coworkerListItem = useMemo(
    () =>
      coworkerIdOverride
        ? null
        : (coworkerList.data?.find(
            (item) => item.username === routeCoworkerSlug || item.id === routeCoworkerSlug,
          ) ?? null),
    [coworkerIdOverride, coworkerList.data, routeCoworkerSlug],
  );
  const coworkerId = coworkerIdOverride ?? coworkerListItem?.id;
  const coworkerRouteSlug = coworkerIdOverride
    ? coworkerIdOverride
    : coworkerListItem
      ? getCoworkerRouteSlug(coworkerListItem)
      : routeCoworkerSlug;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAdmin } = useIsAdmin();
  const { data: coworker, isLoading, refetch: refetchCoworker } = useCoworker(coworkerId);
  const { data: platformSkills, isLoading: isPlatformSkillsLoading } = usePlatformSkillList();
  const { data: accessibleSkills, isLoading: isAccessibleSkillsLoading } = useSkillList();
  const { data: executorSourceData } = useWorkspaceMcpServerList();
  const { data: providerAuthStatus } = useProviderAuthStatus();
  const { data: remoteIntegrationTargetsData } = useRemoteIntegrationTargets({
    enabled: isAdmin,
  });
  const { data: coworkerForwardingAlias } = useCoworkerForwardingAlias(coworkerId);
  const { data: runs, refetch: refetchRuns } = useCoworkerRuns(coworkerId);
  const updateCoworker = useUpdateCoworker();
  const createForwardingAlias = useCreateCoworkerForwardingAlias();
  const disableForwardingAlias = useDisableCoworkerForwardingAlias();
  const rotateForwardingAlias = useRotateCoworkerForwardingAlias();
  const uploadCoworkerDocument = useUploadCoworkerDocument();
  const deleteCoworkerDocument = useDeleteCoworkerDocument();
  const getCoworkerDocumentUrl = useGetCoworkerDocumentUrl();
  const triggerCoworker = useTriggerCoworker();
  const deleteCoworker = useDeleteCoworker();
  const getOrCreateBuilderConversation = useGetOrCreateBuilderConversation();
  const enqueueConversationMessage = useEnqueueConversationMessage();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [username, setUsername] = useState("");
  const [triggerType, setTriggerType] = useState("manual");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(DEFAULT_COWORKER_MODEL);
  const [modelAuthSource, setModelAuthSource] = useState<ProviderAuthSource | null>("shared");
  const [toolAccessMode, setToolAccessMode] = useState<CoworkerToolAccessMode>("all");
  const [allowedIntegrations, setAllowedIntegrations] = useState<IntegrationType[]>([]);
  const [allowedWorkspaceMcpServerIds, setAllowedWorkspaceMcpServerIds] = useState<string[]>([]);
  const [allowedSkillSlugs, setAllowedSkillSlugs] = useState<string[]>([]);
  const [status, setStatus] = useState<"on" | "off">("off");
  const [autoApprove, setAutoApprove] = useState(true);
  const [requiresUserInput, setRequiresUserInput] = useState(false);
  const [userInputPrompt, setUserInputPrompt] = useState("");
  const [showDisableAutoApproveDialog, setShowDisableAutoApproveDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [copiedForwardingField, setCopiedForwardingField] = useState<
    "coworkerAlias" | "invokeHandle" | null
  >(null);
  const [builderConversationId, setBuilderConversationId] = useState<string | null>(null);
  const [isBuilderConversationLoading, setIsBuilderConversationLoading] = useState(false);
  const [builderConversationError, setBuilderConversationError] = useState<string | null>(null);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [deletingDocumentIds, setDeletingDocumentIds] = useState<string[]>([]);
  const [downloadingDocumentIds, setDownloadingDocumentIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<CoworkerTab>("instruction");
  const [remoteTargetEnv, setRemoteTargetEnv] = useState<RemoteIntegrationTargetEnv | null>(null);
  const [remoteUserQuery, setRemoteUserQuery] = useState("");
  const [selectedRemoteUser, setSelectedRemoteUser] = useState<RemoteIntegrationUserOption | null>(
    null,
  );
  const isMobile = useIsMobile();
  const deferredRemoteUserQuery = useDeferredValue(remoteUserQuery);
  const availableRemoteIntegrationTargets = useMemo(
    () => remoteIntegrationTargetsData?.targets ?? [],
    [remoteIntegrationTargetsData],
  );
  const remoteUserSearchEnabled = isAdmin && activeTab === "admin" && Boolean(remoteTargetEnv);
  const { data: remoteUserSearchData, isFetching: isRemoteUserSearchFetching } =
    useSearchRemoteIntegrationUsers(remoteTargetEnv, deferredRemoteUserQuery, {
      enabled: remoteUserSearchEnabled,
      limit: 12,
    });
  const routeRunId = useMemo(() => {
    if (embedded || !coworkerId || !pathname) {
      return null;
    }

    const prefix = `/agents/edit/${routeCoworkerSlug}/runs/`;
    if (!pathname.startsWith(prefix)) {
      return null;
    }

    const runId = pathname.slice(prefix.length);
    return runId.length > 0 ? runId : null;
  }, [coworkerId, embedded, pathname, routeCoworkerSlug]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(routeRunId);
  const isRunsRoute =
    !embedded && (pathname?.startsWith(`/agents/edit/${routeCoworkerSlug}/runs`) ?? false);
  const baseTabParam = searchParams.get("tab");
  const routeBaseTab: CoworkerTab | null =
    baseTabParam === "chat" ||
    baseTabParam === "instruction" ||
    baseTabParam === "docs" ||
    baseTabParam === "toolbox" ||
    baseTabParam === "admin"
      ? baseTabParam
      : null;
  const currentRoutePath = useMemo(() => {
    if (embedded && coworkerId) {
      return `/agents?agent=${encodeURIComponent(coworkerId)}`;
    }
    const query = searchParams.toString();
    return query && pathname
      ? `${pathname}?${query}`
      : (pathname ?? `/agents/edit/${coworkerRouteSlug}`);
  }, [coworkerId, coworkerRouteSlug, embedded, pathname, searchParams]);
  const shouldLoadCoworkerImpersonationTarget = Boolean(
    coworkerId && !routeRunId && !isLoading && !coworker,
  );
  const shouldLoadRunImpersonationTarget = Boolean(routeRunId && !isLoading && !coworker);
  const { data: coworkerImpersonationTarget, isLoading: isCoworkerImpersonationTargetLoading } =
    useCoworkerImpersonationTarget(coworkerId, {
      enabled: shouldLoadCoworkerImpersonationTarget,
    });
  const { data: runImpersonationTarget, isLoading: isRunImpersonationTargetLoading } =
    useCoworkerRunImpersonationTarget(routeRunId, coworkerId, {
      enabled: shouldLoadRunImpersonationTarget,
    });
  const hasSetMobileDefaultRef = useRef(false);
  const remoteUserOptions = useMemo(
    () => (remoteUserSearchData?.users as RemoteIntegrationUserOption[] | undefined) ?? [],
    [remoteUserSearchData],
  );

  useEffect(() => {
    if (!isAdmin && activeTab === "admin") {
      setActiveTab("instruction");
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setRemoteTargetEnv(null);
      setSelectedRemoteUser(null);
      setRemoteUserQuery("");
      return;
    }

    if (remoteTargetEnv && availableRemoteIntegrationTargets.includes(remoteTargetEnv)) {
      return;
    }

    setRemoteTargetEnv(
      availableRemoteIntegrationTargets.length > 0 ? availableRemoteIntegrationTargets[0] : null,
    );
  }, [availableRemoteIntegrationTargets, isAdmin, remoteTargetEnv]);

  useEffect(() => {
    setSelectedRemoteUser(null);
  }, [remoteTargetEnv]);
  useEffect(() => {
    if (!isMobile || hasSetMobileDefaultRef.current) {
      return;
    }
    hasSetMobileDefaultRef.current = true;
    if (!isRunsRoute) {
      setActiveTab("chat");
    }
  }, [isMobile, isRunsRoute]);

  useEffect(() => {
    if (!isRunsRoute) {
      setSelectedRunId(null);
      if (routeBaseTab) {
        setActiveTab(routeBaseTab);
      }
      return;
    }

    setActiveTab("runs");
    setSelectedRunId(routeRunId);
  }, [isRunsRoute, routeBaseTab, routeRunId]);
  const [isInstructionPanelCollapsed, setIsInstructionPanelCollapsed] = useState(true);
  const previousHasAgentInstructionsRef = useRef(false);
  const handleClose = useCallback(() => {
    setIsInstructionPanelCollapsed(true);
  }, []);
  const handleDelete = useCallback(() => {
    if (!coworkerId) {
      return;
    }
    deleteCoworker.mutate(coworkerId, {
      onSuccess: () => {
        toast.success("Coworker deleted");
        router.push(embedded ? "/agents" : "/agents");
      },
      onError: () => {
        toast.error("Failed to delete coworker");
      },
    });
  }, [coworkerId, deleteCoworker, embedded, router]);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedEditorRef = useRef(false);
  const initializedCoworkerIdRef = useRef<string | null>(null);
  const lastSyncedCoworkerUpdatedAtRef = useRef<string | null>(null);
  const lastSavedPayloadRef = useRef<string | null>(null);
  const lastSavedPayloadSnapshotRef = useRef<CoworkerEditorPayload | null>(null);
  const builderConversationInitializedRef = useRef(false);

  useEffect(() => {
    builderConversationInitializedRef.current = false;
    setBuilderConversationId(null);
    setBuilderConversationError(null);
    setIsBuilderConversationLoading(false);
  }, [coworkerId]);

  // Schedule state (only used when triggerType is "schedule")
  const [scheduleType, setScheduleType] = useState<"interval" | "daily" | "weekly" | "monthly">(
    "daily",
  );
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleDaysOfWeek, setScheduleDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const [scheduleTimezone, setScheduleTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const providerAvailability = useMemo(
    () =>
      buildProviderAuthAvailabilityByProvider({
        connectedProviders: providerAuthStatus?.connected,
        sharedConnectedProviders: providerAuthStatus?.shared,
      }),
    [providerAuthStatus],
  );
  const coworkerForwardingAddress = coworkerForwardingAlias?.forwardingAddress ?? null;
  const hasActiveForwardingAlias = Boolean(coworkerForwardingAlias?.activeAlias);
  const isEmailTriggerPersisted = coworker?.triggerType === EMAIL_FORWARDED_TRIGGER_TYPE;
  const persistedLegacyTriggers = useMemo(
    () => LEGACY_HIDDEN_TRIGGERS.filter(({ value }) => value === coworker?.triggerType),
    [coworker?.triggerType],
  );
  const integrationEntries = useMemo(
    () =>
      COWORKER_AVAILABLE_INTEGRATION_TYPES.map((key) => ({
        key,
        name: INTEGRATION_DISPLAY_NAMES[key],
        logo: INTEGRATION_LOGOS[key],
      })),
    [],
  );
  const allIntegrationTypes = useMemo(
    () => integrationEntries.map((entry) => entry.key),
    [integrationEntries],
  );
  const triggers = useMemo(
    () => [
      ...BASE_TRIGGERS,
      ...persistedLegacyTriggers,
      ...(isAdmin || !isComingSoonIntegration("twitter")
        ? ([{ value: "twitter.new_dm", label: "New X (Twitter) DM" }] as const)
        : []),
    ],
    [isAdmin, persistedLegacyTriggers],
  );
  const skillSelectionScopeKey = useMemo(
    () => (coworkerId ? `coworker-builder:${coworkerId}` : "coworker-builder"),
    [coworkerId],
  );
  const setSelectedSkillSlugs = useChatSkillStore((state) => state.setSelectedSkillSlugs);
  const selectedSkillKeys = allowedSkillSlugs;
  const availableSkills = useMemo(
    () => [
      ...(platformSkills ?? []).map((skill) => ({
        key: skill.slug,
        title: skill.title,
        source: "Platform" as const,
      })),
      ...((accessibleSkills ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          key: `${CUSTOM_SKILL_PREFIX}${skill.name}`,
          title: skill.displayName,
          source: skill.isOwnedByCurrentUser
            ? skill.visibility === "public"
              ? ("Custom Public" as const)
              : ("Custom Private" as const)
            : ("Shared" as const),
        })) ?? []),
    ],
    [accessibleSkills, platformSkills],
  );
  const executorSourceEntries = useMemo(
    () =>
      (executorSourceData?.sources ?? [])
        .filter((source) => source.enabled)
        .map((source) => ({
          id: source.id,
          title: source.name,
          namespace: source.namespace,
          kind: source.kind,
          connected: source.connected,
        })),
    [executorSourceData?.sources],
  );
  const restrictTools = toolAccessMode === "selected";

  const buildSchedule = useCallback((): CoworkerSchedule | null => {
    if (triggerType !== "schedule") {
      return null;
    }

    switch (scheduleType) {
      case "interval":
        return {
          type: "interval",
          intervalMinutes: Math.max(60, Math.round(intervalMinutes / 60) * 60),
        };
      case "daily":
        return {
          type: "daily",
          time: scheduleTime.slice(0, 5),
          timezone: scheduleTimezone,
        };
      case "weekly":
        return {
          type: "weekly",
          time: scheduleTime.slice(0, 5),
          daysOfWeek: scheduleDaysOfWeek,
          timezone: scheduleTimezone,
        };
      case "monthly":
        return {
          type: "monthly",
          time: scheduleTime.slice(0, 5),
          dayOfMonth: scheduleDayOfMonth,
          timezone: scheduleTimezone,
        };
      default:
        return null;
    }
  }, [
    intervalMinutes,
    scheduleDayOfMonth,
    scheduleDaysOfWeek,
    scheduleTime,
    scheduleTimezone,
    scheduleType,
    triggerType,
  ]);

  const applyScheduleState = useCallback((schedule: CoworkerSchedule | null) => {
    if (!schedule) {
      return;
    }

    setScheduleType(schedule.type);
    if (schedule.type === "interval") {
      setIntervalMinutes(Math.max(60, schedule.intervalMinutes));
      return;
    }

    setScheduleTime(schedule.time.slice(0, 5));
    setScheduleTimezone(
      schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    );
    if (schedule.type === "weekly") {
      setScheduleDaysOfWeek(schedule.daysOfWeek);
      return;
    }

    if (schedule.type === "monthly") {
      setScheduleDayOfMonth(schedule.dayOfMonth);
    }
  }, []);

  const applyEditorPayload = useCallback(
    (payload: CoworkerEditorPayload) => {
      setName(payload.name);
      setDescription(payload.description);
      setUsername(payload.username);
      setStatus(payload.status);
      setTriggerType(payload.triggerType);
      setPrompt(payload.prompt);
      setModel(payload.model);
      setModelAuthSource(payload.authSource);
      setAutoApprove(payload.autoApprove);
      setRequiresUserInput(payload.requiresUserInput);
      setUserInputPrompt(payload.userInputPrompt ?? "");
      setToolAccessMode(payload.toolAccessMode);
      setAllowedIntegrations(payload.allowedIntegrations);
      setAllowedWorkspaceMcpServerIds(payload.allowedWorkspaceMcpServerIds);
      setAllowedSkillSlugs(payload.allowedSkillSlugs);
      applyScheduleState(payload.schedule);
    },
    [applyScheduleState],
  );

  const getCoworkerUpdateInput = useCallback((): CoworkerEditorPayload | null => {
    if (!coworkerId) {
      return null;
    }
    return {
      id: coworkerId,
      name,
      description,
      username,
      status,
      triggerType,
      prompt,
      model,
      authSource: modelAuthSource,
      autoApprove,
      toolAccessMode,
      allowedIntegrations,
      allowedWorkspaceMcpServerIds,
      allowedSkillSlugs,
      schedule: buildSchedule(),
      requiresUserInput,
      userInputPrompt: userInputPrompt.trim() || null,
    };
  }, [
    allowedIntegrations,
    allowedWorkspaceMcpServerIds,
    allowedSkillSlugs,
    autoApprove,
    buildSchedule,
    description,
    model,
    modelAuthSource,
    name,
    prompt,
    requiresUserInput,
    status,
    toolAccessMode,
    triggerType,
    username,
    coworkerId,
    userInputPrompt,
  ]);

  const getCoworkerPayloadSignature = useCallback(
    (input: CoworkerEditorPayload) =>
      JSON.stringify({
        ...input,
        allowedIntegrations: [...input.allowedIntegrations].toSorted(),
        allowedWorkspaceMcpServerIds: [...input.allowedWorkspaceMcpServerIds].toSorted(),
        allowedSkillSlugs: [...input.allowedSkillSlugs].toSorted(),
        schedule: normalizeScheduleForComparison(input.schedule),
      }),
    [],
  );

  const persistCoworker = useCallback(
    async (options?: { force?: boolean }) => {
      const input = getCoworkerUpdateInput();
      if (!input) {
        return false;
      }

      const signature = getCoworkerPayloadSignature(input);
      if (!options?.force && signature === lastSavedPayloadRef.current) {
        return true;
      }

      setIsSaving(true);
      try {
        await updateCoworker.mutateAsync(input);
        lastSavedPayloadRef.current = signature;
        lastSavedPayloadSnapshotRef.current = input;
        return true;
      } catch (error) {
        console.error("Failed to update coworker:", error);
        toast.error("Failed to save coworker.");
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [getCoworkerPayloadSignature, getCoworkerUpdateInput, updateCoworker],
  );

  useEffect(() => {
    if (!coworker) {
      return;
    }

    const normalizedModelSelection = normalizeChatModelSelection({
      model: coworker.model ?? DEFAULT_COWORKER_MODEL,
      authSource: coworker.authSource ?? null,
    });
    const availableIntegrationTypes = COWORKER_AVAILABLE_INTEGRATION_TYPES;
    const coworkerAllowedIntegrations = (
      (coworker.allowedIntegrations ?? []) as IntegrationType[]
    ).filter((type): type is IntegrationType => availableIntegrationTypes.includes(type));
    const payloadFromCoworker: CoworkerEditorPayload = {
      id: coworker.id,
      name: coworker.name,
      description: coworker.description ?? "",
      username: coworker.username ?? "",
      status: coworker.status,
      triggerType: coworker.triggerType,
      prompt: coworker.prompt,
      model: coworker.model ?? DEFAULT_COWORKER_MODEL,
      authSource: normalizedModelSelection.authSource,
      autoApprove: coworker.autoApprove ?? true,
      toolAccessMode: coworker.toolAccessMode,
      allowedIntegrations: coworkerAllowedIntegrations,
      allowedWorkspaceMcpServerIds: coworker.allowedWorkspaceMcpServerIds ?? [],
      allowedSkillSlugs: coworker.allowedSkillSlugs ?? [],
      schedule: (coworker.schedule as CoworkerSchedule | null) ?? null,
      requiresUserInput: coworker.requiresUserInput ?? false,
      userInputPrompt: coworker.userInputPrompt ?? null,
    };
    const serverPayloadSignature = getCoworkerPayloadSignature(payloadFromCoworker);
    const currentLocalPayload = hasInitializedEditorRef.current ? getCoworkerUpdateInput() : null;
    const currentLocalSignature = currentLocalPayload
      ? getCoworkerPayloadSignature(currentLocalPayload)
      : null;
    const hasUnsavedLocalChanges =
      currentLocalSignature !== null &&
      lastSavedPayloadRef.current !== null &&
      currentLocalSignature !== lastSavedPayloadRef.current;
    const coworkerUpdatedAt =
      coworker.updatedAt instanceof Date
        ? coworker.updatedAt.toISOString()
        : new Date(coworker.updatedAt).toISOString();
    const isFirstHydration = initializedCoworkerIdRef.current !== coworker.id;
    const hasFreshServerUpdate = lastSyncedCoworkerUpdatedAtRef.current !== coworkerUpdatedAt;

    if (!isFirstHydration && !hasFreshServerUpdate) {
      return;
    }

    if (!isFirstHydration && hasUnsavedLocalChanges && currentLocalPayload) {
      const lastSavedPayload = lastSavedPayloadSnapshotRef.current;
      if (!lastSavedPayload) {
        return;
      }

      if (currentLocalPayload.name === lastSavedPayload.name) {
        setName(payloadFromCoworker.name);
      }
      if (currentLocalPayload.description === lastSavedPayload.description) {
        setDescription(payloadFromCoworker.description);
      }
      if (currentLocalPayload.username === lastSavedPayload.username) {
        setUsername(payloadFromCoworker.username);
      }
      if (currentLocalPayload.status === lastSavedPayload.status) {
        setStatus(payloadFromCoworker.status);
      }
      if (currentLocalPayload.triggerType === lastSavedPayload.triggerType) {
        setTriggerType(payloadFromCoworker.triggerType);
      }
      if (currentLocalPayload.prompt === lastSavedPayload.prompt) {
        setPrompt(payloadFromCoworker.prompt);
      }
      if (currentLocalPayload.model === lastSavedPayload.model) {
        setModel(payloadFromCoworker.model);
      }
      if (currentLocalPayload.authSource === lastSavedPayload.authSource) {
        setModelAuthSource(payloadFromCoworker.authSource);
      }
      if (currentLocalPayload.autoApprove === lastSavedPayload.autoApprove) {
        setAutoApprove(payloadFromCoworker.autoApprove);
      }
      if (currentLocalPayload.requiresUserInput === lastSavedPayload.requiresUserInput) {
        setRequiresUserInput(payloadFromCoworker.requiresUserInput);
      }
      if (currentLocalPayload.userInputPrompt === lastSavedPayload.userInputPrompt) {
        setUserInputPrompt(payloadFromCoworker.userInputPrompt ?? "");
      }
      if (currentLocalPayload.toolAccessMode === lastSavedPayload.toolAccessMode) {
        setToolAccessMode(payloadFromCoworker.toolAccessMode);
      }
      if (
        stringArraysEqual(
          currentLocalPayload.allowedIntegrations,
          lastSavedPayload.allowedIntegrations,
        )
      ) {
        setAllowedIntegrations(payloadFromCoworker.allowedIntegrations);
      }
      if (
        stringArraysEqual(
          currentLocalPayload.allowedWorkspaceMcpServerIds,
          lastSavedPayload.allowedWorkspaceMcpServerIds,
        )
      ) {
        setAllowedWorkspaceMcpServerIds(payloadFromCoworker.allowedWorkspaceMcpServerIds);
      }
      if (
        stringArraysEqual(currentLocalPayload.allowedSkillSlugs, lastSavedPayload.allowedSkillSlugs)
      ) {
        setAllowedSkillSlugs(payloadFromCoworker.allowedSkillSlugs);
      }
      if (schedulesEqual(currentLocalPayload.schedule, lastSavedPayload.schedule)) {
        applyScheduleState(payloadFromCoworker.schedule);
      }
    } else {
      applyEditorPayload(payloadFromCoworker);
    }

    initializedCoworkerIdRef.current = coworker.id;
    lastSyncedCoworkerUpdatedAtRef.current = coworkerUpdatedAt;
    hasInitializedEditorRef.current = true;
    lastSavedPayloadRef.current = serverPayloadSignature;
    lastSavedPayloadSnapshotRef.current = payloadFromCoworker;
  }, [
    applyEditorPayload,
    applyScheduleState,
    coworker,
    getCoworkerPayloadSignature,
    getCoworkerUpdateInput,
  ]);

  useEffect(() => {
    setSelectedSkillSlugs(skillSelectionScopeKey, allowedSkillSlugs);
  }, [allowedSkillSlugs, setSelectedSkillSlugs, skillSelectionScopeKey]);

  const loadBuilderConversation = useCallback(
    async (targetCoworkerId: string) => {
      setIsBuilderConversationLoading(true);
      setBuilderConversationError(null);

      try {
        const result = await getOrCreateBuilderConversation.mutateAsync(targetCoworkerId);
        setBuilderConversationId(result.conversationId);
        return result.conversationId;
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Please try again.";
        console.error("Failed to load builder conversation:", error);
        setBuilderConversationError(message);
        return null;
      } finally {
        setIsBuilderConversationLoading(false);
      }
    },
    [getOrCreateBuilderConversation],
  );

  // Get or create builder conversation once coworker loads
  useEffect(() => {
    if (!coworker || builderConversationInitializedRef.current || builderConversationId) {
      return;
    }
    builderConversationInitializedRef.current = true;
    void loadBuilderConversation(coworker.id);
  }, [builderConversationId, coworker, loadBuilderConversation]);

  const ensureBuilderConversationId = useCallback(async () => {
    if (builderConversationId) {
      return builderConversationId;
    }
    if (!coworkerId) {
      return null;
    }
    builderConversationInitializedRef.current = true;
    return await loadBuilderConversation(coworkerId);
  }, [builderConversationId, coworkerId, loadBuilderConversation]);

  const handleRetryBuilderConversation = useCallback(() => {
    if (!coworkerId) {
      return;
    }
    builderConversationInitializedRef.current = true;
    void loadBuilderConversation(coworkerId);
  }, [coworkerId, loadBuilderConversation]);

  const handleCoworkerSyncFromChat = useCallback(
    (sync: { coworkerId: string; prompt?: string; updatedAt?: string }) => {
      if (!coworkerId || sync.coworkerId !== coworkerId) {
        return;
      }

      const lastSavedPayload = lastSavedPayloadSnapshotRef.current;
      const promptWasLocallyEdited =
        typeof lastSavedPayload?.prompt === "string" && prompt !== lastSavedPayload.prompt;

      if (!promptWasLocallyEdited && typeof sync.prompt === "string") {
        setPrompt(sync.prompt);

        const optimisticPayload = getCoworkerUpdateInput();
        if (optimisticPayload) {
          const nextSavedPayload = {
            ...optimisticPayload,
            prompt: sync.prompt,
          };
          lastSavedPayloadSnapshotRef.current = nextSavedPayload;
          lastSavedPayloadRef.current = getCoworkerPayloadSignature(nextSavedPayload);
        }
      }

      const retryRefetch = async (attempt: number): Promise<void> => {
        const result = await refetchCoworker();
        const refetchedCoworker = result.data;
        const refetchedUpdatedAt = refetchedCoworker?.updatedAt
          ? refetchedCoworker.updatedAt instanceof Date
            ? refetchedCoworker.updatedAt.toISOString()
            : new Date(refetchedCoworker.updatedAt).toISOString()
          : null;

        if (
          (sync.updatedAt && refetchedUpdatedAt === sync.updatedAt) ||
          (sync.prompt && refetchedCoworker?.prompt === sync.prompt) ||
          attempt >= 2
        ) {
          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 150));
        await retryRefetch(attempt + 1);
      };

      void retryRefetch(0);
    },
    [coworkerId, getCoworkerPayloadSignature, getCoworkerUpdateInput, prompt, refetchCoworker],
  );

  const handleUploadDocuments = useCallback(
    async (files: FileList | File[]) => {
      if (!coworkerId) {
        return;
      }

      const nextFiles = Array.from(files).filter((file) => file.size > 0);
      if (nextFiles.length === 0) {
        return;
      }

      setIsUploadingDocuments(true);
      try {
        const attachments: UploadAttachment[] = await Promise.all(
          nextFiles.map(async (file) => ({
            name: file.name,
            mimeType: inferUploadMimeType(file),
            dataUrl: await readFileAsDataUrl(file),
          })),
        );

        const uploadedDocuments = await Promise.all(
          attachments.map((attachment) =>
            uploadCoworkerDocument.mutateAsync({
              coworkerId,
              filename: attachment.name,
              mimeType: attachment.mimeType,
              content: attachment.dataUrl.split(",")[1] ?? "",
            }),
          ),
        );

        const conversationId = await ensureBuilderConversationId();
        if (!conversationId) {
          toast.success(
            uploadedDocuments.length === 1
              ? `Uploaded ${uploadedDocuments[0]?.filename ?? "document"}.`
              : `Uploaded ${uploadedDocuments.length} documents.`,
          );
          return;
        }

        const builderPrompt = buildCoworkerDocumentBuilderMessage(
          uploadedDocuments.map((document) => document.filename),
        );

        if (!isMobile && builderConversationId === conversationId) {
          window.dispatchEvent(
            new CustomEvent(CHAT_EXTERNAL_SEND_EVENT, {
              detail: {
                conversationId,
                content: builderPrompt,
                attachments,
              },
            }),
          );
          toast.success(
            `Uploaded ${uploadedDocuments.length} document${uploadedDocuments.length === 1 ? "" : "s"} and sent them to the builder chat.`,
          );
          return;
        }

        await enqueueConversationMessage.mutateAsync({
          conversationId,
          content: builderPrompt,
          fileAttachments: attachments,
          replaceExisting: false,
        });

        toast.success(
          `Uploaded ${uploadedDocuments.length} document${uploadedDocuments.length === 1 ? "" : "s"} and queued a builder update.`,
        );
      } catch (error) {
        console.error("Failed to upload coworker documents:", error);
        toast.error(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to upload documents.",
        );
      } finally {
        setIsUploadingDocuments(false);
      }
    },
    [
      coworkerId,
      enqueueConversationMessage,
      ensureBuilderConversationId,
      builderConversationId,
      isMobile,
      uploadCoworkerDocument,
    ],
  );

  const handleDeleteDocument = useCallback(
    async (document: CoworkerDocumentRecord) => {
      setDeletingDocumentIds((current) =>
        current.includes(document.id) ? current : [...current, document.id],
      );

      try {
        await deleteCoworkerDocument.mutateAsync({ id: document.id });

        const conversationId = await ensureBuilderConversationId();
        if (!conversationId) {
          toast.success(`Removed ${document.filename}.`);
          return;
        }

        const builderPrompt = buildCoworkerDocumentRemovalBuilderMessage([document.filename]);

        if (!isMobile && builderConversationId === conversationId) {
          window.dispatchEvent(
            new CustomEvent(CHAT_EXTERNAL_SEND_EVENT, {
              detail: {
                conversationId,
                content: builderPrompt,
              },
            }),
          );
          toast.success(`Removed ${document.filename} and updated the builder chat.`);
          return;
        }

        await enqueueConversationMessage.mutateAsync({
          conversationId,
          content: builderPrompt,
          replaceExisting: false,
        });

        toast.success(`Removed ${document.filename} and queued a builder update.`);
      } catch (error) {
        console.error("Failed to delete coworker document:", error);
        toast.error(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to delete document.",
        );
      } finally {
        setDeletingDocumentIds((current) => current.filter((id) => id !== document.id));
      }
    },
    [
      builderConversationId,
      deleteCoworkerDocument,
      enqueueConversationMessage,
      ensureBuilderConversationId,
      isMobile,
    ],
  );

  const handleDownloadDocument = useCallback(
    async (document: CoworkerDocumentRecord) => {
      setDownloadingDocumentIds((current) =>
        current.includes(document.id) ? current : [...current, document.id],
      );

      try {
        const { url, filename } = await getCoworkerDocumentUrl.mutateAsync({ id: document.id });
        const link = window.document.createElement("a");
        link.href = url;
        link.download = filename;
        link.target = "_blank";
        window.document.body.appendChild(link);
        link.click();
        window.document.body.removeChild(link);
      } catch (error) {
        console.error("Failed to download coworker document:", error);
        toast.error(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to download document.",
        );
      } finally {
        setDownloadingDocumentIds((current) => current.filter((id) => id !== document.id));
      }
    },
    [getCoworkerDocumentUrl],
  );

  const handleStatusChange = useCallback((checked: boolean) => {
    setStatus(checked ? "on" : "off");
  }, []);

  const handleAutoApproveChange = useCallback((checked: boolean) => {
    if (checked) {
      setAutoApprove(true);
      return;
    }
    setShowDisableAutoApproveDialog(true);
  }, []);

  const handleNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  }, []);

  const handleDescriptionChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(event.target.value);
  }, []);

  const handleUsernameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(event.target.value);
  }, []);

  const handleModelSelectionChange = useCallback(
    (input: { model: string; authSource?: ProviderAuthSource | null }) => {
      setModel(input.model);
      setModelAuthSource(input.authSource ?? null);
    },
    [],
  );

  const handleScheduleTypeChange = useCallback((value: string) => {
    setScheduleType(value as "interval" | "daily" | "weekly" | "monthly");
  }, []);

  const handleIntervalHoursChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const hours = Math.max(1, parseInt(event.target.value) || 1);
    setIntervalMinutes(hours * 60);
  }, []);

  const handleScheduleTimeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setScheduleTime(event.target.value.slice(0, 5));
  }, []);

  const handleToggleWeekDay = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const dayIndex = parseInt(event.currentTarget.dataset.dayIndex || "", 10);
    if (Number.isNaN(dayIndex)) {
      return;
    }
    setScheduleDaysOfWeek((prev) =>
      prev.includes(dayIndex) ? prev.filter((d) => d !== dayIndex) : [...prev, dayIndex].toSorted(),
    );
  }, []);

  const handleScheduleDayOfMonthChange = useCallback((value: string) => {
    setScheduleDayOfMonth(parseInt(value, 10));
  }, []);

  const handlePromptChange = useCallback((value: string) => {
    setPrompt(value);
  }, []);

  const handleRestrictToolsChange = useCallback((checked: boolean) => {
    if (checked) {
      setToolAccessMode("all");
      return;
    }
    setToolAccessMode("selected");
  }, []);

  const handleSelectAllIntegrations = useCallback(() => {
    setAllowedIntegrations(allIntegrationTypes);
  }, [allIntegrationTypes]);

  const handleClearIntegrations = useCallback(() => {
    setAllowedIntegrations([]);
  }, []);

  const handleToggleIntegrationChecked = useCallback((type: IntegrationType) => {
    setAllowedIntegrations((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);
  const handleToggleSkillChecked = useCallback(
    (skillKey: string) => {
      const next = selectedSkillKeys.includes(skillKey)
        ? selectedSkillKeys.filter((key) => key !== skillKey)
        : [...selectedSkillKeys, skillKey];
      setAllowedSkillSlugs(next);
    },
    [selectedSkillKeys],
  );
  const handleToggleWorkspaceMcpServerChecked = useCallback((sourceId: string) => {
    setAllowedWorkspaceMcpServerIds((current) =>
      current.includes(sourceId)
        ? current.filter((value) => value !== sourceId)
        : [...current, sourceId],
    );
  }, []);
  const handleClearWorkspaceMcpServers = useCallback(() => {
    setAllowedWorkspaceMcpServerIds([]);
  }, []);
  const handleClearSkills = useCallback(() => {
    setAllowedSkillSlugs([]);
  }, []);

  const handleDisableAutoApprove = useCallback(() => {
    setAutoApprove(false);
    setShowDisableAutoApproveDialog(false);
  }, []);

  const handleCopyForwardingAddress = useCallback(
    async (value: string, field: "coworkerAlias" | "invokeHandle") => {
      try {
        await navigator.clipboard.writeText(value);
        setCopiedForwardingField(field);
        setTimeout(() => setCopiedForwardingField(null), 1500);
      } catch (error) {
        console.error("Failed to copy forwarding address:", error);
      }
    },
    [],
  );

  const handleCopyCoworkerAlias = useCallback(() => {
    if (!coworkerForwardingAddress) {
      return;
    }
    void handleCopyForwardingAddress(coworkerForwardingAddress, "coworkerAlias");
  }, [handleCopyForwardingAddress, coworkerForwardingAddress]);

  const handleCreateCoworkerAlias = useCallback(async () => {
    if (!coworkerId) {
      return;
    }

    try {
      await createForwardingAlias.mutateAsync(coworkerId);
      toast.success("Forwarding address created.");
    } catch (error) {
      console.error("Failed to create forwarding alias:", error);
      toast.error("Failed to create forwarding address.");
    }
  }, [createForwardingAlias, coworkerId]);

  const handleRotateCoworkerAlias = useCallback(async () => {
    if (!coworkerId) {
      return;
    }

    try {
      await rotateForwardingAlias.mutateAsync(coworkerId);
      toast.success("Forwarding address rotated.");
    } catch (error) {
      console.error("Failed to rotate forwarding alias:", error);
      toast.error("Failed to rotate forwarding address.");
    }
  }, [rotateForwardingAlias, coworkerId]);

  const handleDisableCoworkerAlias = useCallback(async () => {
    if (!coworkerId) {
      return;
    }

    try {
      await disableForwardingAlias.mutateAsync(coworkerId);
      toast.success("Forwarding address disabled.");
    } catch (error) {
      console.error("Failed to disable forwarding alias:", error);
      toast.error("Failed to disable forwarding address.");
    }
  }, [disableForwardingAlias, coworkerId]);

  useEffect(() => {
    if (!hasInitializedEditorRef.current) {
      return;
    }
    if (!coworkerId) {
      return;
    }
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      void persistCoworker();
    }, 1000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [
    allowedIntegrations,
    allowedWorkspaceMcpServerIds,
    autoApprove,
    buildSchedule,
    description,
    model,
    name,
    persistCoworker,
    prompt,
    requiresUserInput,
    scheduleDayOfMonth,
    scheduleDaysOfWeek,
    scheduleTime,
    scheduleType,
    status,
    toolAccessMode,
    triggerType,
    username,
    userInputPrompt,
    allowedSkillSlugs,
    coworkerId,
  ]);

  const handleRun = useCallback(
    async (options?: {
      remoteIntegrationSource?: {
        targetEnv: RemoteIntegrationTargetEnv;
        remoteUserId: string;
      };
    }) => {
      if (!coworkerId || isStartingRun) {
        return null;
      }

      setIsStartingRun(true);
      try {
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
        }
        const saveSucceeded = await persistCoworker({ force: true });
        if (!saveSucceeded) {
          toast.error("Failed to save coworker before test run.");
          return null;
        }

        const result = await triggerCoworker.mutateAsync({
          id: coworkerId,
          payload: {},
          remoteIntegrationSource: options?.remoteIntegrationSource,
        });
        toast.success(result.generationId ? "Run started." : "Needs your input.");
        void refetchRuns();
        return result;
      } catch (error) {
        console.error("Failed to run coworker:", error);
        toast.error(normalizeGenerationError(error, "start_rpc").message);
        return null;
      } finally {
        setIsStartingRun(false);
      }
    },
    [isStartingRun, persistCoworker, refetchRuns, triggerCoworker, coworkerId],
  );

  const handleSaveInstructions = useCallback(async () => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    const saveSucceeded = await persistCoworker({ force: true });
    if (saveSucceeded) {
      toast.success("Instructions saved.");
    }
  }, [persistCoworker]);

  const hasAgentInstructions = prompt.trim().length > 0;
  const coworkerDisplayName = coworker?.name?.trim().length ? coworker.name : "New Coworker";

  useEffect(() => {
    const previousHasAgentInstructions = previousHasAgentInstructionsRef.current;

    if (!hasAgentInstructions) {
      setIsInstructionPanelCollapsed(true);
      previousHasAgentInstructionsRef.current = false;
      return;
    }

    if (!previousHasAgentInstructions) {
      setIsInstructionPanelCollapsed(false);
    }

    previousHasAgentInstructionsRef.current = true;
  }, [hasAgentInstructions]);

  const buildCoworkerEditorHref = useCallback(
    (tab?: Exclude<CoworkerTab, "runs"> | null) => {
      if (!coworkerId) {
        return embedded ? "/agents" : "/agents";
      }

      if (embedded) {
        const params = new URLSearchParams({ agent: coworkerId });
        if (tab && tab !== "instruction") {
          params.set("tab", tab);
        }
        return `/agents?${params.toString()}`;
      }

      if (!tab || tab === "instruction") {
        return `/agents/edit/${coworkerRouteSlug}`;
      }

      return `/agents/edit/${coworkerRouteSlug}?tab=${tab}`;
    },
    [coworkerId, coworkerRouteSlug, embedded],
  );

  const buildCoworkerPanelHref = useCallback(
    (options?: { runId?: string | null }) => {
      if (!coworkerId) {
        return embedded ? "/agents" : "/agents";
      }

      if (embedded) {
        const params = new URLSearchParams({ agent: coworkerId, tab: "runs" });
        if (options?.runId) {
          params.set("run", options.runId);
        }
        return `/agents?${params.toString()}`;
      }

      if (options?.runId) {
        return `/agents/edit/${coworkerRouteSlug}/runs/${options.runId}`;
      }

      return `/agents/edit/${coworkerRouteSlug}/runs`;
    },
    [coworkerId, coworkerRouteSlug, embedded],
  );

  const handleRunClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();

      const result = await handleRun();
      if (!result?.runId) {
        return;
      }

      setActiveTab("runs");
      setSelectedRunId(result.runId);
      if (embedded) {
        return;
      }
      if (isMobile) {
        router.replace(buildCoworkerPanelHref({ runId: result.runId }));
        return;
      }

      window.history.replaceState(
        window.history.state,
        "",
        buildCoworkerPanelHref({ runId: result.runId }),
      );
    },
    [buildCoworkerPanelHref, embedded, handleRun, isMobile, router],
  );

  const handleRemoteRunClick = useCallback(async () => {
    if (!remoteTargetEnv || !selectedRemoteUser) {
      toast.error("Select a remote environment and a remote user first.");
      return;
    }

    const result = await handleRun({
      remoteIntegrationSource: {
        targetEnv: remoteTargetEnv,
        remoteUserId: selectedRemoteUser.id,
      },
    });
    if (!result?.runId) {
      return;
    }

    setActiveTab("runs");
    setSelectedRunId(result.runId);
    if (embedded) {
      return;
    }
    if (isMobile) {
      router.replace(buildCoworkerPanelHref({ runId: result.runId }));
      return;
    }

    window.history.replaceState(
      window.history.state,
      "",
      buildCoworkerPanelHref({ runId: result.runId }),
    );
  }, [
    buildCoworkerPanelHref,
    embedded,
    handleRun,
    isMobile,
    remoteTargetEnv,
    router,
    selectedRemoteUser,
  ]);

  const isRunDisabled = !hasAgentInstructions || triggerCoworker.isPending || isStartingRun;
  const isRunning = triggerCoworker.isPending || isStartingRun;

  const handleTabChange = useCallback(
    (key: string) => {
      const nextTab = key as CoworkerTab;
      setActiveTab(nextTab);
      setSelectedRunId(null);

      if (!coworkerId) {
        return;
      }

      if (embedded) {
        return;
      }

      if (nextTab === "runs") {
        if (isMobile) {
          router.replace(buildCoworkerPanelHref());
          return;
        }

        window.history.replaceState(window.history.state, "", buildCoworkerPanelHref());
        return;
      }

      if (isMobile) {
        if (isRunsRoute || routeBaseTab !== nextTab) {
          router.replace(buildCoworkerEditorHref(nextTab));
        }
        return;
      }

      if (isRunsRoute || routeBaseTab !== nextTab) {
        window.history.replaceState(window.history.state, "", buildCoworkerEditorHref(nextTab));
      }
    },
    [
      buildCoworkerEditorHref,
      buildCoworkerPanelHref,
      coworkerId,
      embedded,
      isMobile,
      isRunsRoute,
      routeBaseTab,
      router,
    ],
  );
  const handleSelectRun = useCallback(
    (runId: string) => {
      setActiveTab("runs");
      setSelectedRunId(runId);
      if (embedded) {
        return;
      }
      if (isMobile) {
        router.push(buildCoworkerPanelHref({ runId }));
        return;
      }

      window.history.pushState(window.history.state, "", buildCoworkerPanelHref({ runId }));
    },
    [buildCoworkerPanelHref, embedded, isMobile, router],
  );
  const handleBackToRuns = useCallback(() => {
    setActiveTab("runs");
    setSelectedRunId(null);
    if (embedded) {
      return;
    }
    if (isMobile) {
      router.replace(buildCoworkerPanelHref());
      return;
    }

    window.history.replaceState(window.history.state, "", buildCoworkerPanelHref());
  }, [buildCoworkerPanelHref, embedded, isMobile, router]);
  const handleOpenDeleteDialog = useCallback(() => {
    setShowDeleteDialog(true);
  }, []);
  const handleRemoteTargetEnvChange = useCallback((value: string) => {
    setRemoteTargetEnv(value as RemoteIntegrationTargetEnv);
  }, []);
  const handleRemoteUserQueryChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setRemoteUserQuery(event.target.value);
  }, []);
  const chatPanel = useMemo(
    () => (
      <CoworkerChatPanel
        conversationId={builderConversationId}
        coworkerId={coworkerId ?? ""}
        onCoworkerSync={handleCoworkerSyncFromChat}
        skillSelectionScopeKey={skillSelectionScopeKey}
        isLoading={isBuilderConversationLoading}
        errorMessage={builderConversationError}
        onRetry={handleRetryBuilderConversation}
      />
    ),
    [
      builderConversationError,
      builderConversationId,
      coworkerId,
      handleCoworkerSyncFromChat,
      handleRetryBuilderConversation,
      isBuilderConversationLoading,
      skillSelectionScopeKey,
    ],
  );

  const adminPanel = useMemo(
    () => (
      <RemoteIntegrationAdminPanel
        availableTargets={availableRemoteIntegrationTargets}
        selectedTargetEnv={remoteTargetEnv}
        remoteUserQuery={remoteUserQuery}
        remoteUserOptions={remoteUserOptions}
        selectedRemoteUser={selectedRemoteUser}
        isSearching={isRemoteUserSearchFetching}
        isRunDisabled={isRunDisabled}
        isRunning={isRunning}
        onTargetEnvChange={handleRemoteTargetEnvChange}
        onRemoteUserQueryChange={handleRemoteUserQueryChange}
        onSelectRemoteUser={setSelectedRemoteUser}
        onRun={handleRemoteRunClick}
      />
    ),
    [
      availableRemoteIntegrationTargets,
      handleRemoteRunClick,
      handleRemoteTargetEnvChange,
      handleRemoteUserQueryChange,
      isRemoteUserSearchFetching,
      isRunDisabled,
      isRunning,
      remoteTargetEnv,
      remoteUserOptions,
      remoteUserQuery,
      selectedRemoteUser,
    ],
  );

  const settingsPanel = useMemo(
    () => (
      <CoworkerSettingsPanel
        coworkerId={coworkerId}
        coworkerRouteSlug={coworkerRouteSlug}
        name={name}
        description={description}
        username={username}
        isSaving={isSaving}
        status={status}
        autoApprove={autoApprove}
        requiresUserInput={requiresUserInput}
        userInputPrompt={userInputPrompt}
        prompt={prompt}
        model={model}
        modelAuthSource={modelAuthSource}
        providerAvailability={providerAvailability}
        availableSkills={availableSkills}
        selectedSkillKeys={selectedSkillKeys}
        executorSourceEntries={executorSourceEntries}
        selectedWorkspaceMcpServerIds={allowedWorkspaceMcpServerIds}
        isSkillsLoading={isPlatformSkillsLoading || isAccessibleSkillsLoading}
        restrictTools={restrictTools}
        allowedIntegrations={allowedIntegrations}
        allIntegrationTypes={allIntegrationTypes}
        integrationEntries={integrationEntries}
        triggerType={triggerType}
        triggers={triggers}
        scheduleType={scheduleType}
        intervalMinutes={intervalMinutes}
        scheduleTime={scheduleTime}
        scheduleDaysOfWeek={scheduleDaysOfWeek}
        scheduleDayOfMonth={scheduleDayOfMonth}
        localTimezone={scheduleTimezone}
        hasActiveForwardingAlias={hasActiveForwardingAlias}
        coworkerForwardingAddress={coworkerForwardingAddress}
        coworkerForwardingAlias={coworkerForwardingAlias}
        isEmailTriggerPersisted={isEmailTriggerPersisted}
        copiedForwardingField={copiedForwardingField}
        documents={coworker?.documents ?? EMPTY_COWORKER_DOCUMENTS}
        runs={runs}
        activeTab={activeTab}
        selectedRunId={selectedRunId}
        isRunDisabled={isRunDisabled}
        isRunning={isRunning}
        isUploadingDocuments={isUploadingDocuments}
        deletingDocumentIds={deletingDocumentIds}
        downloadingDocumentIds={downloadingDocumentIds}
        createForwardingAlias={createForwardingAlias}
        disableForwardingAlias={disableForwardingAlias}
        rotateForwardingAlias={rotateForwardingAlias}
        onUploadDocuments={handleUploadDocuments}
        onDownloadDocument={handleDownloadDocument}
        onDeleteDocument={handleDeleteDocument}
        onTabChange={handleTabChange}
        onRun={handleRunClick}
        onSelectRun={handleSelectRun}
        onBackToRuns={handleBackToRuns}
        onNameChange={handleNameChange}
        onDescriptionChange={handleDescriptionChange}
        onUsernameChange={handleUsernameChange}
        onStatusChange={handleStatusChange}
        onAutoApproveChange={handleAutoApproveChange}
        onRequiresUserInputChange={setRequiresUserInput}
        onUserInputPromptChange={setUserInputPrompt}
        onPromptChange={handlePromptChange}
        onSaveInstructions={handleSaveInstructions}
        onModelChange={handleModelSelectionChange}
        onClearSkills={handleClearSkills}
        onToggleSkillChecked={handleToggleSkillChecked}
        onClearWorkspaceMcpServers={handleClearWorkspaceMcpServers}
        onToggleWorkspaceMcpServerChecked={handleToggleWorkspaceMcpServerChecked}
        onRestrictToolsChange={handleRestrictToolsChange}
        onSelectAllIntegrations={handleSelectAllIntegrations}
        onClearIntegrations={handleClearIntegrations}
        onToggleIntegrationChecked={handleToggleIntegrationChecked}
        onTriggerTypeChange={setTriggerType}
        onScheduleTypeChange={handleScheduleTypeChange}
        onIntervalHoursChange={handleIntervalHoursChange}
        onScheduleTimeChange={handleScheduleTimeChange}
        onToggleWeekDay={handleToggleWeekDay}
        onScheduleDayOfMonthChange={handleScheduleDayOfMonthChange}
        onCopyCoworkerAlias={handleCopyCoworkerAlias}
        onRotateCoworkerAlias={handleRotateCoworkerAlias}
        onDisableCoworkerAlias={handleDisableCoworkerAlias}
        onCreateCoworkerAlias={handleCreateCoworkerAlias}
        onClose={handleClose}
        showDeleteDialog={showDeleteDialog}
        onShowDeleteDialogChange={setShowDeleteDialog}
        onDelete={handleDelete}
        isDeleting={deleteCoworker.isPending}
        showAdminTab={isAdmin}
        adminContent={adminPanel}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dep list tracks all panel props
    [
      name,
      description,
      username,
      coworkerId,
      isSaving,
      status,
      autoApprove,
      requiresUserInput,
      userInputPrompt,
      prompt,
      model,
      availableSkills,
      selectedSkillKeys,
      executorSourceEntries,
      allowedWorkspaceMcpServerIds,
      isPlatformSkillsLoading,
      isAccessibleSkillsLoading,
      restrictTools,
      allowedIntegrations,
      allIntegrationTypes,
      integrationEntries,
      triggerType,
      triggers,
      scheduleType,
      intervalMinutes,
      scheduleTime,
      scheduleDaysOfWeek,
      scheduleDayOfMonth,
      scheduleTimezone,
      hasActiveForwardingAlias,
      coworkerForwardingAddress,
      coworkerForwardingAlias,
      isEmailTriggerPersisted,
      copiedForwardingField,
      coworker?.documents,
      runs,
      activeTab,
      selectedRunId,
      isRunDisabled,
      isRunning,
      isUploadingDocuments,
      deletingDocumentIds,
      createForwardingAlias,
      disableForwardingAlias,
      rotateForwardingAlias,
      handleUploadDocuments,
      handleDeleteDocument,
      handleTabChange,
      handleRunClick,
      handleSelectRun,
      handleBackToRuns,
      handleNameChange,
      handleDescriptionChange,
      handleUsernameChange,
      handleStatusChange,
      handleAutoApproveChange,
      setRequiresUserInput,
      setUserInputPrompt,
      handlePromptChange,
      handleSaveInstructions,
      setModel,
      handleClearSkills,
      handleToggleSkillChecked,
      handleClearWorkspaceMcpServers,
      handleToggleWorkspaceMcpServerChecked,
      handleRestrictToolsChange,
      handleSelectAllIntegrations,
      handleClearIntegrations,
      handleToggleIntegrationChecked,
      setTriggerType,
      handleScheduleTypeChange,
      handleIntervalHoursChange,
      handleScheduleTimeChange,
      handleToggleWeekDay,
      handleScheduleDayOfMonthChange,
      handleCopyCoworkerAlias,
      handleRotateCoworkerAlias,
      handleDisableCoworkerAlias,
      handleCreateCoworkerAlias,
      showDeleteDialog,
      setShowDeleteDialog,
      handleDelete,
      deleteCoworker.isPending,
      isAdmin,
      adminPanel,
      coworkerRouteSlug,
    ],
  );

  if (
    isLoading ||
    (!coworkerId && coworkerList.isLoading) ||
    (shouldLoadCoworkerImpersonationTarget && isCoworkerImpersonationTargetLoading) ||
    (shouldLoadRunImpersonationTarget && isRunImpersonationTargetLoading)
  ) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!coworker) {
    const impersonationTarget = routeRunId ? runImpersonationTarget : coworkerImpersonationTarget;

    if (impersonationTarget) {
      return (
        <ImpersonationRequiredPage target={impersonationTarget} redirectPath={currentRoutePath} />
      );
    }

    return (
      <div className="text-muted-foreground flex h-full min-h-0 w-full flex-1 items-center justify-center p-6 text-sm">
        {routeRunId ? "Run not found." : "Coworker not found."}
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
        {/* Mobile icon tab bar */}
        <div className="border-border/40 flex items-center justify-between gap-1 border-b px-2 py-1.5">
          <AnimatedTabs activeKey={activeTab} onTabChange={handleTabChange} className="gap-0">
            <AnimatedTab value="chat" className="px-2.5">
              <MessageSquare className="h-4 w-4" aria-label="Chat" />
            </AnimatedTab>
            <AnimatedTab value="instruction" className="px-2.5">
              <Pencil className="h-4 w-4" aria-label="Instruction" />
            </AnimatedTab>
            <AnimatedTab value="runs" className="px-2.5">
              <Play className="h-4 w-4" aria-label="Runs" />
            </AnimatedTab>
            <AnimatedTab value="docs" className="px-2.5">
              <FileText className="h-4 w-4" aria-label="Docs" />
            </AnimatedTab>
            <AnimatedTab value="toolbox" className="px-2.5">
              <Wrench className="h-4 w-4" aria-label="Toolbox" />
            </AnimatedTab>
            {isAdmin ? (
              <AnimatedTab value="admin" className="px-2.5">
                <Shield className="h-4 w-4" aria-label="Admin" />
              </AnimatedTab>
            ) : null}
          </AnimatedTabs>
          <div className="flex shrink-0 items-center gap-1.5">
            <Switch checked={status === "on"} onCheckedChange={handleStatusChange} />
            <button
              type="button"
              onClick={handleRunClick}
              disabled={isRunDisabled}
              className="text-muted-foreground hover:text-foreground hover:bg-muted flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40"
              aria-label="Run now"
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CirclePlay className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={handleOpenDeleteDialog}
              className="text-muted-foreground hover:text-destructive hover:bg-muted flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              aria-label="Delete coworker"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* Mobile content area */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab === "chat" ? (
            chatPanel
          ) : (
            <CoworkerSettingsPanel
              coworkerId={coworkerId}
              coworkerRouteSlug={coworkerRouteSlug}
              name={name}
              description={description}
              username={username}
              isSaving={isSaving}
              status={status}
              autoApprove={autoApprove}
              requiresUserInput={requiresUserInput}
              userInputPrompt={userInputPrompt}
              prompt={prompt}
              model={model}
              modelAuthSource={modelAuthSource}
              providerAvailability={providerAvailability}
              availableSkills={availableSkills}
              selectedSkillKeys={selectedSkillKeys}
              executorSourceEntries={executorSourceEntries}
              selectedWorkspaceMcpServerIds={allowedWorkspaceMcpServerIds}
              isSkillsLoading={isPlatformSkillsLoading || isAccessibleSkillsLoading}
              restrictTools={restrictTools}
              allowedIntegrations={allowedIntegrations}
              allIntegrationTypes={allIntegrationTypes}
              integrationEntries={integrationEntries}
              triggerType={triggerType}
              triggers={triggers}
              scheduleType={scheduleType}
              intervalMinutes={intervalMinutes}
              scheduleTime={scheduleTime}
              scheduleDaysOfWeek={scheduleDaysOfWeek}
              scheduleDayOfMonth={scheduleDayOfMonth}
              localTimezone={scheduleTimezone}
              hasActiveForwardingAlias={hasActiveForwardingAlias}
              coworkerForwardingAddress={coworkerForwardingAddress}
              coworkerForwardingAlias={coworkerForwardingAlias}
              isEmailTriggerPersisted={isEmailTriggerPersisted}
              copiedForwardingField={copiedForwardingField}
              documents={coworker.documents ?? EMPTY_COWORKER_DOCUMENTS}
              runs={runs}
              activeTab={activeTab}
              selectedRunId={selectedRunId}
              isRunDisabled={isRunDisabled}
              isRunning={isRunning}
              isUploadingDocuments={isUploadingDocuments}
              deletingDocumentIds={deletingDocumentIds}
              downloadingDocumentIds={downloadingDocumentIds}
              createForwardingAlias={createForwardingAlias}
              disableForwardingAlias={disableForwardingAlias}
              rotateForwardingAlias={rotateForwardingAlias}
              onUploadDocuments={handleUploadDocuments}
              onDownloadDocument={handleDownloadDocument}
              onDeleteDocument={handleDeleteDocument}
              onTabChange={handleTabChange}
              onRun={handleRunClick}
              onSelectRun={handleSelectRun}
              onBackToRuns={handleBackToRuns}
              onNameChange={handleNameChange}
              onDescriptionChange={handleDescriptionChange}
              onUsernameChange={handleUsernameChange}
              onStatusChange={handleStatusChange}
              onAutoApproveChange={handleAutoApproveChange}
              onRequiresUserInputChange={setRequiresUserInput}
              onUserInputPromptChange={setUserInputPrompt}
              onPromptChange={handlePromptChange}
              onSaveInstructions={handleSaveInstructions}
              onModelChange={handleModelSelectionChange}
              onClearSkills={handleClearSkills}
              onToggleSkillChecked={handleToggleSkillChecked}
              onClearWorkspaceMcpServers={handleClearWorkspaceMcpServers}
              onToggleWorkspaceMcpServerChecked={handleToggleWorkspaceMcpServerChecked}
              onRestrictToolsChange={handleRestrictToolsChange}
              onSelectAllIntegrations={handleSelectAllIntegrations}
              onClearIntegrations={handleClearIntegrations}
              onToggleIntegrationChecked={handleToggleIntegrationChecked}
              onTriggerTypeChange={setTriggerType}
              onScheduleTypeChange={handleScheduleTypeChange}
              onIntervalHoursChange={handleIntervalHoursChange}
              onScheduleTimeChange={handleScheduleTimeChange}
              onToggleWeekDay={handleToggleWeekDay}
              onScheduleDayOfMonthChange={handleScheduleDayOfMonthChange}
              onCopyCoworkerAlias={handleCopyCoworkerAlias}
              onRotateCoworkerAlias={handleRotateCoworkerAlias}
              onDisableCoworkerAlias={handleDisableCoworkerAlias}
              onCreateCoworkerAlias={handleCreateCoworkerAlias}
              onClose={handleClose}
              showDeleteDialog={showDeleteDialog}
              onShowDeleteDialogChange={setShowDeleteDialog}
              onDelete={handleDelete}
              isDeleting={deleteCoworker.isPending}
              showAdminTab={isAdmin}
              adminContent={adminPanel}
              hideHeader
            />
          )}
        </div>
        <AlertDialog
          open={showDisableAutoApproveDialog}
          onOpenChange={setShowDisableAutoApproveDialog}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Turn off auto-approve?</AlertDialogTitle>
              <AlertDialogDescription>
                If you turn this off, coworker runs can stop and wait for manual approval on write
                actions. The coworker might stay stuck until someone approves in the UI.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep on</AlertDialogCancel>
              <AlertDialogAction onClick={handleDisableAutoApprove}>Turn off</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete coworker?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this coworker and all of its run history. This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleteCoworker.isPending}
                className="bg-destructive hover:bg-destructive/90 text-white"
              >
                {deleteCoworker.isPending ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : null}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <DualPanelWorkspace
        storageKey="coworker-editor-panels-v2"
        defaultRightWidth={50}
        minRightWidth={50}
        collapsible
        collapsedSidebar
        showExpandedCollapseButton={false}
        showTitles={false}
        rightCollapsed={isInstructionPanelCollapsed}
        onRightCollapsedChange={setIsInstructionPanelCollapsed}
        leftTitle="Chat"
        rightTitle={coworkerDisplayName}
        leftPanelClassName="border-0 rounded-none"
        separatorClassName="bg-muted/30"
        rightPanelClassName="border-0 rounded-none bg-muted/30 md:min-w-[34rem]"
        left={chatPanel}
        right={settingsPanel}
        hideMobileToggle
      />
      <AlertDialog
        open={showDisableAutoApproveDialog}
        onOpenChange={setShowDisableAutoApproveDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off auto-approve?</AlertDialogTitle>
            <AlertDialogDescription>
              If you turn this off, coworker runs can stop and wait for manual approval on write
              actions. The coworker might stay stuck until someone approves in the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep on</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisableAutoApprove}>Turn off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InlineRunViewer({
  runId,
  coworkerId,
  coworkerRouteSlug,
  onBack,
}: {
  runId: string;
  coworkerId?: string;
  coworkerRouteSlug?: string;
  onBack: () => void;
}) {
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
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground hover:bg-muted -ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Runs
          </button>
        </div>
        <div className="text-muted-foreground px-4 text-xs">Run not found.</div>
      </div>
    );
  }

  const remoteRunSource = extractRemoteRunSourceDetails(run);

  if (!run.conversationId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 px-4 py-2">
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground hover:bg-muted -ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Runs
          </button>
        </div>
        <RemoteRunSourceBanner source={remoteRunSource} />
        <div className="px-4 py-2">
          <p className="text-muted-foreground text-xs">
            This run does not have a linked conversation.
          </p>
          <RunDebugDetails debugInfo={run.debugInfo} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border/30 flex items-center gap-2 border-b px-4 py-2">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground hover:bg-muted -ml-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Runs
        </button>
        <Circle
          className={cn(
            "ml-1 h-1.5 w-1.5 shrink-0 fill-current",
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
        <span className="text-foreground/70 text-xs">{getCoworkerRunStatusLabel(run.status)}</span>
        <span className="text-muted-foreground ml-auto text-xs">
          {formatRelativeTime(run.startedAt)}
        </span>
      </div>
      <RemoteRunSourceBanner source={remoteRunSource} />
      {run.status === "error" || run.status === "cancelled" ? (
        <div className="border-border/20 border-b px-4 py-2">
          <p className="text-muted-foreground text-xs">
            {run.status === "cancelled"
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
        <ChatArea conversationId={run.conversationId} />
      </div>
    </div>
  );
}

function RemoteIntegrationAdminPanel({
  availableTargets,
  selectedTargetEnv,
  remoteUserQuery,
  remoteUserOptions,
  selectedRemoteUser,
  isSearching,
  isRunDisabled,
  isRunning,
  onTargetEnvChange,
  onRemoteUserQueryChange,
  onSelectRemoteUser,
  onRun,
}: {
  availableTargets: RemoteIntegrationTargetEnv[];
  selectedTargetEnv: RemoteIntegrationTargetEnv | null;
  remoteUserQuery: string;
  remoteUserOptions: RemoteIntegrationUserOption[];
  selectedRemoteUser: RemoteIntegrationUserOption | null;
  isSearching: boolean;
  isRunDisabled: boolean;
  isRunning: boolean;
  onTargetEnvChange: (value: string) => void;
  onRemoteUserQueryChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectRemoteUser: (user: RemoteIntegrationUserOption) => void;
  onRun: () => void | Promise<void>;
}) {
  const handleRemoteUserButtonClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const remoteUserId = event.currentTarget.dataset.remoteUserId;
      if (!remoteUserId) {
        return;
      }

      const remoteUser = remoteUserOptions.find((entry) => entry.id === remoteUserId);
      if (!remoteUser) {
        return;
      }

      onSelectRemoteUser(remoteUser);
    },
    [onSelectRemoteUser, remoteUserOptions],
  );
  const handleRunClick = useCallback(() => {
    void onRun();
  }, [onRun]);

  return (
    <div className="space-y-4">
      <div className="border-border/40 rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Shield className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Run with remote integrations</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              This admin-only test path keeps the coworker local but borrows built-in OAuth
              integrations from a remote user in staging or prod for a single manual run.
            </p>
          </div>
        </div>
      </div>

      {availableTargets.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-xs">
          No remote integration targets are configured for this environment.
        </div>
      ) : null}

      {availableTargets.length > 0 ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Source environment
            </label>
            <Select value={selectedTargetEnv ?? undefined} onValueChange={onTargetEnvChange}>
              <SelectTrigger className="h-9 w-full bg-transparent text-sm">
                <SelectValue placeholder="Select a remote environment" />
              </SelectTrigger>
              <SelectContent>
                {availableTargets.map((target) => (
                  <SelectItem key={target} value={target}>
                    {target === "prod" ? "Production" : "Staging"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTargetEnv === "prod" ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              Production is selected. This run can mutate real client data through the remote
              user&apos;s integrations.
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Remote user email
            </label>
            <Input
              value={remoteUserQuery}
              onChange={onRemoteUserQueryChange}
              placeholder="Search by email"
              className="bg-transparent text-sm"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Matching users
              </span>
              {isSearching ? (
                <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
              ) : null}
            </div>

            {remoteUserOptions.length === 0 ? (
              <div className="text-muted-foreground rounded-xl border border-dashed px-4 py-5 text-xs">
                {isSearching
                  ? "Searching remote users…"
                  : "No remote users found with enabled built-in integrations."}
              </div>
            ) : (
              <div className="space-y-2">
                {remoteUserOptions.map((remoteUser) => {
                  const isSelected = selectedRemoteUser?.id === remoteUser.id;
                  return (
                    <button
                      key={remoteUser.id}
                      type="button"
                      data-remote-user-id={remoteUser.id}
                      onClick={handleRemoteUserButtonClick}
                      className={cn(
                        "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                        isSelected
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/40 hover:bg-muted/30",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {remoteUser.name?.trim() || remoteUser.email}
                          </p>
                          <p className="text-muted-foreground truncate text-xs">
                            {remoteUser.email}
                          </p>
                        </div>
                        {isSelected ? (
                          <span className="text-primary text-[10px] font-semibold tracking-[0.14em] uppercase">
                            Selected
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {remoteUser.enabledIntegrationTypes.map((type) => (
                          <span
                            key={`${remoteUser.id}-${type}`}
                            className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium"
                          >
                            {INTEGRATION_DISPLAY_NAMES[type] ?? type}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedRemoteUser ? (
            <div className="border-border/40 bg-muted/20 rounded-xl border px-4 py-3">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Selected remote user
                </p>
                <p className="text-sm font-medium">
                  {selectedRemoteUser.name?.trim() || selectedRemoteUser.email}
                </p>
                <p className="text-muted-foreground text-xs">{selectedRemoteUser.email}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selectedRemoteUser.enabledIntegrationTypes.map((type) => (
                  <span
                    key={`selected-${type}`}
                    className="bg-background text-muted-foreground rounded-full border px-2 py-0.5 text-[10px] font-medium"
                  >
                    {INTEGRATION_DISPLAY_NAMES[type] ?? type}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-4 text-xs font-medium"
              onClick={handleRunClick}
              disabled={isRunDisabled || !selectedTargetEnv || !selectedRemoteUser}
            >
              {isRunning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Run with remote integrations
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type CoworkerSettingsPanelProps = {
  coworkerId?: string;
  coworkerRouteSlug?: string;
  name: string;
  description: string;
  username: string;
  isSaving: boolean;
  status: "on" | "off";
  autoApprove: boolean;
  requiresUserInput: boolean;
  userInputPrompt: string;
  prompt: string;
  model: string;
  modelAuthSource: ProviderAuthSource | null;
  providerAvailability: ProviderAuthAvailabilityByProvider;
  availableSkills: { key: string; title: string; source: string }[];
  selectedSkillKeys: string[];
  executorSourceEntries: {
    id: string;
    title: string;
    namespace: string;
    kind: string;
    connected: boolean;
  }[];
  selectedWorkspaceMcpServerIds: string[];
  isSkillsLoading: boolean;
  restrictTools: boolean;
  allowedIntegrations: IntegrationType[];
  allIntegrationTypes: IntegrationType[];
  integrationEntries: { key: IntegrationType; name: string; logo: string }[];
  triggerType: string;
  triggers: readonly { value: string; label: string }[];
  scheduleType: "interval" | "daily" | "weekly" | "monthly";
  intervalMinutes: number;
  scheduleTime: string;
  scheduleDaysOfWeek: number[];
  scheduleDayOfMonth: number;
  localTimezone: string;
  hasActiveForwardingAlias: boolean;
  coworkerForwardingAddress: string | null;
  coworkerForwardingAlias:
    | {
        receivingDomain: string | null;
        activeAlias: unknown | null;
        forwardingAddress: string | null;
      }
    | undefined;
  isEmailTriggerPersisted: boolean;
  copiedForwardingField: "coworkerAlias" | "invokeHandle" | null;
  documents: CoworkerDocumentRecord[];
  runs:
    | Array<{
        id: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
        errorMessage: string | null;
      }>
    | undefined;
  activeTab: CoworkerTab;
  selectedRunId: string | null;
  isRunDisabled: boolean;
  isRunning: boolean;
  isUploadingDocuments: boolean;
  deletingDocumentIds: string[];
  downloadingDocumentIds: string[];
  createForwardingAlias: { isPending: boolean };
  disableForwardingAlias: { isPending: boolean };
  rotateForwardingAlias: { isPending: boolean };
  onUploadDocuments: (files: FileList | File[]) => void | Promise<void>;
  onDownloadDocument: (document: CoworkerDocumentRecord) => void | Promise<void>;
  onDeleteDocument: (document: CoworkerDocumentRecord) => void | Promise<void>;
  onTabChange: (tab: CoworkerTab) => void;
  onRun: (e: React.MouseEvent) => void;
  onSelectRun: (runId: string) => void;
  onBackToRuns: () => void;
  onNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDescriptionChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onUsernameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onStatusChange: (checked: boolean) => void;
  onAutoApproveChange: (checked: boolean) => void;
  onRequiresUserInputChange: (checked: boolean) => void;
  onUserInputPromptChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSaveInstructions: () => void | Promise<void>;
  onModelChange: (input: { model: string; authSource?: ProviderAuthSource | null }) => void;
  onClearSkills: () => void;
  onToggleSkillChecked: (skillKey: string) => void;
  onClearWorkspaceMcpServers: () => void;
  onToggleWorkspaceMcpServerChecked: (sourceId: string) => void;
  onRestrictToolsChange: (checked: boolean) => void;
  onSelectAllIntegrations: () => void;
  onClearIntegrations: () => void;
  onToggleIntegrationChecked: (type: IntegrationType) => void;
  onTriggerTypeChange: (value: string) => void;
  onScheduleTypeChange: (value: string) => void;
  onIntervalHoursChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onScheduleTimeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleWeekDay: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onScheduleDayOfMonthChange: (value: string) => void;
  onCopyCoworkerAlias: () => void;
  onRotateCoworkerAlias: () => void;
  onDisableCoworkerAlias: () => void;
  onCreateCoworkerAlias: () => void;
  onClose: () => void;
  showCloseButton?: boolean;
  showDeleteDialog: boolean;
  onShowDeleteDialogChange: (open: boolean) => void;
  onDelete: () => void;
  isDeleting: boolean;
  hideHeader?: boolean;
  showAdminTab?: boolean;
  adminContent?: React.ReactNode;
};

function CoworkerSettingsPanel({
  coworkerId,
  coworkerRouteSlug,
  name,
  description,
  username,
  isSaving,
  status,
  autoApprove,
  requiresUserInput,
  userInputPrompt,
  prompt,
  model,
  modelAuthSource,
  providerAvailability,
  availableSkills,
  selectedSkillKeys,
  executorSourceEntries,
  selectedWorkspaceMcpServerIds,
  isSkillsLoading,
  restrictTools,
  allowedIntegrations,
  allIntegrationTypes,
  integrationEntries,
  triggerType,
  triggers,
  scheduleType,
  intervalMinutes,
  scheduleTime,
  scheduleDaysOfWeek,
  scheduleDayOfMonth,
  localTimezone,
  hasActiveForwardingAlias,
  coworkerForwardingAddress,
  coworkerForwardingAlias,
  isEmailTriggerPersisted,
  copiedForwardingField,
  documents,
  runs,
  activeTab,
  selectedRunId,
  isRunDisabled,
  isRunning,
  isUploadingDocuments,
  deletingDocumentIds,
  downloadingDocumentIds,
  createForwardingAlias,
  disableForwardingAlias,
  rotateForwardingAlias,
  onUploadDocuments,
  onDownloadDocument,
  onDeleteDocument,
  onTabChange,
  onRun,
  onSelectRun,
  onBackToRuns,
  onNameChange,
  onDescriptionChange,
  onUsernameChange,
  onStatusChange,
  onAutoApproveChange,
  onRequiresUserInputChange,
  onUserInputPromptChange,
  onPromptChange,
  onSaveInstructions,
  onModelChange,
  onClearSkills,
  onToggleSkillChecked,
  onClearWorkspaceMcpServers,
  onToggleWorkspaceMcpServerChecked,
  onRestrictToolsChange,
  onSelectAllIntegrations,
  onClearIntegrations,
  onToggleIntegrationChecked,
  onTriggerTypeChange,
  onScheduleTypeChange,
  onIntervalHoursChange,
  onScheduleTimeChange,
  onToggleWeekDay,
  onScheduleDayOfMonthChange,
  onCopyCoworkerAlias,
  onRotateCoworkerAlias,
  onDisableCoworkerAlias,
  onCreateCoworkerAlias,
  onClose,
  showCloseButton = true,
  showDeleteDialog,
  onShowDeleteDialogChange,
  onDelete,
  isDeleting,
  hideHeader,
  showAdminTab = false,
  adminContent,
}: CoworkerSettingsPanelProps) {
  const [instructionModalOpen, setInstructionModalOpen] = useState(false);
  const [instructionEditorMode, setInstructionEditorMode] = useState<MarkdownEditorMode>("wysiwyg");
  const [triggerExpanded, setTriggerExpanded] = useState(false);
  const [isDocumentDragActive, setIsDocumentDragActive] = useState(false);
  const documentInputRef = useRef<HTMLInputElement | null>(null);

  const handleOpenInstructionModal = useCallback(() => {
    setInstructionModalOpen(true);
  }, []);

  const handleCloseInstructionModal = useCallback(() => {
    setInstructionModalOpen(false);
  }, []);

  const handleRawPromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onPromptChange(e.target.value);
    },
    [onPromptChange],
  );

  const handleUserInputPromptChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onUserInputPromptChange(event.target.value);
    },
    [onUserInputPromptChange],
  );

  const handleToggleTriggerExpanded = useCallback(() => {
    setTriggerExpanded((value) => !value);
  }, []);

  const handleIntegrationButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const integrationType = event.currentTarget.dataset.integrationType as
        | IntegrationType
        | undefined;
      if (!integrationType) {
        return;
      }
      onToggleIntegrationChecked(integrationType);
    },
    [onToggleIntegrationChecked],
  );

  const handleSkillButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const skillKey = event.currentTarget.dataset.skillKey;
      if (!skillKey) {
        return;
      }
      onToggleSkillChecked(skillKey);
    },
    [onToggleSkillChecked],
  );
  const handleWorkspaceMcpServerButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const sourceId = event.currentTarget.dataset.executorSourceId;
      if (!sourceId) {
        return;
      }
      onToggleWorkspaceMcpServerChecked(sourceId);
    },
    [onToggleWorkspaceMcpServerChecked],
  );

  const handleOpenDeleteDialog = useCallback(() => {
    onShowDeleteDialogChange(true);
  }, [onShowDeleteDialogChange]);

  const handleTabChange = useCallback(
    (key: string) => {
      onTabChange(key as CoworkerTab);
    },
    [onTabChange],
  );

  const handleSelectRun = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const runId = e.currentTarget.dataset.runId;
      if (runId) {
        onSelectRun(runId);
      }
    },
    [onSelectRun],
  );

  const handleBrowseDocuments = useCallback(() => {
    if (isUploadingDocuments) {
      return;
    }
    documentInputRef.current?.click();
  }, [isUploadingDocuments]);

  const handleDocumentInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        void onUploadDocuments(files);
      }
      event.target.value = "";
    },
    [onUploadDocuments],
  );

  const handleDocumentDragOver = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDocumentDragActive(true);
  }, []);

  const handleDocumentDragLeave = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDocumentDragActive(false);
  }, []);

  const handleDocumentDrop = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setIsDocumentDragActive(false);
      if (isUploadingDocuments) {
        return;
      }
      if (event.dataTransfer.files.length > 0) {
        void onUploadDocuments(event.dataTransfer.files);
      }
    },
    [isUploadingDocuments, onUploadDocuments],
  );

  const handleDeleteDocumentClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const documentId = event.currentTarget.dataset.documentId;
      if (!documentId) {
        return;
      }

      const document = documents.find((entry) => entry.id === documentId);
      if (!document) {
        return;
      }

      void onDeleteDocument(document);
    },
    [documents, onDeleteDocument],
  );

  const handleDownloadDocumentClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const documentId = event.currentTarget.dataset.documentId;
      if (!documentId) {
        return;
      }

      const document = documents.find((entry) => entry.id === documentId);
      if (!document) {
        return;
      }

      void onDownloadDocument(document);
    },
    [documents, onDownloadDocument],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar — hidden on mobile where the parent provides its own */}
      {!hideHeader && (
        <div className="flex items-center justify-between gap-3 px-3 py-1.5">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <AnimatedTabs activeKey={activeTab} onTabChange={handleTabChange}>
              <AnimatedTab value="instruction">Instruction</AnimatedTab>
              <AnimatedTab value="runs">Runs</AnimatedTab>
              <AnimatedTab value="docs">Docs</AnimatedTab>
              <AnimatedTab value="toolbox">Toolbox</AnimatedTab>
              {showAdminTab ? <AnimatedTab value="admin">Admin</AnimatedTab> : null}
            </AnimatedTabs>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isSaving && <span className="text-muted-foreground shrink-0 text-xs">Saving…</span>}
            <div className="flex items-center gap-1.5">
              <AnimatePresence mode="wait">
                <motion.span
                  key={status}
                  initial={statusTextMotionInitial}
                  animate={statusTextMotionAnimate}
                  exit={statusTextMotionExit}
                  transition={statusTextMotionTransition}
                  className={cn(
                    "text-xs font-medium",
                    status === "on"
                      ? "text-green-600 dark:text-green-400"
                      : "text-muted-foreground",
                  )}
                >
                  {status === "on" ? "On" : "Off"}
                </motion.span>
              </AnimatePresence>
              <Switch checked={status === "on"} onCheckedChange={onStatusChange} />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-3 text-xs font-medium"
              onClick={onRun}
              disabled={isRunDisabled}
            >
              {isRunning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Run now
            </Button>
            <button
              type="button"
              onClick={handleOpenDeleteDialog}
              className="text-muted-foreground hover:text-destructive hover:bg-muted flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              aria-label="Delete coworker"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            {showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground hover:bg-muted flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                aria-label="Close panel"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
            <AlertDialog open={showDeleteDialog} onOpenChange={onShowDeleteDialogChange}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete coworker?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this coworker and all of its run history. This
                    action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    disabled={isDeleting}
                    className="bg-destructive hover:bg-destructive/90 text-white"
                  >
                    {isDeleting ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
      {/* Tab content — scrollable (or flex when showing inline run) */}
      <div
        className={cn(
          "min-h-0 flex-1",
          activeTab === "runs" && selectedRunId
            ? "flex flex-col overflow-hidden"
            : "overflow-y-auto",
        )}
      >
        {activeTab === "instruction" && (
          <div className="space-y-3 px-4 py-3">
            {/* Name & Username — side-by-side on desktop, stacked on mobile */}
            <div className={cn("gap-3", hideHeader ? "flex flex-col" : "grid grid-cols-2")}>
              <div className="px-1 py-1">
                <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Name
                </label>
                <Input
                  value={name}
                  onChange={onNameChange}
                  placeholder="New Coworker"
                  className="mt-1.5 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="px-1 py-1">
                <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Username
                </label>
                <div className="mt-1.5 flex items-center">
                  <span className="text-muted-foreground text-sm">@</span>
                  <Input
                    value={username}
                    onChange={onUsernameChange}
                    placeholder="my-coworker"
                    className="border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
                  />
                </div>
              </div>
            </div>

            {/* Instruction preview card */}
            <button
              type="button"
              className="group border-border/30 hover:border-border/50 hover:bg-muted/20 relative w-full cursor-pointer rounded-xl border p-4 text-left transition-all"
              onClick={handleOpenInstructionModal}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Instructions
                </span>
                <span className="text-muted-foreground group-hover:text-foreground flex items-center gap-1 text-xs transition-colors">
                  <Pencil className="h-3 w-3" />
                  Edit
                </span>
              </div>
              {prompt ? (
                <div className="relative max-h-[min(36dvh,20rem)] overflow-y-auto overscroll-contain pr-2">
                  <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-1.5 prose-headings:text-sm prose-headings:font-semibold prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-1.5 prose-code:text-xs max-w-none text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={instructionRemarkPlugins}>{prompt}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground/60 text-sm italic">
                  Your new coworker’s instructions will appear here
                </p>
              )}
            </button>

            <div className="border-border/30 rounded-xl border px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    Require parameter
                  </span>
                </div>
                <Switch
                  checked={requiresUserInput}
                  onCheckedChange={onRequiresUserInputChange}
                  aria-label="Require parameter"
                />
              </div>
              {requiresUserInput && (
                <label className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed">
                  <span className="text-muted-foreground shrink-0">Parameter prompt:</span>
                  <textarea
                    value={userInputPrompt}
                    onChange={handleUserInputPromptChange}
                    maxLength={1000}
                    placeholder="What name should I use for the greeting?"
                    className="text-foreground placeholder:text-muted-foreground/60 min-h-[44px] flex-1 resize-none bg-transparent leading-relaxed focus:outline-none"
                  />
                </label>
              )}
            </div>

            {/* Instruction editor modal */}
            <Dialog open={instructionModalOpen} onOpenChange={setInstructionModalOpen}>
              <DialogContent
                className={cn(
                  "flex max-w-none flex-col gap-0 overflow-hidden p-0",
                  hideHeader
                    ? "h-dvh w-dvw rounded-none border-0"
                    : "h-[min(80dvh,700px)] w-[min(90vw,900px)]",
                )}
                showCloseButton={false}
              >
                <DialogHeader className="border-border/40 flex-row items-center justify-between border-b px-5 py-3.5">
                  <DialogTitle className="text-sm font-semibold">Edit instructions</DialogTitle>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={onSaveInstructions}
                      disabled={isSaving || !coworkerId}
                      className="h-7 gap-1.5 px-2.5 text-xs font-medium"
                    >
                      {isSaving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      {isSaving ? "Saving" : "Save"}
                    </Button>
                    <MarkdownEditorModeToggle
                      mode={instructionEditorMode}
                      onModeChange={setInstructionEditorMode}
                    />
                    <button
                      type="button"
                      onClick={handleCloseInstructionModal}
                      className="text-muted-foreground hover:text-foreground hover:bg-muted flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </DialogHeader>
                {instructionEditorMode === "source" ? (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <textarea
                      className="text-foreground placeholder:text-muted-foreground/50 flex-1 resize-none overflow-y-auto overscroll-contain bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed focus:outline-none"
                      value={prompt}
                      onChange={handleRawPromptChange}
                      placeholder={
                        "Your new coworker’s instructions will appear here\n\nYou can use markdown for formatting:\n- **Bold** for emphasis\n- `code` for technical terms\n- Lists for step-by-step instructions"
                      }
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <MilkdownEditor
                      value={prompt}
                      onChange={onPromptChange}
                      placeholder="Your new coworker’s instructions will appear here..."
                      autoFocus
                      className="h-full"
                    />
                  </div>
                )}
              </DialogContent>
            </Dialog>

            {/* Trigger card */}
            <div className="border-border/20 rounded-xl border">
              <button
                type="button"
                className="hover:bg-muted/20 flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-colors"
                onClick={handleToggleTriggerExpanded}
              >
                <div>
                  <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    Trigger
                  </span>
                  <p className="text-foreground mt-0.5 text-sm">
                    {triggers.find((t) => t.value === triggerType)?.label ?? "Manual only"}
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "text-muted-foreground h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                    triggerExpanded && "rotate-180",
                  )}
                />
              </button>
              <AnimatePresence initial={false}>
                {triggerExpanded && (
                  <motion.div
                    initial={sectionMotionInitial}
                    animate={sectionMotionAnimate}
                    exit={sectionMotionExit}
                    transition={sectionMotionTransition}
                    className="overflow-hidden"
                  >
                    <div className="border-border/40 space-y-3 border-t px-4 pt-3 pb-4">
                      <Select value={triggerType} onValueChange={onTriggerTypeChange}>
                        <SelectTrigger className="h-9 w-full bg-transparent text-sm">
                          <SelectValue placeholder="Select a trigger" />
                        </SelectTrigger>
                        <SelectContent>
                          {triggers.map((trigger) => (
                            <SelectItem key={trigger.value} value={trigger.value}>
                              {trigger.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <AnimatePresence initial={false} mode="wait">
                        {triggerType === "schedule" && (
                          <motion.div
                            key="schedule-settings"
                            className="space-y-3"
                            initial={scheduleMotionInitial}
                            animate={scheduleMotionAnimate}
                            exit={scheduleMotionExit}
                            transition={scheduleMotionTransition}
                            style={scheduleMotionStyle}
                          >
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Frequency</label>
                              <Select value={scheduleType} onValueChange={onScheduleTypeChange}>
                                <SelectTrigger className="bg-background h-9 w-full text-sm">
                                  <SelectValue placeholder="Select frequency" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="interval">Every X hours</SelectItem>
                                  <SelectItem value="daily">Daily</SelectItem>
                                  <SelectItem value="weekly">Weekly</SelectItem>
                                  <SelectItem value="monthly">Monthly</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {scheduleType === "interval" && (
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium">Run every</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min={1}
                                    max={168}
                                    className="bg-background h-9 w-20 rounded-md border px-3 text-sm"
                                    value={Math.max(1, Math.round(intervalMinutes / 60))}
                                    onChange={onIntervalHoursChange}
                                  />
                                  <span className="text-muted-foreground text-xs">hours</span>
                                </div>
                              </div>
                            )}

                            {(scheduleType === "daily" ||
                              scheduleType === "weekly" ||
                              scheduleType === "monthly") && (
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium">
                                  Time ({localTimezone})
                                </label>
                                <Input
                                  type="time"
                                  step={60}
                                  value={scheduleTime}
                                  onChange={onScheduleTimeChange}
                                  className="bg-background h-9 w-32 appearance-none text-sm [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                                />
                              </div>
                            )}

                            {scheduleType === "weekly" && (
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium">Days of the week</label>
                                <div className="flex flex-wrap gap-1.5">
                                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day, index) => (
                                    <button
                                      key={day}
                                      type="button"
                                      data-day-index={index}
                                      className={cn(
                                        "h-8 w-10 rounded-md border text-xs font-medium transition-colors",
                                        scheduleDaysOfWeek.includes(index)
                                          ? "border-primary bg-primary text-primary-foreground"
                                          : "bg-background hover:bg-muted",
                                      )}
                                      onClick={onToggleWeekDay}
                                    >
                                      {day}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {scheduleType === "monthly" && (
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium">Day of the month</label>
                                <Select
                                  value={String(scheduleDayOfMonth)}
                                  onValueChange={onScheduleDayOfMonthChange}
                                >
                                  <SelectTrigger className="bg-background h-9 w-20 text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                                      <SelectItem key={day} value={String(day)}>
                                        {day}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {triggerType === EMAIL_FORWARDED_TRIGGER_TYPE && (
                        <div className="bg-muted/20 space-y-3 rounded-lg border p-3">
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium">Forwarding address</label>
                            {hasActiveForwardingAlias ? (
                              <div className="flex flex-col gap-2">
                                <Input
                                  type="text"
                                  value={coworkerForwardingAddress ?? ""}
                                  disabled
                                  className="bg-background/60 font-mono text-xs"
                                  placeholder="Set RESEND_RECEIVING_DOMAIN to enable forwarding aliases"
                                />
                                <div className="flex gap-1.5">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={onCopyCoworkerAlias}
                                    disabled={!coworkerForwardingAddress}
                                  >
                                    {copiedForwardingField === "coworkerAlias" ? "Copied" : "Copy"}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={onRotateCoworkerAlias}
                                    disabled={rotateForwardingAlias.isPending}
                                  >
                                    Rotate
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={onDisableCoworkerAlias}
                                    disabled={disableForwardingAlias.isPending}
                                  >
                                    Disable
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                <Input
                                  type="text"
                                  value=""
                                  disabled
                                  className="bg-background/60 font-mono text-xs"
                                  placeholder="No forwarding address yet"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={onCreateCoworkerAlias}
                                  disabled={
                                    createForwardingAlias.isPending ||
                                    !coworkerForwardingAlias?.receivingDomain ||
                                    !isEmailTriggerPersisted
                                  }
                                >
                                  Create email
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="border-border/40 space-y-3 rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <label className="text-xs font-medium">Needs your input</label>
                            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                              Ask a first question in chat before this trigger starts a run.
                            </p>
                          </div>
                          <Switch
                            checked={requiresUserInput}
                            onCheckedChange={onRequiresUserInputChange}
                          />
                        </div>
                        <AnimatePresence initial={false}>
                          {requiresUserInput && (
                            <motion.div
                              key="user-input-prompt"
                              initial={sectionMotionInitial}
                              animate={sectionMotionAnimate}
                              exit={sectionMotionExit}
                              transition={sectionMotionTransition}
                              className="overflow-hidden"
                            >
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium">Question to ask</label>
                                <textarea
                                  value={userInputPrompt}
                                  onChange={handleUserInputPromptChange}
                                  maxLength={1000}
                                  placeholder="Which email address should I send the draft to?"
                                  className="bg-background text-foreground placeholder:text-muted-foreground/60 min-h-[78px] w-full resize-none rounded-md border px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/40"
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Approval policy card */}
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Approval policy
                </span>
                <p className="text-foreground mt-0.5 text-sm">
                  {autoApprove ? "Auto-approve all write actions" : "Manual approval required"}
                </p>
              </div>
              <Switch checked={autoApprove} onCheckedChange={onAutoApproveChange} />
            </div>

            {/* Description card */}
            <div className="px-4 py-3">
              <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Description
              </label>
              <textarea
                className="text-foreground placeholder:text-muted-foreground/60 mt-1.5 min-h-[80px] w-full resize-none bg-transparent text-sm leading-relaxed focus:outline-none"
                value={description}
                onChange={onDescriptionChange}
                placeholder="What does this coworker do?"
              />
            </div>

            {/* Model card */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Model
              </span>
              <ModelSelector
                selectedModel={model}
                selectedAuthSource={modelAuthSource}
                providerAvailability={providerAvailability}
                onSelectionChange={onModelChange}
              />
            </div>
          </div>
        )}

        {activeTab === "runs" && (
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
                  <p className="text-muted-foreground text-xs">No runs yet.</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {activeTab === "docs" && (
          <div className="px-4 py-3">
            <div className="space-y-3">
              <input
                ref={documentInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleDocumentInputChange}
              />
              <button
                type="button"
                onClick={handleBrowseDocuments}
                onDragOver={handleDocumentDragOver}
                onDragLeave={handleDocumentDragLeave}
                onDrop={handleDocumentDrop}
                disabled={isUploadingDocuments}
                className={cn(
                  "relative block w-full overflow-hidden rounded-[24px] border-2 border-dashed px-5 py-8 text-left transition-all",
                  isDocumentDragActive
                    ? "border-emerald-400 bg-emerald-50/70 shadow-[0_0_0_6px_rgba(16,185,129,0.08)]"
                    : "border-muted-foreground/25 hover:border-muted-foreground/40 bg-gradient-to-br from-white to-slate-50/80",
                  isUploadingDocuments && "cursor-wait opacity-80",
                )}
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.04),transparent_55%)]" />
                <div className="relative flex flex-col items-center justify-center gap-3 text-center">
                  <div
                    className={cn(
                      "flex h-14 w-14 items-center justify-center rounded-2xl border",
                      isDocumentDragActive
                        ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500",
                    )}
                  >
                    {isUploadingDocuments ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : (
                      <Upload className="h-7 w-7" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-800">
                      {isUploadingDocuments
                        ? "Uploading documents and updating the builder…"
                        : "Drop files here or browse from your machine"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      PDF, Office docs, text, CSV, and images. Uploaded files are stored for future
                      coworker runs and sent to the builder chat.
                    </p>
                  </div>
                  <span className="border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground mt-1 inline-flex h-8 items-center justify-center rounded-full border px-4 text-xs font-medium">
                    Browse files
                  </span>
                </div>
              </button>
              {documents.length > 0 ? (
                <div className="space-y-2">
                  {documents.map((document) => (
                    <div
                      key={document.id}
                      className="border-border/40 bg-background/70 flex items-start gap-3 rounded-2xl border px-3 py-3"
                    >
                      <div className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                        <FileText className="text-muted-foreground h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {document.filename}
                          </p>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium tracking-[0.14em] text-slate-500 uppercase">
                            {document.mimeType.split("/")[0]}
                          </span>
                        </div>
                        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          <span>{formatFileSize(document.sizeBytes)}</span>
                          <span>Added {formatRelativeTime(document.createdAt)}</span>
                        </div>
                        {document.description ? (
                          <p className="text-muted-foreground text-xs">{document.description}</p>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-foreground rounded-full"
                          data-document-id={document.id}
                          onClick={handleDownloadDocumentClick}
                          disabled={downloadingDocumentIds.includes(document.id)}
                          aria-label={`Download ${document.filename}`}
                        >
                          {downloadingDocumentIds.includes(document.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive rounded-full"
                          data-document-id={document.id}
                          onClick={handleDeleteDocumentClick}
                          disabled={deletingDocumentIds.includes(document.id)}
                          aria-label={`Delete ${document.filename}`}
                        >
                          {deletingDocumentIds.includes(document.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 py-4">
                  <FileText className="text-muted-foreground h-4 w-4" />
                  <p className="text-muted-foreground text-xs">No documents added yet.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "toolbox" && (
          <div className="space-y-5 px-4 py-3">
            {/* All tools toggle */}
            <div className="border-border/40 bg-muted/20 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
              <div className="space-y-0.5">
                <span className="text-sm font-medium">All tools allowed</span>
                <p className="text-muted-foreground text-[11px]">
                  When enabled, this coworker can use any connected tool
                </p>
              </div>
              <Switch checked={!restrictTools} onCheckedChange={onRestrictToolsChange} />
            </div>

            {restrictTools && (
              <motion.div
                initial={toolboxRevealInitial}
                animate={toolboxRevealAnimate}
                transition={toolboxRevealTransition}
                className="space-y-5"
              >
                {/* Integrations section */}
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                      Integrations
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={onSelectAllIntegrations}
                        disabled={allowedIntegrations.length === allIntegrationTypes.length}
                        className="text-muted-foreground hover:text-foreground text-[10px] font-medium transition-colors disabled:opacity-40"
                      >
                        All
                      </button>
                      <span className="text-muted-foreground/30 text-[10px]">·</span>
                      <button
                        type="button"
                        onClick={onClearIntegrations}
                        disabled={allowedIntegrations.length === 0}
                        className="text-muted-foreground hover:text-foreground text-[10px] font-medium transition-colors disabled:opacity-40"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {integrationEntries.map(({ key, name: label, logo }) => {
                      const isActive = allowedIntegrations.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          data-integration-type={key}
                          onClick={handleIntegrationButtonClick}
                          className={cn(
                            "group relative flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all duration-150",
                            isActive
                              ? "border-primary/30 bg-primary/5 shadow-sm"
                              : "border-border/40 bg-card hover:border-border/70 opacity-60 hover:opacity-100",
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-white p-1 dark:bg-gray-800",
                              isActive ? "border-primary/20 shadow-sm" : "border-border/40",
                            )}
                          >
                            <Image
                              src={logo}
                              alt={label}
                              width={16}
                              height={16}
                              className="h-4 w-4 object-contain"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] leading-tight font-medium">
                              {label}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1">
                              <span
                                className={cn(
                                  "inline-block h-1.5 w-1.5 rounded-full",
                                  isActive ? "bg-emerald-500" : "bg-muted-foreground/30",
                                )}
                              />
                              <span
                                className={cn(
                                  "text-[9px] font-medium",
                                  isActive
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-muted-foreground/50",
                                )}
                              >
                                {isActive ? "On" : "Off"}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Skills section */}
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                      Integrations
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground text-[10px]">
                        {selectedWorkspaceMcpServerIds.length}/{executorSourceEntries.length}
                      </span>
                      {selectedWorkspaceMcpServerIds.length > 0 && (
                        <button
                          type="button"
                          onClick={onClearWorkspaceMcpServers}
                          className="text-muted-foreground hover:text-foreground text-[10px] font-medium transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  {executorSourceEntries.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-center text-xs">
                      No workspace integrations available.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {executorSourceEntries.map((source) => {
                        const isActive = selectedWorkspaceMcpServerIds.includes(source.id);
                        return (
                          <button
                            key={source.id}
                            type="button"
                            data-executor-source-id={source.id}
                            onClick={handleWorkspaceMcpServerButtonClick}
                            className={cn(
                              "group relative flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all duration-150",
                              isActive
                                ? "border-primary/30 bg-primary/5 shadow-sm"
                                : "border-border/40 bg-card hover:border-border/70 opacity-60 hover:opacity-100",
                            )}
                          >
                            <div
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase",
                                isActive
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted/60 text-muted-foreground",
                              )}
                            >
                              {source.kind === "mcp" ? "MCP" : "API"}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] leading-tight font-medium">
                                {source.title}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1">
                                <span
                                  className={cn(
                                    "inline-block h-1.5 w-1.5 rounded-full",
                                    source.connected ? "bg-emerald-500" : "bg-amber-500",
                                  )}
                                />
                                <span className="text-muted-foreground text-[9px] font-medium tracking-wide uppercase">
                                  {source.namespace}
                                  {source.connected ? "" : " · connect"}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Skills section */}
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                      Skills
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground text-[10px]">
                        {selectedSkillKeys.length}/{availableSkills.length}
                      </span>
                      {selectedSkillKeys.length > 0 && (
                        <button
                          type="button"
                          onClick={onClearSkills}
                          className="text-muted-foreground hover:text-foreground text-[10px] font-medium transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  {isSkillsLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
                    </div>
                  ) : availableSkills.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-center text-xs">
                      No skills available.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {availableSkills.map((skill) => {
                        const isActive = selectedSkillKeys.includes(skill.key);
                        return (
                          <button
                            key={skill.key}
                            type="button"
                            data-skill-key={skill.key}
                            onClick={handleSkillButtonClick}
                            className={cn(
                              "group relative flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all duration-150",
                              isActive
                                ? "border-primary/30 bg-primary/5 shadow-sm"
                                : "border-border/40 bg-card hover:border-border/70 opacity-60 hover:opacity-100",
                            )}
                          >
                            <div
                              className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                                isActive
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted/60 text-muted-foreground",
                              )}
                            >
                              <span className="text-sm">
                                {skill.source === "Platform" ? "🔧" : "⚡"}
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] leading-tight font-medium">
                                {skill.title}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1">
                                <span
                                  className={cn(
                                    "inline-block h-1.5 w-1.5 rounded-full",
                                    isActive ? "bg-emerald-500" : "bg-muted-foreground/30",
                                  )}
                                />
                                <span
                                  className={cn(
                                    "text-[9px] font-medium uppercase tracking-wide",
                                    isActive
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-muted-foreground/50",
                                  )}
                                >
                                  {skill.source}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              </motion.div>
            )}

            {/* Manage in Toolbox link */}
            <Link
              href="/toolbox"
              className="border-border/40 bg-card hover:bg-muted/30 hover:border-border/70 flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium transition-colors"
            >
              <span className="text-muted-foreground">Manage in Toolbox</span>
              <ArrowRight className="text-muted-foreground h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        {activeTab === "admin" && (
          <div className="px-4 py-3">
            {adminContent ?? <p className="text-xs">No admin actions.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
