"use client";

import { Check, X, Loader2, Wrench, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useState, useMemo, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getIntegrationLogo,
  getIntegrationDisplayName,
  getIntegrationIcon,
} from "@/lib/integration-icons";
import { parseCliCommand } from "@/lib/parse-cli-command";
import { cn } from "@/lib/utils";
import type { PreviewProps } from "./previews";
import { GenericPreview } from "./previews";
import { AirtablePreview } from "./previews/airtable-preview";
import { CalendarPreview } from "./previews/calendar-preview";
import { DocsPreview } from "./previews/docs-preview";
import { DrivePreview } from "./previews/drive-preview";
import { GithubPreview } from "./previews/github-preview";
import { GmailPreview } from "./previews/gmail-preview";
import { HubspotPreview } from "./previews/hubspot-preview";
import { NotionPreview } from "./previews/notion-preview";
import { SheetsPreview } from "./previews/sheets-preview";
import { SlackPreview } from "./previews/slack-preview";
import { isQuestionApprovalRequest, parseQuestionRequestPayload } from "./question-approval-utils";

export interface ToolApprovalCardProps {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
  questionAnswers?: string[][];
  onApprove: (questionAnswers?: string[][]) => void;
  onDeny: () => void;
  status: "pending" | "approved" | "denied";
  isLoading?: boolean;
  readonly?: boolean;
}

function renderPreview(integration: string, previewProps: PreviewProps) {
  switch (integration) {
    case "slack":
      return <SlackPreview {...previewProps} />;
    case "google_gmail":
    case "outlook":
      return <GmailPreview {...previewProps} />;
    case "outlook_calendar":
      return <CalendarPreview {...previewProps} />;
    case "google_calendar":
      return <CalendarPreview {...previewProps} />;
    case "google_docs":
      return <DocsPreview {...previewProps} />;
    case "google_sheets":
      return <SheetsPreview {...previewProps} />;
    case "google_drive":
      return <DrivePreview {...previewProps} />;
    case "notion":
      return <NotionPreview {...previewProps} />;
    case "github":
      return <GithubPreview {...previewProps} />;
    case "airtable":
      return <AirtablePreview {...previewProps} />;
    case "hubspot":
      return <HubspotPreview {...previewProps} />;
    default:
      return <GenericPreview {...previewProps} />;
  }
}

/** Dot indicator for wizard progress */
function QuestionDots({ total, current }: { total: number; current: number }) {
  if (total <= 1) {
    return null;
  }
  return (
    <div
      className="flex items-center justify-center gap-1.5 pb-2"
      aria-label={`Question ${current + 1} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full transition-colors duration-200",
            i === current ? "bg-primary" : i < current ? "bg-primary/40" : "bg-muted-foreground/25",
          )}
        />
      ))}
    </div>
  );
}

export function ToolApprovalCard({
  toolName,
  toolInput,
  integration,
  operation,
  command,
  questionAnswers,
  onApprove,
  onDeny,
  status,
  isLoading,
}: ToolApprovalCardProps) {
  const isQuestionRequest = isQuestionApprovalRequest({ toolName, integration, operation });
  const questionPayload = useMemo(
    () => (isQuestionRequest ? parseQuestionRequestPayload(toolInput) : null),
    [isQuestionRequest, toolInput],
  );

  const totalQuestions = questionPayload?.questions.length ?? 0;
  const isMultiQuestion = totalQuestions > 1;

  // --- Wizard step state (only used when multiple questions) ---
  const [currentStep, setCurrentStep] = useState(0);

  const [selectedOptions, setSelectedOptions] = useState<Record<number, string[]>>(() => {
    if (!questionPayload) {
      return {};
    }
    return questionPayload.questions.reduce<Record<number, string[]>>((acc) => acc, {});
  });
  const [typedAnswers, setTypedAnswers] = useState<Record<number, string>>({});
  const [typedMode, setTypedMode] = useState<Record<number, boolean>>(() => {
    if (!questionPayload) {
      return {};
    }
    return questionPayload.questions.reduce<Record<number, boolean>>((acc, question, index) => {
      acc[index] = question.options.length === 0;
      return acc;
    }, {});
  });

  useEffect(() => {
    if (!questionPayload) {
      return;
    }

    setSelectedOptions((prev) => {
      const next: Record<number, string[]> = {};
      for (let index = 0; index < questionPayload.questions.length; index += 1) {
        const existing = prev[index];
        if (Array.isArray(existing) && existing.length > 0) {
          next[index] = existing;
        }
      }
      return next;
    });

    setTypedMode((prev) => {
      const next: Record<number, boolean> = {};
      for (let index = 0; index < questionPayload.questions.length; index += 1) {
        const existing = prev[index];
        if (typeof existing === "boolean") {
          next[index] = existing;
          continue;
        }

        next[index] = questionPayload.questions[index]?.options.length === 0;
      }
      return next;
    });

    setTypedAnswers((prev) => {
      const next: Record<number, string> = {};
      for (let index = 0; index < questionPayload.questions.length; index += 1) {
        const existing = prev[index];
        if (typeof existing === "string") {
          next[index] = existing;
        }
      }
      return next;
    });
  }, [questionPayload]);

  // For single-question mode with multiselect, keep old explicit submit behavior
  const requiresExplicitSubmit = useMemo(
    () => questionPayload?.questions.some((question) => question.multiple === true) ?? false,
    [questionPayload],
  );

  // Parse the command to extract structured data
  const parsedCommand = useMemo(() => {
    if (!command) {
      return null;
    }
    return parseCliCommand(command);
  }, [command]);
  const displayIntegration = parsedCommand?.integration ?? integration;
  const displayOperation = parsedCommand?.operation ?? operation;
  const logo = isQuestionRequest ? null : getIntegrationLogo(displayIntegration);
  const IntegrationIcon = isQuestionRequest ? null : getIntegrationIcon(displayIntegration);
  const displayName = isQuestionRequest ? null : getIntegrationDisplayName(displayIntegration);

  // Build preview props
  const previewProps = useMemo(() => {
    if (!parsedCommand) {
      return null;
    }
    return {
      integration: parsedCommand.integration,
      operation: parsedCommand.operation,
      args: parsedCommand.args,
      positionalArgs: parsedCommand.positionalArgs,
      command: parsedCommand.rawCommand,
    };
  }, [parsedCommand]);

  const handleDenyClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onDeny();
    },
    [onDeny],
  );

  const buildQuestionAnswers = useCallback(
    (
      nextSelectedOptions: Record<number, string[]>,
      nextTypedAnswers: Record<number, string>,
      nextTypedMode: Record<number, boolean>,
    ): string[][] => {
      if (!questionPayload) {
        return [];
      }

      return questionPayload.questions.map((_, index) => {
        if (nextTypedMode[index]) {
          const answer = nextTypedAnswers[index]?.trim();
          if (answer) {
            return [answer];
          }
        }

        const selected = nextSelectedOptions[index]
          ?.map((value) => value.trim())
          .filter((value) => value.length > 0);
        if (selected && selected.length > 0) {
          return selected;
        }

        return [];
      });
    },
    [questionPayload],
  );

  const isQuestionAnswered = useCallback(
    (
      nextSelectedOptions: Record<number, string[]>,
      nextTypedAnswers: Record<number, string>,
      nextTypedMode: Record<number, boolean>,
    ) => {
      if (!questionPayload) {
        return false;
      }

      return questionPayload.questions.every((_, index) => {
        if (nextTypedMode[index]) {
          const answer = nextTypedAnswers[index]?.trim();
          return !!answer;
        }
        const selected = nextSelectedOptions[index];
        return Array.isArray(selected) && selected.length > 0;
      });
    },
    [questionPayload],
  );

  /** Check if a single question at `index` has been answered */
  const isSingleQuestionAnswered = useCallback(
    (
      index: number,
      nextSelectedOptions: Record<number, string[]>,
      nextTypedAnswers: Record<number, string>,
      nextTypedMode: Record<number, boolean>,
    ) => {
      if (nextTypedMode[index]) {
        const answer = nextTypedAnswers[index]?.trim();
        return !!answer;
      }
      const selected = nextSelectedOptions[index];
      return Array.isArray(selected) && selected.length > 0;
    },
    [],
  );

  /** Advance to next step or submit if last */
  const advanceOrSubmit = useCallback(
    (
      nextSelectedOptions: Record<number, string[]>,
      nextTypedAnswers: Record<number, string>,
      nextTypedMode: Record<number, boolean>,
    ) => {
      const isLastStep = currentStep >= totalQuestions - 1;

      if (isLastStep) {
        onApprove(buildQuestionAnswers(nextSelectedOptions, nextTypedAnswers, nextTypedMode));
        return;
      }

      // Advance to next step — CSS animation is handled via key-based remount
      setCurrentStep((prev) => prev + 1);
    },
    [buildQuestionAnswers, currentStep, onApprove, totalQuestions],
  );

  const handleApproveClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!questionPayload) {
        onApprove();
        return;
      }

      const answers = questionPayload.questions.map((_, index) => {
        if (typedMode[index]) {
          const answer = typedAnswers[index]?.trim();
          if (answer) {
            return [answer];
          }
        }

        const selected = selectedOptions[index]
          ?.map((value) => value.trim())
          .filter((value) => value.length > 0);
        if (selected && selected.length > 0) {
          return selected;
        }

        return [];
      });

      onApprove(answers);
    },
    [onApprove, questionPayload, selectedOptions, typedAnswers, typedMode],
  );

  const canSubmitQuestionAnswers = useMemo(
    () => isQuestionAnswered(selectedOptions, typedAnswers, typedMode),
    [isQuestionAnswered, selectedOptions, typedAnswers, typedMode],
  );

  const handleSelectOption = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (isLoading || !questionPayload) {
        return;
      }
      const { questionIndex, optionLabel } = event.currentTarget.dataset;
      if (!questionIndex || !optionLabel) {
        return;
      }
      const index = Number(questionIndex);
      if (Number.isNaN(index)) {
        return;
      }
      const question = questionPayload.questions[index];
      if (!question) {
        return;
      }

      const previous = selectedOptions[index] ?? [];
      const nextSelection = question.multiple
        ? previous.includes(optionLabel)
          ? previous.filter((value) => value !== optionLabel)
          : [...previous, optionLabel]
        : [optionLabel];

      const nextSelectedOptions = { ...selectedOptions, [index]: nextSelection };
      const nextTypedMode = { ...typedMode, [index]: false };

      setSelectedOptions(nextSelectedOptions);
      setTypedMode(nextTypedMode);

      // Multi-question wizard: auto-advance on single-select
      if (isMultiQuestion && !question.multiple) {
        advanceOrSubmit(nextSelectedOptions, typedAnswers, nextTypedMode);
        return;
      }

      // Original single-question auto-submit behavior
      if (
        !isMultiQuestion &&
        !requiresExplicitSubmit &&
        isQuestionAnswered(nextSelectedOptions, typedAnswers, nextTypedMode)
      ) {
        onApprove(buildQuestionAnswers(nextSelectedOptions, typedAnswers, nextTypedMode));
      }
    },
    [
      advanceOrSubmit,
      buildQuestionAnswers,
      isLoading,
      isMultiQuestion,
      isQuestionAnswered,
      onApprove,
      questionPayload,
      requiresExplicitSubmit,
      selectedOptions,
      typedAnswers,
      typedMode,
    ],
  );

  const handleEnableTypedMode = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const { questionIndex } = event.currentTarget.dataset;
    if (!questionIndex) {
      return;
    }
    const index = Number(questionIndex);
    if (Number.isNaN(index)) {
      return;
    }
    setTypedMode((prev) => ({ ...prev, [index]: true }));
  }, []);

  const handleTypedAnswerChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const { questionIndex } = event.currentTarget.dataset;
    const value = event.currentTarget.value;
    if (!questionIndex) {
      return;
    }
    const index = Number(questionIndex);
    if (Number.isNaN(index)) {
      return;
    }
    setTypedAnswers((prev) => ({ ...prev, [index]: value }));
  }, []);

  const handleTypedAnswerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || isLoading || !questionPayload) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const { questionIndex } = event.currentTarget.dataset;
      if (!questionIndex) {
        return;
      }
      const index = Number(questionIndex);
      if (Number.isNaN(index)) {
        return;
      }

      const nextTypedAnswers = { ...typedAnswers, [index]: event.currentTarget.value };

      if (isMultiQuestion) {
        if (isSingleQuestionAnswered(index, selectedOptions, nextTypedAnswers, typedMode)) {
          setTypedAnswers(nextTypedAnswers);
          advanceOrSubmit(selectedOptions, nextTypedAnswers, typedMode);
        }
        return;
      }

      if (
        !requiresExplicitSubmit &&
        isQuestionAnswered(selectedOptions, nextTypedAnswers, typedMode)
      ) {
        onApprove(buildQuestionAnswers(selectedOptions, nextTypedAnswers, typedMode));
      }
    },
    [
      advanceOrSubmit,
      buildQuestionAnswers,
      isLoading,
      isMultiQuestion,
      isQuestionAnswered,
      isSingleQuestionAnswered,
      onApprove,
      questionPayload,
      requiresExplicitSubmit,
      selectedOptions,
      typedAnswers,
      typedMode,
    ],
  );

  const handleTypedAnswerSubmitClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (isLoading || !questionPayload) {
        return;
      }

      const { questionIndex } = event.currentTarget.dataset;
      if (!questionIndex) {
        return;
      }
      const index = Number(questionIndex);
      if (Number.isNaN(index)) {
        return;
      }

      const nextTypedAnswers = { ...typedAnswers, [index]: typedAnswers[index] ?? "" };

      if (isMultiQuestion) {
        if (isSingleQuestionAnswered(index, selectedOptions, nextTypedAnswers, typedMode)) {
          advanceOrSubmit(selectedOptions, nextTypedAnswers, typedMode);
        }
        return;
      }

      if (requiresExplicitSubmit) {
        return;
      }

      if (!isQuestionAnswered(selectedOptions, typedAnswers, typedMode)) {
        return;
      }

      onApprove(buildQuestionAnswers(selectedOptions, typedAnswers, typedMode));
    },
    [
      advanceOrSubmit,
      buildQuestionAnswers,
      isLoading,
      isMultiQuestion,
      isQuestionAnswered,
      isSingleQuestionAnswered,
      onApprove,
      questionPayload,
      requiresExplicitSubmit,
      selectedOptions,
      typedAnswers,
      typedMode,
    ],
  );

  /** For multi-select questions in wizard mode, advance via Next button */
  const handleWizardNext = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!isSingleQuestionAnswered(currentStep, selectedOptions, typedAnswers, typedMode)) {
        return;
      }
      advanceOrSubmit(selectedOptions, typedAnswers, typedMode);
    },
    [
      advanceOrSubmit,
      currentStep,
      isSingleQuestionAnswered,
      selectedOptions,
      typedAnswers,
      typedMode,
    ],
  );

  const handleWizardBack = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const handleStopPropagation = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
  }, []);

  /** Render a single question's interactive content */
  const renderQuestionContent = (index: number) => {
    const question = questionPayload?.questions[index];
    if (!question) {
      return null;
    }

    const canTypeOwnAnswer = question.custom !== false;
    const useTypedAnswer = !!typedMode[index];

    return (
      <div className="space-y-2">
        <div>
          <p className="text-sm font-medium">{question.header}</p>
          <p className="text-muted-foreground text-sm">{question.question}</p>
        </div>

        {question.options.length > 0 && (
          <div className="space-y-2">
            {question.options.map((option) => {
              const selected = selectedOptions[index] ?? [];
              const isSelected = !useTypedAnswer && selected.includes(option.label);
              return (
                <button
                  key={option.label}
                  type="button"
                  data-question-index={String(index)}
                  data-option-label={option.label}
                  data-testid={`question-option-${index}-${option.label}`}
                  className={cn(
                    "hover:border-primary/70 w-full rounded-md border p-2 text-left text-sm transition-colors",
                    isSelected ? "border-primary bg-primary/5" : "border-border",
                  )}
                  onClick={handleSelectOption}
                >
                  <div className="font-medium">{option.label}</div>
                  {option.description && (
                    <div className="text-muted-foreground mt-0.5 text-xs">{option.description}</div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {canTypeOwnAnswer && (
          <div className="space-y-2">
            <button
              type="button"
              data-question-index={String(index)}
              data-testid={`question-typed-toggle-${index}`}
              className={cn(
                "hover:border-primary/70 w-full rounded-md border p-2 text-left text-sm transition-colors",
                useTypedAnswer ? "border-primary bg-primary/5" : "border-border",
              )}
              onClick={handleEnableTypedMode}
            >
              <div className="font-medium">Type your own answer</div>
            </button>
            {useTypedAnswer && (
              <div className="flex items-center gap-2">
                <Input
                  data-question-index={String(index)}
                  data-testid={`question-typed-input-${index}`}
                  value={typedAnswers[index] ?? ""}
                  onChange={handleTypedAnswerChange}
                  onKeyDown={handleTypedAnswerKeyDown}
                  placeholder="Type your answer"
                  onClick={handleStopPropagation}
                  className="focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
                />
                {(isMultiQuestion || !requiresExplicitSubmit) && (
                  <Button
                    type="button"
                    size="sm"
                    data-question-index={String(index)}
                    data-testid={`question-typed-submit-${index}`}
                    onClick={handleTypedAnswerSubmitClick}
                    disabled={isLoading || !(typedAnswers[index]?.trim()?.length > 0)}
                  >
                    {isMultiQuestion && currentStep < totalQuestions - 1 ? (
                      <>
                        Next
                        <ChevronRight className="ml-1 h-3 w-3" />
                      </>
                    ) : (
                      "Submit"
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground",
        status === "approved" && "border-green-500/50",
        status === "denied" && "border-red-500/50",
      )}
    >
      <div className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        {logo ? (
          <Image src={logo} alt={displayName ?? ""} width={16} height={16} className="h-4 w-auto" />
        ) : IntegrationIcon ? (
          <IntegrationIcon className="text-muted-foreground h-4 w-4" />
        ) : (
          <Wrench className="text-muted-foreground h-4 w-4" />
        )}
        {isQuestionRequest ? (
          <span className="font-medium">CmdClaw wants to ask a question</span>
        ) : (
          <>
            <span className="font-medium">{displayName}</span>
            <span className="text-muted-foreground">wants to</span>
            <span className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
              {displayOperation}
            </span>
          </>
        )}

        <div className="flex-1" />

        {status === "pending" && (
          <span className="flex items-center gap-1 text-xs text-amber-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for approval
          </span>
        )}
        {status === "approved" && (
          <span className="flex items-center gap-1 text-xs text-green-500">
            <Check className="h-3 w-3" />
            Approved
          </span>
        )}
        {status === "denied" && (
          <span className="flex items-center gap-1 text-xs text-red-500">
            <X className="h-3 w-3" />
            Denied
          </span>
        )}
      </div>

      <div className="border-t px-3 py-3">
        {/* Formatted Preview */}
        {previewProps && <div className="mb-3">{renderPreview(integration, previewProps)}</div>}

        {/* Raw Command Section */}
        {command && !isQuestionRequest && (
          <div className="mb-3">
            <pre className="bg-muted overflow-x-auto rounded p-2 font-mono text-xs">{command}</pre>
          </div>
        )}

        {/* === PENDING: Wizard mode (multi-question) === */}
        {questionPayload && status === "pending" && isMultiQuestion && (
          <div className="mb-3">
            <QuestionDots total={totalQuestions} current={currentStep} />
            <div className="overflow-hidden">
              {/* Key-based remount triggers CSS slide-in animation on step change */}
              <div key={`wizard-step-${currentStep}`} className="animate-slide-in-right">
                {renderQuestionContent(currentStep)}
              </div>
            </div>

            {/* Next button for multi-select questions in wizard */}
            {questionPayload.questions[currentStep]?.multiple && (
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  onClick={handleWizardNext}
                  disabled={
                    isLoading ||
                    !isSingleQuestionAnswered(currentStep, selectedOptions, typedAnswers, typedMode)
                  }
                  data-testid={`question-wizard-next-${currentStep}`}
                >
                  {currentStep < totalQuestions - 1 ? (
                    <>
                      Next
                      <ChevronRight className="ml-1 h-3 w-3" />
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Submit
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* === PENDING: Single-question mode (original behavior) === */}
        {questionPayload && status === "pending" && !isMultiQuestion && (
          <div className="mb-3 space-y-4">{renderQuestionContent(0)}</div>
        )}

        {/* === COMPLETED: Show all answers (approved/denied) === */}
        {questionPayload && status !== "pending" && (
          <div className="mb-3 space-y-4">
            {questionPayload.questions.map((question, index) => {
              const savedAnswers =
                questionAnswers?.[index]?.filter((answer) => answer.length > 0) ?? [];

              return (
                <div key={`${question.header}-${question.question}`} className="space-y-2">
                  <div>
                    <p className="text-sm font-medium">{question.header}</p>
                    <p className="text-muted-foreground text-sm">{question.question}</p>
                  </div>

                  {savedAnswers.length > 0 && (
                    <div className="bg-muted/60 rounded-md border px-3 py-2">
                      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        Saved answer
                      </p>
                      <p className="mt-1 text-sm">{savedAnswers.join(", ")}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {status === "pending" && !questionPayload && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleDenyClick} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              Deny
            </Button>
            <Button size="sm" onClick={handleApproveClick} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Approve
            </Button>
          </div>
        )}

        {status === "pending" && questionPayload && (
          <div className="flex items-center justify-between gap-2">
            <div>
              {isMultiQuestion && currentStep > 0 && (
                <Button variant="outline" size="sm" onClick={handleWizardBack} disabled={isLoading}>
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleDenyClick} disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Dismiss
              </Button>
              {requiresExplicitSubmit && !isMultiQuestion && (
                <Button
                  size="sm"
                  onClick={handleApproveClick}
                  disabled={isLoading || !canSubmitQuestionAnswers}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Submit
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
