import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { GenerationRuntime, RuntimeSegmentApproval } from "@/lib/generation-runtime";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import { getApprovalLocalResolutionKeys } from "../approval-segment-filter";
import {
  RUN_DEADLINE_RESUME_TOOL_USE_ID,
  type ActivitySegment,
  type HistoricalActivityBlock,
  type PendingRunDeadlineResumeState,
} from "./chat-generation-interrupts";

type AuthIntegrationType =
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
  | "twitter";

export function useChatGenerationInterruptActions({
  activeGeneration,
  displaySegments,
  getAuthUrl,
  handleResumePausedRunDeadline,
  interactiveConversationId,
  optimisticallyResumeInterruptedGeneration,
  pendingRunDeadlineResume,
  runtimeRef,
  setDismissedRunDeadlineGenerationId,
  setHistoricalActivityBlocks,
  setLocallyResolvedApprovalKeys,
  setPendingRunDeadlineResume,
  setStreamError,
  submitApproval,
  submitAuthResult,
  syncFromRuntime,
}: {
  activeGeneration?: { generationId?: string | null } | null;
  displaySegments: ActivitySegment[];
  getAuthUrl: (input: {
    type: AuthIntegrationType;
    redirectUrl: string;
  }) => Promise<{ authUrl: string }>;
  handleResumePausedRunDeadline: () => Promise<void>;
  interactiveConversationId: string | null;
  optimisticallyResumeInterruptedGeneration: (
    interruptId: string,
    kind: "approval" | "auth",
    options?: { connectedIntegration?: string; questionAnswers?: string[][] },
  ) => void;
  pendingRunDeadlineResume: PendingRunDeadlineResumeState | null;
  runtimeRef: MutableRefObject<GenerationRuntime | null>;
  setDismissedRunDeadlineGenerationId: Dispatch<SetStateAction<string | null>>;
  setHistoricalActivityBlocks: Dispatch<SetStateAction<HistoricalActivityBlock[]>>;
  setLocallyResolvedApprovalKeys: Dispatch<SetStateAction<Set<string>>>;
  setPendingRunDeadlineResume: Dispatch<SetStateAction<PendingRunDeadlineResumeState | null>>;
  setStreamError: Dispatch<SetStateAction<string | null>>;
  submitApproval: (input: {
    interruptId: string;
    decision: "approve" | "deny";
    questionAnswers?: string[][];
  }) => Promise<unknown>;
  submitAuthResult: (input: {
    interruptId: string;
    integration: string;
    success: boolean;
  }) => Promise<unknown>;
  syncFromRuntime: (runtime: GenerationRuntime) => void;
}) {
  const handleApprove = useCallback(
    async (
      toolUseId: string,
      interruptId?: string,
      questionAnswers?: string[][],
      approval?: RuntimeSegmentApproval,
    ) => {
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

      const localResolutionKeys = getApprovalLocalResolutionKeys(
        approval ?? { toolUseId, interruptId },
      );
      setLocallyResolvedApprovalKeys((current) => {
        const next = new Set(current);
        for (const key of localResolutionKeys) {
          next.add(key);
        }
        return next;
      });

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
        setLocallyResolvedApprovalKeys((current) => {
          const next = new Set(current);
          for (const key of localResolutionKeys) {
            next.delete(key);
          }
          return next;
        });
        console.error("Failed to approve tool use:", err);
      }
    },
    [
      handleResumePausedRunDeadline,
      optimisticallyResumeInterruptedGeneration,
      runtimeRef,
      setLocallyResolvedApprovalKeys,
      submitApproval,
      syncFromRuntime,
    ],
  );

  const handleDeny = useCallback(
    async (toolUseId: string, interruptId?: string, approval?: RuntimeSegmentApproval) => {
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

      const localResolutionKeys = getApprovalLocalResolutionKeys(
        approval ?? { toolUseId, interruptId },
      );
      setLocallyResolvedApprovalKeys((current) => {
        const next = new Set(current);
        for (const key of localResolutionKeys) {
          next.add(key);
        }
        return next;
      });

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
        setLocallyResolvedApprovalKeys((current) => {
          const next = new Set(current);
          for (const key of localResolutionKeys) {
            next.delete(key);
          }
          return next;
        });
        console.error("Failed to deny tool use:", err);
      }
    },
    [
      activeGeneration?.generationId,
      pendingRunDeadlineResume?.generationId,
      runtimeRef,
      setDismissedRunDeadlineGenerationId,
      setHistoricalActivityBlocks,
      setLocallyResolvedApprovalKeys,
      setPendingRunDeadlineResume,
      submitApproval,
      syncFromRuntime,
    ],
  );

  const handleAuthConnect = useCallback(
    async (integration: string) => {
      const pendingAuthInterruptId =
        displaySegments.find((segment) => segment.auth?.status === "pending")?.auth?.interruptId ??
        null;
      if (!pendingAuthInterruptId || !interactiveConversationId) {
        return;
      }

      if (runtimeRef.current) {
        runtimeRef.current.setAuthConnecting();
        syncFromRuntime(runtimeRef.current);
      }

      try {
        const result = await getAuthUrl({
          type: integration as AuthIntegrationType,
          redirectUrl: `${window.location.origin}/chat/${interactiveConversationId}?auth_complete=${integration}&interrupt_id=${pendingAuthInterruptId}`,
        });
        window.location.assign(result.authUrl);
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
    [
      displaySegments,
      getAuthUrl,
      interactiveConversationId,
      runtimeRef,
      setStreamError,
      syncFromRuntime,
    ],
  );

  const handleAuthCancel = useCallback(async () => {
    const segment = displaySegments.find((candidate) => candidate.auth?.status === "pending");
    const integration = segment?.auth?.integrations[0];
    const interruptId = segment?.auth?.interruptId;
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
  }, [displaySegments, runtimeRef, submitAuthResult, syncFromRuntime]);

  const segmentApproveHandlers = useMemo(() => {
    const handlers = new Map<string, (questionAnswers?: string[][]) => void>();
    for (const segment of displaySegments) {
      const toolUseId = segment.approval?.toolUseId;
      if (!toolUseId) {
        continue;
      }
      const interruptId = segment.approval?.interruptId;
      const approval = segment.approval;
      handlers.set(segment.id, (questionAnswers?: string[][]) => {
        void handleApprove(toolUseId, interruptId, questionAnswers, approval);
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
      const approval = segment.approval;
      handlers.set(segment.id, () => {
        void handleDeny(toolUseId, interruptId, approval);
      });
    }
    return handlers;
  }, [displaySegments, handleDeny]);

  return {
    handleAuthCancel,
    handleAuthConnect,
    segmentApproveHandlers,
    segmentDenyHandlers,
  };
}
