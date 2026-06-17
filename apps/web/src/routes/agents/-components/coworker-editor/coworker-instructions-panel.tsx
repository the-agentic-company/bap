import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import { T, useGT } from "gt-react";
import { Loader2, Pencil, Save, X } from "lucide-react";
import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ModelSelector } from "@/components/chat/model-selector";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  MarkdownEditorModeToggle,
  type MarkdownEditorMode,
} from "@/components/ui/markdown-editor-mode-toggle";
import { MilkdownEditor } from "@/components/ui/milkdown-editor";
import { Switch } from "@/components/ui/switch";
import type { ProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import { cn } from "@/lib/utils";
import { CoworkerTriggerSection } from "./coworker-trigger-section";
import type { CoworkerForwardingAlias, CoworkerScheduleType } from "./types";

const instructionRemarkPlugins = [remarkGfm, remarkBreaks];

type CoworkerInstructionsPanelProps = {
  coworkerId?: string;
  hideHeader?: boolean;
  name: string;
  username: string;
  description: string;
  prompt: string;
  model: string;
  modelAuthSource: ProviderAuthSource | null;
  providerAvailability: ProviderAuthAvailabilityByProvider;
  isSaving: boolean;
  autoApprove: boolean;
  requiresUserInput: boolean;
  userInputPrompt: string;
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
  createForwardingAlias: { isPending: boolean };
  disableForwardingAlias: { isPending: boolean };
  rotateForwardingAlias: { isPending: boolean };
  onNameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDescriptionChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onUsernameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAutoApproveChange: (checked: boolean) => void;
  onRequiresUserInputChange: (checked: boolean) => void;
  onUserInputPromptChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSaveInstructions: () => void | Promise<void>;
  onModelChange: (input: { model: string; authSource?: ProviderAuthSource | null }) => void;
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
};

export function CoworkerInstructionsPanel({
  coworkerId,
  hideHeader,
  name,
  username,
  description,
  prompt,
  model,
  modelAuthSource,
  providerAvailability,
  isSaving,
  autoApprove,
  requiresUserInput,
  userInputPrompt,
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
  createForwardingAlias,
  disableForwardingAlias,
  rotateForwardingAlias,
  onNameChange,
  onDescriptionChange,
  onUsernameChange,
  onAutoApproveChange,
  onRequiresUserInputChange,
  onUserInputPromptChange,
  onPromptChange,
  onSaveInstructions,
  onModelChange,
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
}: CoworkerInstructionsPanelProps) {
  const t = useGT();
  const [instructionModalOpen, setInstructionModalOpen] = useState(false);
  const [instructionEditorMode, setInstructionEditorMode] = useState<MarkdownEditorMode>("wysiwyg");

  const handleOpenInstructionModal = useCallback(() => {
    setInstructionModalOpen(true);
  }, []);

  const handleCloseInstructionModal = useCallback(() => {
    setInstructionModalOpen(false);
  }, []);

  const handleRawPromptChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onPromptChange(event.target.value);
    },
    [onPromptChange],
  );

  const handleUserInputPromptChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onUserInputPromptChange(event.target.value);
    },
    [onUserInputPromptChange],
  );

  return (
    <div className="space-y-3 px-4 py-3">
      <div className={cn("gap-3", hideHeader ? "flex flex-col" : "grid grid-cols-2")}>
        <div className="px-1 py-1">
          <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            <T>Name</T>
          </label>
          <Input
            value={name}
            onChange={onNameChange}
            placeholder={t("New Coworker")}
            className="mt-1.5 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="px-1 py-1">
          <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            <T>Username</T>
          </label>
          <div className="mt-1.5 flex items-center">
            <span className="text-muted-foreground text-sm">@</span>
            <Input
              value={username}
              onChange={onUsernameChange}
              placeholder={t("my-coworker")}
              className="border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
      </div>

      <InstructionPreview prompt={prompt} onOpenInstructionModal={handleOpenInstructionModal} />

      <div className="border-border/30 rounded-xl border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              <T>Require parameter</T>
            </span>
          </div>
          <Switch
            checked={requiresUserInput}
            onCheckedChange={onRequiresUserInputChange}
            aria-label={t("Require parameter")}
          />
        </div>
        {requiresUserInput && (
          <label className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed">
            <span className="text-muted-foreground shrink-0">
              <T>Parameter prompt:</T>
            </span>
            <textarea
              value={userInputPrompt}
              onChange={handleUserInputPromptChange}
              maxLength={1000}
              aria-label={t("Parameter prompt")}
              placeholder={t("What name should I use for the greeting?")}
              className="text-foreground placeholder:text-muted-foreground/60 min-h-[44px] flex-1 resize-none bg-transparent leading-relaxed focus:outline-none"
            />
          </label>
        )}
      </div>

      <InstructionEditorDialog
        open={instructionModalOpen}
        hideHeader={hideHeader}
        mode={instructionEditorMode}
        prompt={prompt}
        isSaving={isSaving}
        coworkerId={coworkerId}
        onOpenChange={setInstructionModalOpen}
        onModeChange={setInstructionEditorMode}
        onClose={handleCloseInstructionModal}
        onPromptChange={onPromptChange}
        onRawPromptChange={handleRawPromptChange}
        onSaveInstructions={onSaveInstructions}
      />

      <CoworkerTriggerSection
        triggerType={triggerType}
        triggers={triggers}
        scheduleType={scheduleType}
        intervalMinutes={intervalMinutes}
        scheduleTime={scheduleTime}
        scheduleDaysOfWeek={scheduleDaysOfWeek}
        scheduleDayOfMonth={scheduleDayOfMonth}
        localTimezone={localTimezone}
        requiresUserInput={requiresUserInput}
        userInputPrompt={userInputPrompt}
        hasActiveForwardingAlias={hasActiveForwardingAlias}
        coworkerForwardingAddress={coworkerForwardingAddress}
        coworkerForwardingAlias={coworkerForwardingAlias}
        isEmailTriggerPersisted={isEmailTriggerPersisted}
        copiedForwardingField={copiedForwardingField}
        createForwardingAlias={createForwardingAlias}
        disableForwardingAlias={disableForwardingAlias}
        rotateForwardingAlias={rotateForwardingAlias}
        onTriggerTypeChange={onTriggerTypeChange}
        onScheduleTypeChange={onScheduleTypeChange}
        onIntervalHoursChange={onIntervalHoursChange}
        onScheduleTimeChange={onScheduleTimeChange}
        onToggleWeekDay={onToggleWeekDay}
        onScheduleDayOfMonthChange={onScheduleDayOfMonthChange}
        onRequiresUserInputChange={onRequiresUserInputChange}
        onUserInputPromptChange={onUserInputPromptChange}
        onCopyCoworkerAlias={onCopyCoworkerAlias}
        onRotateCoworkerAlias={onRotateCoworkerAlias}
        onDisableCoworkerAlias={onDisableCoworkerAlias}
        onCreateCoworkerAlias={onCreateCoworkerAlias}
      />

      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            <T>Approval policy</T>
          </span>
          <p className="text-foreground mt-0.5 text-sm">
            {autoApprove ? <T>Auto-approve all write actions</T> : <T>Manual approval required</T>}
          </p>
        </div>
        <Switch checked={autoApprove} onCheckedChange={onAutoApproveChange} />
      </div>

      <div className="px-4 py-3">
        <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          <T>Description</T>
        </label>
        <textarea
          className="text-foreground placeholder:text-muted-foreground/60 mt-1.5 min-h-[80px] w-full resize-none bg-transparent text-sm leading-relaxed focus:outline-none"
          value={description}
          onChange={onDescriptionChange}
          aria-label={t("Description")}
          placeholder={t("What does this coworker do?")}
        />
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          <T>Model</T>
        </span>
        <ModelSelector
          selectedModel={model}
          selectedAuthSource={modelAuthSource}
          providerAvailability={providerAvailability}
          onSelectionChange={onModelChange}
        />
      </div>
    </div>
  );
}

function InstructionPreview({
  prompt,
  onOpenInstructionModal,
}: {
  prompt: string;
  onOpenInstructionModal: () => void;
}) {
  return (
    <button
      type="button"
      className="group border-border/30 hover:border-border/50 hover:bg-muted/20 relative w-full cursor-pointer rounded-xl border p-4 text-left transition-all"
      onClick={onOpenInstructionModal}
      aria-label="Edit instructions"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          <T>Instructions</T>
        </span>
        <span className="text-muted-foreground group-hover:text-foreground flex items-center gap-1 text-xs transition-colors">
          <Pencil className="h-3 w-3" />
          <T>Edit</T>
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
          <T>Your new coworker&apos;s instructions will appear here</T>
        </p>
      )}
    </button>
  );
}

function InstructionEditorDialog({
  open,
  hideHeader,
  mode,
  prompt,
  isSaving,
  coworkerId,
  onOpenChange,
  onModeChange,
  onClose,
  onPromptChange,
  onRawPromptChange,
  onSaveInstructions,
}: {
  open: boolean;
  hideHeader?: boolean;
  mode: MarkdownEditorMode;
  prompt: string;
  isSaving: boolean;
  coworkerId?: string;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: MarkdownEditorMode) => void;
  onClose: () => void;
  onPromptChange: (value: string) => void;
  onRawPromptChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSaveInstructions: () => void | Promise<void>;
}) {
  const t = useGT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <DialogTitle className="text-sm font-semibold">
            <T>Edit instructions</T>
          </DialogTitle>
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
            <MarkdownEditorModeToggle mode={mode} onModeChange={onModeChange} />
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground hover:bg-muted flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              aria-label={t("Close editor")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>
        {mode === "source" ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <textarea
              className="text-foreground placeholder:text-muted-foreground/50 flex-1 resize-none overflow-y-auto overscroll-contain bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed focus:outline-none"
              value={prompt}
              onChange={onRawPromptChange}
              aria-label={t("Instruction source")}
              placeholder={
                "Your new coworker's instructions will appear here\n\nYou can use markdown for formatting:\n- **Bold** for emphasis\n- `code` for technical terms\n- Lists for step-by-step instructions"
              }
              autoFocus
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <MilkdownEditor
              value={prompt}
              onChange={onPromptChange}
              placeholder={t("Your new coworker's instructions will appear here...")}
              autoFocus
              className="h-full"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
