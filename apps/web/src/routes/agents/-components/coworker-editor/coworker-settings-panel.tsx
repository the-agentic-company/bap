import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { T, useGT } from "gt-react";
import {
  AlertTriangle,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AnimatedTab, AnimatedTabs } from "@/components/ui/tabs";
import type { IntegrationType } from "@/lib/integration-icons";
import type { ProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import { cn } from "@/lib/utils";
import { CoworkerDocumentsPanel } from "./coworker-documents-panel";
import { DeleteCoworkerDialog } from "./coworker-editor-layout";
import { CoworkerInstructionsPanel } from "./coworker-instructions-panel";
import { CoworkerToolboxPanel } from "./coworker-toolbox-panel";
import type {
  AvailableSkillEntry,
  CoworkerDocumentRecord,
  CoworkerForwardingAlias,
  CoworkerRunListItem,
  CoworkerScheduleType,
  CoworkerTab,
  IntegrationEntry,
  WorkspaceMcpServerEntry,
} from "./types";

const statusTextMotionInitial = { opacity: 0, y: -4 } as const;
const statusTextMotionAnimate = { opacity: 1, y: 0 } as const;
const statusTextMotionExit = { opacity: 0, y: 4 } as const;
const statusTextMotionTransition = { duration: 0.15 } as const;
const COWORKER_RUN_BACKLOG_LIMIT = 5;
const COWORKER_RUN_BACKLOG_STATUSES = new Set([
  "needs_user_input",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);

type CoworkerSettingsPanelProps = {
  coworkerId?: string;
  coworkerRouteSlug?: string;
  name: string;
  description: string;
  username: string;
  isSaving: boolean;
  status: "on" | "off";
  disabledReason: "run_backlog_limit" | null;
  disabledAt: Date | string | null;
  autoApprove: boolean;
  requiresUserInput: boolean;
  userInputPrompt: string;
  prompt: string;
  model: string;
  modelAuthSource: ProviderAuthSource | null;
  providerAvailability: ProviderAuthAvailabilityByProvider;
  availableSkills: AvailableSkillEntry[];
  selectedSkillKeys: string[];
  executorSourceEntries: WorkspaceMcpServerEntry[];
  selectedWorkspaceMcpServerIds: string[];
  isSkillsLoading: boolean;
  restrictTools: boolean;
  allowedIntegrations: IntegrationType[];
  allIntegrationTypes: IntegrationType[];
  integrationEntries: IntegrationEntry[];
  triggerType: string;
  triggers: readonly { value: string; label: string }[];
  scheduleType: CoworkerScheduleType;
  intervalMinutes: number;
  scheduleTime: string;
  scheduleDaysOfWeek: number[];
  scheduleDayOfMonth: number;
  localTimezone: string;
  hasActiveForwardingAlias: boolean;
  coworkerForwardingAddress: string | null;
  coworkerForwardingAlias: CoworkerForwardingAlias | undefined;
  isEmailTriggerPersisted: boolean;
  copiedForwardingField: "coworkerAlias" | "invokeHandle" | null;
  documents: CoworkerDocumentRecord[];
  runs: CoworkerRunListItem[] | undefined;
  activeTab: CoworkerTab;
  isRunDisabled: boolean;
  isRunning: boolean;
  isResettingRuns: boolean;
  isUploadingDocuments: boolean;
  deletingDocumentIds: string[];
  downloadingDocumentIds: string[];
  createForwardingAlias: { isPending: boolean };
  disableForwardingAlias: { isPending: boolean };
  rotateForwardingAlias: { isPending: boolean };
  onUploadDocuments: (files: FileList | File[]) => void | Promise<void>;
  onDownloadDocument: (
    document: CoworkerDocumentRecord,
  ) => void | Promise<void>;
  onDeleteDocument: (document: CoworkerDocumentRecord) => void | Promise<void>;
  onTabChange: (tab: CoworkerTab) => void;
  onRun: (event: React.MouseEvent) => void;
  onResetRunsAndEnable: () => void | Promise<void>;
  onNameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDescriptionChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onUsernameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onStatusChange: (checked: boolean) => void;
  onAutoApproveChange: (checked: boolean) => void;
  onRequiresUserInputChange: (checked: boolean) => void;
  onUserInputPromptChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSaveInstructions: () => void | Promise<void>;
  onModelChange: (input: {
    model: string;
    authSource?: ProviderAuthSource | null;
  }) => void;
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
  onIntervalHoursChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onScheduleTimeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleWeekDay: (event: React.MouseEvent<HTMLButtonElement>) => void;
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
  renderAdminContent?: () => React.ReactNode;
};

export function CoworkerSettingsPanel({
  coworkerId,
  coworkerRouteSlug,
  name,
  description,
  username,
  isSaving,
  status,
  disabledReason,
  disabledAt,
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
  isRunDisabled,
  isRunning,
  isResettingRuns,
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
  onResetRunsAndEnable,
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
  renderAdminContent,
}: CoworkerSettingsPanelProps) {
  const t = useGT();

  const handleOpenDeleteDialog = useCallback(() => {
    onShowDeleteDialogChange(true);
  }, [onShowDeleteDialogChange]);

  const handleTabChange = useCallback(
    (key: string) => {
      onTabChange(key as CoworkerTab);
    },
    [onTabChange],
  );
  const adminContent = renderAdminContent?.();
  const backlogRunCount =
    runs?.filter((run) => COWORKER_RUN_BACKLOG_STATUSES.has(run.status))
      .length ?? 0;
  const shouldShowRunBacklogNotice =
    disabledReason === "run_backlog_limit" ||
    backlogRunCount >= COWORKER_RUN_BACKLOG_LIMIT;
  const disabledAtLabel = disabledAt
    ? new Date(disabledAt).toLocaleString()
    : null;
  const handleStatusSwitchChange = useCallback(
    (checked: boolean) => {
      if (checked && shouldShowRunBacklogNotice) {
        void onResetRunsAndEnable();
        return;
      }

      onStatusChange(checked);
    },
    [onResetRunsAndEnable, onStatusChange, shouldShowRunBacklogNotice],
  );

  return (
    <div className="flex h-full flex-col">
      {!hideHeader && (
        <div className="bg-background/95 border-border/60 flex h-12 items-center border-b px-4 py-2 backdrop-blur-sm">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <AnimatedTabs
                activeKey={activeTab}
                onTabChange={handleTabChange}
                className="gap-1"
              >
                <AnimatedTab value="instruction">
                  <T>Instruction</T>
                </AnimatedTab>
                <AnimatedTab value="docs">
                  <T>Docs</T>
                </AnimatedTab>
                <AnimatedTab value="toolbox">
                  <T>Toolbox</T>
                </AnimatedTab>
                {showAdminTab ? (
                  <AnimatedTab value="admin">
                    <T>Admin</T>
                  </AnimatedTab>
                ) : null}
              </AnimatedTabs>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isSaving ? (
                <span className="text-muted-foreground shrink-0 text-xs">
                  <T>Saving...</T>
                </span>
              ) : null}
              <div className="bg-muted/60 flex items-center gap-1.5 rounded-full px-2.5 py-1">
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
                <Switch
                  checked={status === "on"}
                  onCheckedChange={handleStatusSwitchChange}
                  disabled={isResettingRuns}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-xl px-3 text-xs font-medium"
                onClick={onRun}
                disabled={isRunDisabled}
              >
                {isRunning ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                <T>Run now</T>
              </Button>
              <button
                type="button"
                onClick={handleOpenDeleteDialog}
                className="text-muted-foreground hover:text-destructive hover:bg-muted flex h-8 w-8 items-center justify-center rounded-xl transition-colors"
                aria-label={t("Delete coworker")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              {showCloseButton ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted flex h-8 w-8 items-center justify-center rounded-xl transition-colors"
                  aria-label={t("Close panel")}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              <DeleteCoworkerDialog
                open={showDeleteDialog}
                isDeleting={isDeleting}
                onOpenChange={onShowDeleteDialogChange}
                onDelete={onDelete}
              />
            </div>
          </div>
        </div>
      )}
      {shouldShowRunBacklogNotice ? (
        <div className="border-border bg-muted/40 border-y px-3 py-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="text-foreground text-xs font-medium">
                  <T>Automated triggers are disabled</T>
                </p>
                <p className="text-muted-foreground text-xs">
                  <T>
                    Bap stopped this coworker because 5 runs were waiting for
                    human input.
                  </T>
                </p>
                {disabledAtLabel ? (
                  <p className="text-muted-foreground/80 mt-0.5 text-[11px]">
                    <T>Stopped</T> {disabledAtLabel}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={onResetRunsAndEnable}
                disabled={isResettingRuns}
              >
                {isResettingRuns ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                <T>Reset and enable</T>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <div className={cn("min-h-0 flex-1", "overflow-y-auto")}>
        {activeTab === "instruction" ? (
          <CoworkerInstructionsPanel
            coworkerId={coworkerId}
            hideHeader={hideHeader}
            name={name}
            username={username}
            description={description}
            prompt={prompt}
            model={model}
            modelAuthSource={modelAuthSource}
            providerAvailability={providerAvailability}
            isSaving={isSaving}
            autoApprove={autoApprove}
            requiresUserInput={requiresUserInput}
            userInputPrompt={userInputPrompt}
            triggerType={triggerType}
            triggers={triggers}
            scheduleType={scheduleType}
            intervalMinutes={intervalMinutes}
            scheduleTime={scheduleTime}
            scheduleDaysOfWeek={scheduleDaysOfWeek}
            scheduleDayOfMonth={scheduleDayOfMonth}
            localTimezone={localTimezone}
            hasActiveForwardingAlias={hasActiveForwardingAlias}
            coworkerForwardingAddress={coworkerForwardingAddress}
            coworkerForwardingAlias={coworkerForwardingAlias}
            isEmailTriggerPersisted={isEmailTriggerPersisted}
            copiedForwardingField={copiedForwardingField}
            createForwardingAlias={createForwardingAlias}
            disableForwardingAlias={disableForwardingAlias}
            rotateForwardingAlias={rotateForwardingAlias}
            onNameChange={onNameChange}
            onDescriptionChange={onDescriptionChange}
            onUsernameChange={onUsernameChange}
            onAutoApproveChange={onAutoApproveChange}
            onRequiresUserInputChange={onRequiresUserInputChange}
            onUserInputPromptChange={onUserInputPromptChange}
            onPromptChange={onPromptChange}
            onSaveInstructions={onSaveInstructions}
            onModelChange={onModelChange}
            onTriggerTypeChange={onTriggerTypeChange}
            onScheduleTypeChange={onScheduleTypeChange}
            onIntervalHoursChange={onIntervalHoursChange}
            onScheduleTimeChange={onScheduleTimeChange}
            onToggleWeekDay={onToggleWeekDay}
            onScheduleDayOfMonthChange={onScheduleDayOfMonthChange}
            onCopyCoworkerAlias={onCopyCoworkerAlias}
            onRotateCoworkerAlias={onRotateCoworkerAlias}
            onDisableCoworkerAlias={onDisableCoworkerAlias}
            onCreateCoworkerAlias={onCreateCoworkerAlias}
          />
        ) : null}
        {activeTab === "docs" ? (
          <CoworkerDocumentsPanel
            documents={documents}
            isUploadingDocuments={isUploadingDocuments}
            deletingDocumentIds={deletingDocumentIds}
            downloadingDocumentIds={downloadingDocumentIds}
            onUploadDocuments={onUploadDocuments}
            onDownloadDocument={onDownloadDocument}
            onDeleteDocument={onDeleteDocument}
          />
        ) : null}
        {activeTab === "toolbox" ? (
          <CoworkerToolboxPanel
            restrictTools={restrictTools}
            allowedIntegrations={allowedIntegrations}
            allIntegrationTypes={allIntegrationTypes}
            integrationEntries={integrationEntries}
            availableSkills={availableSkills}
            selectedSkillKeys={selectedSkillKeys}
            workspaceMcpServerEntries={executorSourceEntries}
            selectedWorkspaceMcpServerIds={selectedWorkspaceMcpServerIds}
            isSkillsLoading={isSkillsLoading}
            onRestrictToolsChange={onRestrictToolsChange}
            onSelectAllIntegrations={onSelectAllIntegrations}
            onClearIntegrations={onClearIntegrations}
            onToggleIntegrationChecked={onToggleIntegrationChecked}
            onClearSkills={onClearSkills}
            onToggleSkillChecked={onToggleSkillChecked}
            onClearWorkspaceMcpServers={onClearWorkspaceMcpServers}
            onToggleWorkspaceMcpServerChecked={
              onToggleWorkspaceMcpServerChecked
            }
          />
        ) : null}
        {activeTab === "admin" ? (
          <div className="px-4 py-3">
            {adminContent ?? (
              <p className="text-xs">
                <T>No admin actions.</T>
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
