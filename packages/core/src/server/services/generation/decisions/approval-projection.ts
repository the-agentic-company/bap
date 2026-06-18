import type { ContentPart } from "@bap/db/schema";
import type { RuntimePromptPart } from "../../../sandbox/core/types";
import {
  generationInterruptService,
  type GenerationInterruptRecord,
} from "../../generation-interrupt-service";
import type { GenerationEvent } from "../types";

export function normalizeQuestionAnswers(questionAnswers?: string[][]): string[][] {
  return (
    questionAnswers
      ?.map((answers) =>
        answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0),
      )
      .filter((answers) => answers.length > 0) ?? []
  );
}

export function buildApprovalContentPart(input: {
  interrupt: GenerationInterruptRecord;
  decision: "approve" | "deny" | "allow";
  defaultIntegration: string;
  defaultOperation: string;
  questionAnswers?: string[][];
}): Extract<ContentPart, { type: "approval" }> {
  const normalizedQuestionAnswers = normalizeQuestionAnswers(input.questionAnswers);
  return {
    type: "approval",
    tool_use_id: input.interrupt.providerToolUseId,
    tool_name: input.interrupt.display.title,
    tool_input: input.interrupt.display.toolInput ?? {},
    integration: input.interrupt.display.integration ?? input.defaultIntegration,
    operation: input.interrupt.display.operation ?? input.defaultOperation,
    command: input.interrupt.display.command,
    status: input.decision === "approve" || input.decision === "allow" ? "approved" : "denied",
    question_answers:
      normalizedQuestionAnswers.length > 0
        ? normalizedQuestionAnswers
        : input.interrupt.responsePayload?.questionAnswers,
  };
}

export function upsertApprovalContentPart(
  contentParts: ContentPart[],
  approvalPart: Extract<ContentPart, { type: "approval" }>,
): ContentPart[] {
  const nextContentParts = [...contentParts];
  const existingApprovalIndex = nextContentParts.findIndex(
    (part): part is ContentPart & { type: "approval" } =>
      part.type === "approval" && part.tool_use_id === approvalPart.tool_use_id,
  );
  if (existingApprovalIndex >= 0) {
    nextContentParts[existingApprovalIndex] = approvalPart;
  } else {
    nextContentParts.push(approvalPart);
  }
  return nextContentParts;
}

export function projectPendingDecisionEvent(
  interrupt: GenerationInterruptRecord,
): GenerationEvent {
  return {
    type: "interrupt_pending",
    ...generationInterruptService.projectInterruptEvent(interrupt),
  };
}

export function projectResolvedDecisionEvent(
  interrupt: GenerationInterruptRecord,
): GenerationEvent {
  return {
    type: "interrupt_resolved",
    ...generationInterruptService.projectInterruptEvent(interrupt),
  };
}

export function buildResumedAuthContinuationPrompt(
  interrupt: GenerationInterruptRecord,
): RuntimePromptPart[] {
  const integration = interrupt.display.authSpec?.integrations?.[0] ?? "the required";
  return [
    {
      type: "text",
      text: `Continue the interrupted assistant turn. Authentication for ${integration} is now complete.`,
    },
  ];
}

export function buildResumedRuntimeQuestionContinuationPrompt(
  interrupt: GenerationInterruptRecord,
): RuntimePromptPart[] {
  const flattenedAnswers =
    interrupt.responsePayload?.questionAnswers?.flatMap((answers) =>
      answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0),
    ) ?? [];
  const answerSummary =
    flattenedAnswers.length > 0
      ? ` The resolved answer was: ${flattenedAnswers.join(", ")}.`
      : "";
  return [
    {
      type: "text",
      text: `Continue the interrupted assistant turn. The pending question has been answered.${answerSummary}`,
    },
  ];
}
