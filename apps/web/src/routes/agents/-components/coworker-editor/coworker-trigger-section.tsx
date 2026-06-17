import { EMAIL_FORWARDED_TRIGGER_TYPE } from "@bap/core/lib/email-forwarding";
import { T, useGT, useMessages } from "gt-react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { CoworkerForwardingAlias, CoworkerScheduleType } from "./types";

const scheduleMotionInitial = { opacity: 0, y: -8, height: 0 } as const;
const scheduleMotionAnimate = { opacity: 1, y: 0, height: "auto" } as const;
const scheduleMotionExit = { opacity: 0, y: -8, height: 0 } as const;
const scheduleMotionTransition = { duration: 0.22, ease: "easeOut" } as const;
const scheduleMotionStyle = { overflow: "hidden" } as const;
const sectionMotionInitial = { height: 0, opacity: 0 } as const;
const sectionMotionAnimate = { height: "auto" as const, opacity: 1 } as const;
const sectionMotionExit = { height: 0, opacity: 0 } as const;
const sectionMotionTransition = { duration: 0.2 } as const;

type CoworkerTriggerSectionProps = {
  triggerType: string;
  triggers: readonly { value: string; label: string }[];
  scheduleType: CoworkerScheduleType;
  intervalMinutes: number;
  scheduleTime: string;
  scheduleDaysOfWeek: number[];
  scheduleDayOfMonth: number;
  localTimezone: string;
  requiresUserInput: boolean;
  userInputPrompt: string;
  hasActiveForwardingAlias: boolean;
  coworkerForwardingAddress: string | null;
  coworkerForwardingAlias: CoworkerForwardingAlias | undefined;
  isEmailTriggerPersisted: boolean;
  copiedForwardingField: "coworkerAlias" | "invokeHandle" | null;
  createForwardingAlias: { isPending: boolean };
  disableForwardingAlias: { isPending: boolean };
  rotateForwardingAlias: { isPending: boolean };
  onTriggerTypeChange: (value: string) => void;
  onScheduleTypeChange: (value: string) => void;
  onIntervalHoursChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onScheduleTimeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleWeekDay: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onScheduleDayOfMonthChange: (value: string) => void;
  onRequiresUserInputChange: (checked: boolean) => void;
  onUserInputPromptChange: (value: string) => void;
  onCopyCoworkerAlias: () => void;
  onRotateCoworkerAlias: () => void;
  onDisableCoworkerAlias: () => void;
  onCreateCoworkerAlias: () => void;
};

export function CoworkerTriggerSection({
  triggerType,
  triggers,
  scheduleType,
  intervalMinutes,
  scheduleTime,
  scheduleDaysOfWeek,
  scheduleDayOfMonth,
  localTimezone,
  requiresUserInput,
  userInputPrompt,
  hasActiveForwardingAlias,
  coworkerForwardingAddress,
  coworkerForwardingAlias,
  isEmailTriggerPersisted,
  copiedForwardingField,
  createForwardingAlias,
  disableForwardingAlias,
  rotateForwardingAlias,
  onTriggerTypeChange,
  onScheduleTypeChange,
  onIntervalHoursChange,
  onScheduleTimeChange,
  onToggleWeekDay,
  onScheduleDayOfMonthChange,
  onRequiresUserInputChange,
  onUserInputPromptChange,
  onCopyCoworkerAlias,
  onRotateCoworkerAlias,
  onDisableCoworkerAlias,
  onCreateCoworkerAlias,
}: CoworkerTriggerSectionProps) {
  const t = useGT();
  const m = useMessages();
  const [triggerExpanded, setTriggerExpanded] = useState(false);
  const handleToggleTriggerExpanded = useCallback(() => {
    setTriggerExpanded((value) => !value);
  }, []);
  const handleUserInputPromptChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onUserInputPromptChange(event.target.value);
    },
    [onUserInputPromptChange],
  );

  return (
    <div className="border-border/20 rounded-xl border">
      <button
        type="button"
        className="hover:bg-muted/20 flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-colors"
        onClick={handleToggleTriggerExpanded}
      >
        <div>
          <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            <T>Trigger</T>
          </span>
          <p className="text-foreground mt-0.5 text-sm">
            {m(triggers.find((trigger) => trigger.value === triggerType)?.label ?? "Manual only")}
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
                  <SelectValue placeholder={t("Select a trigger")} />
                </SelectTrigger>
                <SelectContent>
                  {triggers.map((trigger) => (
                    <SelectItem key={trigger.value} value={trigger.value}>
                      {m(trigger.label)}
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
                    <ScheduleSettings
                      scheduleType={scheduleType}
                      intervalMinutes={intervalMinutes}
                      scheduleTime={scheduleTime}
                      scheduleDaysOfWeek={scheduleDaysOfWeek}
                      scheduleDayOfMonth={scheduleDayOfMonth}
                      localTimezone={localTimezone}
                      onScheduleTypeChange={onScheduleTypeChange}
                      onIntervalHoursChange={onIntervalHoursChange}
                      onScheduleTimeChange={onScheduleTimeChange}
                      onToggleWeekDay={onToggleWeekDay}
                      onScheduleDayOfMonthChange={onScheduleDayOfMonthChange}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {triggerType === EMAIL_FORWARDED_TRIGGER_TYPE && (
                <ForwardingAliasSettings
                  hasActiveForwardingAlias={hasActiveForwardingAlias}
                  coworkerForwardingAddress={coworkerForwardingAddress}
                  coworkerForwardingAlias={coworkerForwardingAlias}
                  isEmailTriggerPersisted={isEmailTriggerPersisted}
                  copiedForwardingField={copiedForwardingField}
                  createForwardingAlias={createForwardingAlias}
                  disableForwardingAlias={disableForwardingAlias}
                  rotateForwardingAlias={rotateForwardingAlias}
                  onCopyCoworkerAlias={onCopyCoworkerAlias}
                  onRotateCoworkerAlias={onRotateCoworkerAlias}
                  onDisableCoworkerAlias={onDisableCoworkerAlias}
                  onCreateCoworkerAlias={onCreateCoworkerAlias}
                />
              )}

              <NeedsUserInputSettings
                requiresUserInput={requiresUserInput}
                userInputPrompt={userInputPrompt}
                onRequiresUserInputChange={onRequiresUserInputChange}
                onUserInputPromptChange={handleUserInputPromptChange}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ScheduleSettings({
  scheduleType,
  intervalMinutes,
  scheduleTime,
  scheduleDaysOfWeek,
  scheduleDayOfMonth,
  localTimezone,
  onScheduleTypeChange,
  onIntervalHoursChange,
  onScheduleTimeChange,
  onToggleWeekDay,
  onScheduleDayOfMonthChange,
}: {
  scheduleType: CoworkerScheduleType;
  intervalMinutes: number;
  scheduleTime: string;
  scheduleDaysOfWeek: number[];
  scheduleDayOfMonth: number;
  localTimezone: string;
  onScheduleTypeChange: (value: string) => void;
  onIntervalHoursChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onScheduleTimeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleWeekDay: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onScheduleDayOfMonthChange: (value: string) => void;
}) {
  const t = useGT();

  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-medium">
          <T>Frequency</T>
        </label>
        <Select value={scheduleType} onValueChange={onScheduleTypeChange}>
          <SelectTrigger className="bg-background h-9 w-full text-sm">
            <SelectValue placeholder={t("Select frequency")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="interval">
              <T>Every X hours</T>
            </SelectItem>
            <SelectItem value="daily">
              <T>Daily</T>
            </SelectItem>
            <SelectItem value="weekly">
              <T>Weekly</T>
            </SelectItem>
            <SelectItem value="monthly">
              <T>Monthly</T>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {scheduleType === "interval" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium">
            <T>Run every</T>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={168}
              aria-label={t("Run every hours")}
              className="bg-background h-9 w-20 rounded-md border px-3 text-sm"
              value={Math.max(1, Math.round(intervalMinutes / 60))}
              onChange={onIntervalHoursChange}
            />
            <span className="text-muted-foreground text-xs">
              <T>hours</T>
            </span>
          </div>
        </div>
      )}

      {(scheduleType === "daily" || scheduleType === "weekly" || scheduleType === "monthly") && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium">
            <T>Time (</T>
            {localTimezone})
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
          <label className="text-xs font-medium">
            <T>Days of the week</T>
          </label>
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
          <label className="text-xs font-medium">
            <T>Day of the month</T>
          </label>
          <Select value={String(scheduleDayOfMonth)} onValueChange={onScheduleDayOfMonthChange}>
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
    </>
  );
}

function ForwardingAliasSettings({
  hasActiveForwardingAlias,
  coworkerForwardingAddress,
  coworkerForwardingAlias,
  isEmailTriggerPersisted,
  copiedForwardingField,
  createForwardingAlias,
  disableForwardingAlias,
  rotateForwardingAlias,
  onCopyCoworkerAlias,
  onRotateCoworkerAlias,
  onDisableCoworkerAlias,
  onCreateCoworkerAlias,
}: {
  hasActiveForwardingAlias: boolean;
  coworkerForwardingAddress: string | null;
  coworkerForwardingAlias: CoworkerForwardingAlias | undefined;
  isEmailTriggerPersisted: boolean;
  copiedForwardingField: "coworkerAlias" | "invokeHandle" | null;
  createForwardingAlias: { isPending: boolean };
  disableForwardingAlias: { isPending: boolean };
  rotateForwardingAlias: { isPending: boolean };
  onCopyCoworkerAlias: () => void;
  onRotateCoworkerAlias: () => void;
  onDisableCoworkerAlias: () => void;
  onCreateCoworkerAlias: () => void;
}) {
  const t = useGT();

  return (
    <div className="bg-muted/20 space-y-3 rounded-lg border p-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">
          <T>Forwarding address</T>
        </label>
        {hasActiveForwardingAlias ? (
          <div className="flex flex-col gap-2">
            <Input
              type="text"
              value={coworkerForwardingAddress ?? ""}
              disabled
              className="bg-background/60 font-mono text-xs"
              placeholder={t("Set RESEND_RECEIVING_DOMAIN to enable forwarding aliases")}
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
                <T>Rotate</T>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onDisableCoworkerAlias}
                disabled={disableForwardingAlias.isPending}
              >
                <T>Disable</T>
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
              placeholder={t("No forwarding address yet")}
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
              <T>Create email</T>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function NeedsUserInputSettings({
  requiresUserInput,
  userInputPrompt,
  onRequiresUserInputChange,
  onUserInputPromptChange,
}: {
  requiresUserInput: boolean;
  userInputPrompt: string;
  onRequiresUserInputChange: (checked: boolean) => void;
  onUserInputPromptChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="border-border/40 space-y-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <label className="text-xs font-medium">
            <T>Needs your input</T>
          </label>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            <T>Ask a first question in chat before this trigger starts a run.</T>
          </p>
        </div>
        <Switch checked={requiresUserInput} onCheckedChange={onRequiresUserInputChange} />
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
              <label className="text-xs font-medium">
                <T>Question to ask</T>
              </label>
              <textarea
                value={userInputPrompt}
                onChange={onUserInputPromptChange}
                maxLength={1000}
                aria-label="Question to ask"
                placeholder="Which email address should I send the draft to?"
                className="bg-background text-foreground placeholder:text-muted-foreground/60 focus:ring-ring/40 min-h-[78px] w-full resize-none rounded-md border px-3 py-2 text-sm leading-relaxed focus:ring-2 focus:outline-none"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
