import type { CoworkerToolAccessMode } from "@bap/core/lib/coworker-tool-policy";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { normalizeChatModelSelection } from "@/lib/chat-model-selection";
import type { IntegrationType } from "@/lib/integration-icons";
import type { CoworkerSchedule, useCoworker, useUpdateCoworker } from "@/orpc/hooks/coworkers";
import {
  normalizeScheduleForComparison,
  schedulesEqual,
  stringArraysEqual,
} from "./coworker-editor-utils";
import type { CoworkerEditorPayload, CoworkerScheduleType } from "./types";

const DEFAULT_COWORKER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;

type CoworkerRecord = NonNullable<ReturnType<typeof useCoworker>["data"]>;
type UpdateCoworkerMutation = ReturnType<typeof useUpdateCoworker>;

type RefetchCoworker = () => Promise<{
  data?: CoworkerRecord;
}>;

export type CoworkerDefinitionDraft = {
  name: string;
  description: string;
  username: string;
  triggerType: string;
  prompt: string;
  model: string;
  modelAuthSource: ProviderAuthSource | null;
  toolAccessMode: CoworkerToolAccessMode;
  allowedIntegrations: IntegrationType[];
  allowedWorkspaceMcpServerIds: string[];
  allowedSkillSlugs: string[];
  status: "on" | "off";
  autoApprove: boolean;
  requiresUserInput: boolean;
  userInputPrompt: string;
  scheduleType: CoworkerScheduleType;
  intervalMinutes: number;
  scheduleTime: string;
  scheduleDaysOfWeek: number[];
  scheduleDayOfMonth: number;
  scheduleTimezone: string;
};

export type CoworkerDefinitionDraftActions = {
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setUsername: (value: string) => void;
  setTriggerType: (value: string) => void;
  setPrompt: (value: string) => void;
  setModelSelection: (input: { model: string; authSource?: ProviderAuthSource | null }) => void;
  setToolAccessMode: (value: CoworkerToolAccessMode) => void;
  setAllowedIntegrations: (value: IntegrationType[]) => void;
  toggleIntegration: (type: IntegrationType) => void;
  selectAllIntegrations: () => void;
  clearIntegrations: () => void;
  toggleSkill: (skillKey: string) => void;
  clearSkills: () => void;
  toggleWorkspaceMcpServer: (serverId: string) => void;
  clearWorkspaceMcpServers: () => void;
  setStatusFromChecked: (checked: boolean) => void;
  setAutoApprove: (value: boolean) => void;
  setRequiresUserInput: (value: boolean) => void;
  setUserInputPrompt: (value: string) => void;
  setScheduleType: (value: CoworkerScheduleType) => void;
  setIntervalHours: (value: number) => void;
  setScheduleTime: (value: string) => void;
  toggleWeekDay: (dayIndex: number) => void;
  setScheduleDayOfMonth: (value: number) => void;
};

type UseCoworkerDefinitionEditorInput = {
  coworkerId?: string;
  coworker?: CoworkerRecord;
  allIntegrationTypes: IntegrationType[];
  updateCoworker: UpdateCoworkerMutation;
  refetchCoworker: RefetchCoworker;
};

function buildCoworkerPayloadSignature(input: CoworkerEditorPayload) {
  return JSON.stringify({
    ...input,
    allowedIntegrations: [...input.allowedIntegrations].toSorted(),
    allowedWorkspaceMcpServerIds: [...input.allowedWorkspaceMcpServerIds].toSorted(),
    allowedSkillSlugs: [...input.allowedSkillSlugs].toSorted(),
    schedule: normalizeScheduleForComparison(input.schedule),
  });
}

function toCoworkerUpdatedAt(value: CoworkerRecord["updatedAt"]) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function useCoworkerDefinitionEditor({
  coworkerId,
  coworker,
  allIntegrationTypes,
  updateCoworker,
  refetchCoworker,
}: UseCoworkerDefinitionEditorInput) {
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
  const [isSaving, setIsSaving] = useState(false);

  const [scheduleType, setScheduleType] = useState<CoworkerScheduleType>("daily");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleDaysOfWeek, setScheduleDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const [scheduleTimezone, setScheduleTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );

  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedEditorRef = useRef(false);
  const initializedCoworkerIdRef = useRef<string | null>(null);
  const lastSyncedCoworkerUpdatedAtRef = useRef<string | null>(null);
  const lastSavedPayloadRef = useRef<string | null>(null);
  const lastSavedPayloadSnapshotRef = useRef<CoworkerEditorPayload | null>(null);

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
    allowedSkillSlugs,
    allowedWorkspaceMcpServerIds,
    autoApprove,
    buildSchedule,
    coworkerId,
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
    userInputPrompt,
  ]);

  const persistCoworker = useCallback(
    async (options?: { force?: boolean }) => {
      if (options?.force && autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }

      const input = getCoworkerUpdateInput();
      if (!input) {
        return false;
      }

      const signature = buildCoworkerPayloadSignature(input);
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
    [getCoworkerUpdateInput, updateCoworker],
  );

  useEffect(() => {
    if (!coworker) {
      return;
    }

    const normalizedModelSelection = normalizeChatModelSelection({
      model: coworker.model ?? DEFAULT_COWORKER_MODEL,
      authSource: coworker.authSource ?? null,
    });
    const coworkerAllowedIntegrations = (
      (coworker.allowedIntegrations ?? []) as IntegrationType[]
    ).filter((type): type is IntegrationType => allIntegrationTypes.includes(type));
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
    const serverPayloadSignature = buildCoworkerPayloadSignature(payloadFromCoworker);
    const currentLocalPayload = hasInitializedEditorRef.current ? getCoworkerUpdateInput() : null;
    const currentLocalSignature = currentLocalPayload
      ? buildCoworkerPayloadSignature(currentLocalPayload)
      : null;
    const hasUnsavedLocalChanges =
      currentLocalSignature !== null &&
      lastSavedPayloadRef.current !== null &&
      currentLocalSignature !== lastSavedPayloadRef.current;
    const coworkerUpdatedAt = toCoworkerUpdatedAt(coworker.updatedAt);
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
    allIntegrationTypes,
    applyEditorPayload,
    applyScheduleState,
    coworker,
    getCoworkerUpdateInput,
  ]);

  useEffect(() => {
    if (!hasInitializedEditorRef.current || !coworkerId) {
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
    allowedSkillSlugs,
    allowedWorkspaceMcpServerIds,
    autoApprove,
    buildSchedule,
    coworkerId,
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
  ]);

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
          lastSavedPayloadRef.current = buildCoworkerPayloadSignature(nextSavedPayload);
        }
      }

      const retryRefetch = async (attempt: number): Promise<void> => {
        const result = await refetchCoworker();
        const refetchedCoworker = result.data;
        const refetchedUpdatedAt = refetchedCoworker?.updatedAt
          ? toCoworkerUpdatedAt(refetchedCoworker.updatedAt)
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
    [coworkerId, getCoworkerUpdateInput, prompt, refetchCoworker],
  );

  const setModelSelection = useCallback(
    (input: { model: string; authSource?: ProviderAuthSource | null }) => {
      setModel(input.model);
      setModelAuthSource(input.authSource ?? null);
    },
    [],
  );

  const toggleIntegration = useCallback((type: IntegrationType) => {
    setAllowedIntegrations((prev) =>
      prev.includes(type) ? prev.filter((value) => value !== type) : [...prev, type],
    );
  }, []);

  const selectAllIntegrations = useCallback(() => {
    setAllowedIntegrations(allIntegrationTypes);
  }, [allIntegrationTypes]);

  const clearIntegrations = useCallback(() => {
    setAllowedIntegrations([]);
  }, []);

  const toggleSkill = useCallback((skillKey: string) => {
    setAllowedSkillSlugs((current) =>
      current.includes(skillKey)
        ? current.filter((value) => value !== skillKey)
        : [...current, skillKey],
    );
  }, []);

  const clearSkills = useCallback(() => {
    setAllowedSkillSlugs([]);
  }, []);

  const toggleWorkspaceMcpServer = useCallback((serverId: string) => {
    setAllowedWorkspaceMcpServerIds((current) =>
      current.includes(serverId)
        ? current.filter((value) => value !== serverId)
        : [...current, serverId],
    );
  }, []);

  const clearWorkspaceMcpServers = useCallback(() => {
    setAllowedWorkspaceMcpServerIds([]);
  }, []);

  const setStatusFromChecked = useCallback((checked: boolean) => {
    setStatus(checked ? "on" : "off");
  }, []);

  const setIntervalHours = useCallback((value: number) => {
    setIntervalMinutes(Math.max(1, value) * 60);
  }, []);

  const toggleWeekDay = useCallback((dayIndex: number) => {
    setScheduleDaysOfWeek((prev) =>
      prev.includes(dayIndex)
        ? prev.filter((value) => value !== dayIndex)
        : [...prev, dayIndex].toSorted(),
    );
  }, []);

  return {
    draft: {
      name,
      description,
      username,
      triggerType,
      prompt,
      model,
      modelAuthSource,
      toolAccessMode,
      allowedIntegrations,
      allowedWorkspaceMcpServerIds,
      allowedSkillSlugs,
      status,
      autoApprove,
      requiresUserInput,
      userInputPrompt,
      scheduleType,
      intervalMinutes,
      scheduleTime,
      scheduleDaysOfWeek,
      scheduleDayOfMonth,
      scheduleTimezone,
    },
    actions: {
      setName,
      setDescription,
      setUsername,
      setTriggerType,
      setPrompt,
      setModelSelection,
      setToolAccessMode,
      setAllowedIntegrations,
      toggleIntegration,
      selectAllIntegrations,
      clearIntegrations,
      toggleSkill,
      clearSkills,
      toggleWorkspaceMcpServer,
      clearWorkspaceMcpServers,
      setStatusFromChecked,
      setAutoApprove,
      setRequiresUserInput,
      setUserInputPrompt,
      setScheduleType,
      setIntervalHours,
      setScheduleTime,
      toggleWeekDay,
      setScheduleDayOfMonth,
    },
    isSaving,
    persistCoworker,
    handleCoworkerSyncFromChat,
  };
}
