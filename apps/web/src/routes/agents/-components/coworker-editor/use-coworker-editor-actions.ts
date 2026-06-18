import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { normalizeGenerationError } from "@/lib/generation-errors";
import {
  useCreateCoworkerForwardingAlias,
  useDisableCoworkerForwardingAlias,
  useRotateCoworkerForwardingAlias,
  useDeleteCoworker,
  useTriggerCoworker,
  useResetCoworkerRunsAndEnable,
} from "@/orpc/hooks/coworkers";
import type { RemoteIntegrationTargetEnv } from "./types";

type UseCoworkerEditorActionsInput = {
  coworkerId?: string;
  embedded: boolean;
  coworkerForwardingAddress: string | null;
  requiresResetBeforeEnable: boolean;
  persistCoworker: (options?: { force?: boolean }) => Promise<boolean>;
  setStatusFromChecked: (checked: boolean) => void;
  refetchCoworker: () => Promise<unknown>;
  refetchRuns: () => Promise<unknown>;
};

/**
 * Owns every imperative coworker side-effect the editor can launch: creating,
 * rotating, disabling, and copying the email forwarding alias; starting a test
 * run (persist-then-trigger); resetting the run backlog and re-enabling
 * automation behind a confirmation toast; toggling the enabled status with the
 * backlog guard; saving instructions; and deleting the coworker.
 *
 * It also holds the small UI state these actions drive (the copied-field flash,
 * the in-flight run flag, the delete-dialog flag) so the caller exposes them
 * without re-implementing the orchestration. The data mutations are mounted
 * here, so this is the single seam where coworker-run/alias behaviour lives.
 */
export function useCoworkerEditorActions({
  coworkerId,
  embedded,
  coworkerForwardingAddress,
  requiresResetBeforeEnable,
  persistCoworker,
  setStatusFromChecked,
  refetchCoworker,
  refetchRuns,
}: UseCoworkerEditorActionsInput) {
  const t = useGT();
  const navigate = useNavigate();
  const createForwardingAlias = useCreateCoworkerForwardingAlias();
  const disableForwardingAlias = useDisableCoworkerForwardingAlias();
  const rotateForwardingAlias = useRotateCoworkerForwardingAlias();
  const triggerCoworker = useTriggerCoworker();
  const resetCoworkerRuns = useResetCoworkerRunsAndEnable();
  const deleteCoworker = useDeleteCoworker();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [copiedForwardingField, setCopiedForwardingField] = useState<
    "coworkerAlias" | "invokeHandle" | null
  >(null);

  const handleDelete = useCallback(() => {
    if (!coworkerId) {
      return;
    }
    deleteCoworker.mutate(coworkerId, {
      onSuccess: () => {
        toast.success(t("Coworker deleted"));
        void navigate({ to: embedded ? "/agents" : "/agents" });
      },
      onError: () => {
        toast.error(t("Failed to delete coworker"));
      },
    });
  }, [coworkerId, deleteCoworker, embedded, navigate, t]);

  const handleOpenDeleteDialog = useCallback(() => {
    setShowDeleteDialog(true);
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
      toast.success(t("Forwarding address created."));
    } catch (error) {
      console.error("Failed to create forwarding alias:", error);
      toast.error(t("Failed to create forwarding address."));
    }
  }, [createForwardingAlias, coworkerId, t]);

  const handleRotateCoworkerAlias = useCallback(async () => {
    if (!coworkerId) {
      return;
    }

    try {
      await rotateForwardingAlias.mutateAsync(coworkerId);
      toast.success(t("Forwarding address rotated."));
    } catch (error) {
      console.error("Failed to rotate forwarding alias:", error);
      toast.error(t("Failed to rotate forwarding address."));
    }
  }, [rotateForwardingAlias, coworkerId, t]);

  const handleDisableCoworkerAlias = useCallback(async () => {
    if (!coworkerId) {
      return;
    }

    try {
      await disableForwardingAlias.mutateAsync(coworkerId);
      toast.success(t("Forwarding address disabled."));
    } catch (error) {
      console.error("Failed to disable forwarding alias:", error);
      toast.error(t("Failed to disable forwarding address."));
    }
  }, [disableForwardingAlias, coworkerId, t]);

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
        const saveSucceeded = await persistCoworker({ force: true });
        if (!saveSucceeded) {
          toast.error(t("Failed to save coworker before test run."));
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
    [isStartingRun, persistCoworker, refetchRuns, triggerCoworker, coworkerId, t],
  );

  const executeResetRunsAndEnable = useCallback(async () => {
    if (!coworkerId || resetCoworkerRuns.isPending) {
      return;
    }

    try {
      await resetCoworkerRuns.mutateAsync(coworkerId);
      setStatusFromChecked(true);
      await Promise.all([refetchCoworker(), refetchRuns()]);
      toast.success(t("Runs reset and automation enabled."));
    } catch (error) {
      console.error("Failed to reset coworker runs:", error);
      toast.error(t("Failed to reset coworker runs."));
    }
  }, [coworkerId, refetchCoworker, refetchRuns, resetCoworkerRuns, setStatusFromChecked, t]);

  const handleResetRunsAndEnable = useCallback(() => {
    if (!coworkerId || resetCoworkerRuns.isPending) {
      return;
    }

    const toastId = toast.warning(t("Cancel previous runs?"), {
      description: t("This will cancel every unfinished run and turn automated triggers back on."),
      duration: Infinity,
      closeButton: true,
      action: {
        label: t("Cancel runs"),
        onClick: () => {
          toast.dismiss(toastId);
          void executeResetRunsAndEnable();
        },
      },
      cancel: {
        label: t("Keep runs"),
        onClick: () => {
          toast.dismiss(toastId);
        },
      },
    });
  }, [coworkerId, executeResetRunsAndEnable, resetCoworkerRuns.isPending, t]);

  const handleStatusChange = useCallback(
    (checked: boolean) => {
      if (checked && requiresResetBeforeEnable) {
        handleResetRunsAndEnable();
        return;
      }

      setStatusFromChecked(checked);
    },
    [handleResetRunsAndEnable, requiresResetBeforeEnable, setStatusFromChecked],
  );

  const handleSaveInstructions = useCallback(async () => {
    const saveSucceeded = await persistCoworker({ force: true });
    if (saveSucceeded) {
      toast.success(t("Instructions saved."));
    }
  }, [persistCoworker, t]);

  const isRunning = triggerCoworker.isPending || isStartingRun;

  return {
    createForwardingAlias,
    disableForwardingAlias,
    rotateForwardingAlias,
    triggerCoworker,
    resetCoworkerRuns,
    deleteCoworker,
    showDeleteDialog,
    setShowDeleteDialog,
    isStartingRun,
    isRunning,
    copiedForwardingField,
    handleDelete,
    handleOpenDeleteDialog,
    handleCopyCoworkerAlias,
    handleCreateCoworkerAlias,
    handleRotateCoworkerAlias,
    handleDisableCoworkerAlias,
    handleRun,
    handleResetRunsAndEnable,
    handleStatusChange,
    handleSaveInstructions,
  };
}
