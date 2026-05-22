"use client";

import { Play, RotateCcw, Shield } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DebugScenarioKey = "approval" | "auth" | "question" | "runtime";

export type ArmedDebugPreset = {
  key: DebugScenarioKey;
  label: string;
  prompt: string;
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
};

export type ChatDebugSnapshot = {
  conversationId?: string | null;
  generationId?: string | null;
  runtimeId?: string | null;
  sandboxProvider?: "e2b" | "daytona" | "docker" | null;
  sandboxId?: string | null;
  sessionId?: string | null;
  status?: string | null;
  pauseReason?: string | null;
  lastParkedStatus?: string | null;
  releasedSandboxId?: string | null;
};

type Props = {
  armedPreset: ArmedDebugPreset | null;
  snapshot: ChatDebugSnapshot;
  disabled?: boolean;
  triggerClassName?: string;
  enabledScenarios?: readonly DebugScenarioKey[];
  introText?: string;
  promptOverrides?: Partial<Record<DebugScenarioKey, string>>;
  labelOverrides?: Partial<Record<DebugScenarioKey, string>>;
  descriptionOverrides?: Partial<Record<DebugScenarioKey, string>>;
  onArmPreset: (preset: ArmedDebugPreset) => void;
  onClearPreset: () => void;
  onResumeRunDeadline: () => void;
  isResumingRunDeadline?: boolean;
};

const DEFAULT_APPROVAL_SECONDS = "5";
const DEFAULT_AUTH_SECONDS = "5";
const DEFAULT_QUESTION_SECONDS = "5";
const DEFAULT_RUNTIME_SECONDS = "30";

const PROMPTS: Record<DebugScenarioKey, string> = {
  approval: "send a message on slack #experiment-cmdclaw-testing saying hi",
  auth: "Use the Notion integration to list my first 5 Notion databases by name. Do not use any other source.",
  question:
    "Use the question tool exactly once with header 'Pick', question 'Choose one', and options 'Alpha' and 'Beta'. After I answer, respond exactly as SELECTED=<answer>.",
  runtime:
    "analyze my last 30 emails and classify them as urgent with a summary of next action point to do",
};

const DESCRIPTIONS: Record<DebugScenarioKey, string> = {
  approval: "Slack write approval repro",
  auth: "Disconnected Notion auth repro",
  question: "Runtime question repro",
  runtime: "Long Gmail analysis repro",
};

const TITLES: Record<DebugScenarioKey, string> = {
  approval: "Approval Recovery",
  auth: "Auth Recovery",
  question: "Question Recovery",
  runtime: "Runtime Deadline",
};

const LABELS: Record<DebugScenarioKey, string> = {
  approval: "Approval",
  auth: "Auth",
  question: "Question",
  runtime: "Runtime",
};

function coerceSeconds(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function formatSandbox(snapshot: ChatDebugSnapshot): string {
  if (!snapshot.sandboxId) {
    return "-";
  }
  return snapshot.sandboxProvider
    ? `${snapshot.sandboxProvider}:${snapshot.sandboxId}`
    : snapshot.sandboxId;
}

function formatStatus(snapshot: ChatDebugSnapshot): string {
  if (!snapshot.status) {
    return "-";
  }
  if (snapshot.pauseReason) {
    return `${snapshot.status} (${snapshot.pauseReason})`;
  }
  return snapshot.status;
}

export function ChatDebugPopover({
  armedPreset,
  snapshot,
  disabled = false,
  triggerClassName,
  enabledScenarios = ["approval", "auth", "question", "runtime"],
  introText = "Admin-only debug controls for approval, auth, question, and runtime recovery.",
  promptOverrides,
  labelOverrides,
  descriptionOverrides,
  onArmPreset,
  onClearPreset,
  onResumeRunDeadline,
  isResumingRunDeadline = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [approvalSeconds, setApprovalSeconds] = useState(DEFAULT_APPROVAL_SECONDS);
  const [authSeconds, setAuthSeconds] = useState(DEFAULT_AUTH_SECONDS);
  const [questionSeconds, setQuestionSeconds] = useState(DEFAULT_QUESTION_SECONDS);
  const [runtimeSeconds, setRuntimeSeconds] = useState(DEFAULT_RUNTIME_SECONDS);

  const handleApprovalSecondsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setApprovalSeconds(event.target.value);
  }, []);
  const handleAuthSecondsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setAuthSeconds(event.target.value);
  }, []);
  const handleQuestionSecondsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQuestionSeconds(event.target.value);
  }, []);
  const handleRuntimeSecondsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setRuntimeSeconds(event.target.value);
  }, []);

  const handleArmApproval = useCallback(() => {
    const seconds = coerceSeconds(approvalSeconds, 5);
    onArmPreset({
      key: "approval",
      label: labelOverrides?.approval ?? LABELS.approval,
      prompt: promptOverrides?.approval ?? PROMPTS.approval,
      debugApprovalHotWaitMs: seconds * 1000,
    });
    setOpen(false);
  }, [approvalSeconds, labelOverrides?.approval, onArmPreset, promptOverrides?.approval]);

  const handleArmAuth = useCallback(() => {
    const seconds = coerceSeconds(authSeconds, 5);
    onArmPreset({
      key: "auth",
      label: labelOverrides?.auth ?? LABELS.auth,
      prompt: promptOverrides?.auth ?? PROMPTS.auth,
      debugApprovalHotWaitMs: seconds * 1000,
    });
    setOpen(false);
  }, [authSeconds, labelOverrides?.auth, onArmPreset, promptOverrides?.auth]);

  const handleArmQuestion = useCallback(() => {
    const seconds = coerceSeconds(questionSeconds, 5);
    onArmPreset({
      key: "question",
      label: labelOverrides?.question ?? LABELS.question,
      prompt: promptOverrides?.question ?? PROMPTS.question,
      debugApprovalHotWaitMs: seconds * 1000,
    });
    setOpen(false);
  }, [labelOverrides?.question, onArmPreset, promptOverrides?.question, questionSeconds]);

  const handleArmRuntime = useCallback(() => {
    const seconds = coerceSeconds(runtimeSeconds, 30);
    onArmPreset({
      key: "runtime",
      label: labelOverrides?.runtime ?? LABELS.runtime,
      prompt: promptOverrides?.runtime ?? PROMPTS.runtime,
      debugRunDeadlineMs: seconds * 1000,
    });
    setOpen(false);
  }, [labelOverrides?.runtime, onArmPreset, promptOverrides?.runtime, runtimeSeconds]);

  const handleResumeClick = useCallback(() => {
    onResumeRunDeadline();
    setOpen(false);
  }, [onResumeRunDeadline]);

  const canResumeRunDeadline =
    snapshot.status === "paused" &&
    snapshot.pauseReason === "run_deadline" &&
    typeof snapshot.generationId === "string" &&
    snapshot.generationId.length > 0 &&
    !disabled;

  const infoRows = useMemo(
    () => [
      { label: "Conversation", value: snapshot.conversationId ?? "-" },
      { label: "Generation", value: snapshot.generationId ?? "-" },
      { label: "Runtime", value: snapshot.runtimeId ?? "-" },
      { label: "Sandbox", value: formatSandbox(snapshot) },
      { label: "Status", value: formatStatus(snapshot) },
      {
        label: "Last parked",
        value:
          snapshot.lastParkedStatus && snapshot.releasedSandboxId
            ? `${snapshot.lastParkedStatus} (${snapshot.releasedSandboxId})`
            : (snapshot.lastParkedStatus ?? "-"),
      },
    ],
    [snapshot],
  );

  const enabledScenarioSet = useMemo(() => new Set(enabledScenarios), [enabledScenarios]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={armedPreset ? "secondary" : "ghost"}
          size="sm"
          disabled={disabled}
          className={cn("h-9 w-9 rounded-xl p-0", triggerClassName)}
          aria-label={
            armedPreset
              ? `Admin debug controls (${armedPreset.label} armed)`
              : "Admin debug controls"
          }
          title={armedPreset ? `Debug: ${armedPreset.label}` : "Admin debug controls"}
        >
          <Shield className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" sideOffset={8} className="w-[360px] p-3">
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Recovery Presets</div>
            <p className="text-muted-foreground text-xs">{introText}</p>
          </div>

          <div className="space-y-2">
            {enabledScenarioSet.has("approval") ? (
              <div className="rounded-lg border p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{TITLES.approval}</div>
                    <div className="text-muted-foreground text-xs">
                      {descriptionOverrides?.approval ?? DESCRIPTIONS.approval}
                    </div>
                  </div>
                  <Button type="button" size="sm" className="h-8" onClick={handleArmApproval}>
                    Arm
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={approvalSeconds}
                    onChange={handleApprovalSecondsChange}
                    className="h-8"
                  />
                  <span className="text-muted-foreground text-xs">seconds before park</span>
                </div>
              </div>
            ) : null}

            {enabledScenarioSet.has("auth") ? (
              <div className="rounded-lg border p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{TITLES.auth}</div>
                    <div className="text-muted-foreground text-xs">
                      {descriptionOverrides?.auth ?? DESCRIPTIONS.auth}
                    </div>
                  </div>
                  <Button type="button" size="sm" className="h-8" onClick={handleArmAuth}>
                    Arm
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={authSeconds}
                    onChange={handleAuthSecondsChange}
                    className="h-8"
                  />
                  <span className="text-muted-foreground text-xs">seconds before park</span>
                </div>
              </div>
            ) : null}

            {enabledScenarioSet.has("question") ? (
              <div className="rounded-lg border p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{TITLES.question}</div>
                    <div className="text-muted-foreground text-xs">
                      {descriptionOverrides?.question ?? DESCRIPTIONS.question}
                    </div>
                  </div>
                  <Button type="button" size="sm" className="h-8" onClick={handleArmQuestion}>
                    Arm
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={questionSeconds}
                    onChange={handleQuestionSecondsChange}
                    className="h-8"
                  />
                  <span className="text-muted-foreground text-xs">seconds before park</span>
                </div>
              </div>
            ) : null}

            {enabledScenarioSet.has("runtime") ? (
              <div className="rounded-lg border p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{TITLES.runtime}</div>
                    <div className="text-muted-foreground text-xs">
                      {descriptionOverrides?.runtime ?? DESCRIPTIONS.runtime}
                    </div>
                  </div>
                  <Button type="button" size="sm" className="h-8" onClick={handleArmRuntime}>
                    Arm
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={runtimeSeconds}
                    onChange={handleRuntimeSecondsChange}
                    className="h-8"
                  />
                  <span className="text-muted-foreground text-xs">seconds before deadline</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Current Debug State</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={onClearPreset}
                disabled={!armedPreset}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
            <div className="space-y-1.5">
              {infoRows.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <code className="max-w-[220px] text-right break-all">{row.value}</code>
                </div>
              ))}
            </div>

            <div className={cn("mt-3", !canResumeRunDeadline && "hidden")}>
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={handleResumeClick}
                disabled={!canResumeRunDeadline || isResumingRunDeadline}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                {isResumingRunDeadline ? "Resuming..." : "Resume Paused Runtime"}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
