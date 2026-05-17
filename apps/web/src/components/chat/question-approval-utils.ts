"use client";

export type QuestionOption = {
  label: string;
  description?: string;
};

export type QuestionPrompt = {
  header: string;
  question: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

export type QuestionRequestPayload = {
  questions: QuestionPrompt[];
};

type QuestionApprovalDescriptor = {
  toolUseId: string;
  toolInput: unknown;
  toolName: string;
  integration: string;
  operation: string;
};

export function isQuestionApprovalRequest(input: {
  toolName: string;
  integration: string;
  operation: string;
}): boolean {
  return (
    (input.operation === "question" || input.toolName.toLowerCase() === "question") &&
    input.integration.toLowerCase() === "cmdclaw"
  );
}

export function parseQuestionRequestPayload(input: unknown): QuestionRequestPayload | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const rawQuestions = (input as { questions?: unknown }).questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return null;
  }

  const questions: QuestionPrompt[] = [];
  for (const rawQuestion of rawQuestions) {
    if (typeof rawQuestion !== "object" || rawQuestion === null) {
      return null;
    }

    const question = rawQuestion as {
      header?: unknown;
      question?: unknown;
      options?: unknown;
      multiple?: unknown;
      custom?: unknown;
    };

    if (typeof question.header !== "string" || typeof question.question !== "string") {
      return null;
    }

    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options: QuestionOption[] = [];
    for (const rawOption of rawOptions) {
      if (typeof rawOption !== "object" || rawOption === null) {
        continue;
      }

      const option = rawOption as { label?: unknown; description?: unknown };
      if (typeof option.label !== "string" || option.label.length === 0) {
        continue;
      }

      options.push({
        label: option.label,
        description: typeof option.description === "string" ? option.description : undefined,
      });
    }

    questions.push({
      header: question.header,
      question: question.question,
      options,
      multiple: typeof question.multiple === "boolean" ? question.multiple : undefined,
      custom: typeof question.custom === "boolean" ? question.custom : undefined,
    });
  }

  return questions.length > 0 ? { questions } : null;
}

function extractApprovalLinkedToolUseId(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }

  const tool = (input as { tool?: unknown }).tool;
  if (typeof tool !== "object" || tool === null) {
    return undefined;
  }

  const candidateCallId = (tool as { callID?: unknown; callId?: unknown }).callID;
  if (typeof candidateCallId === "string" && candidateCallId.length > 0) {
    return candidateCallId;
  }

  const fallbackCallId = (tool as { callID?: unknown; callId?: unknown }).callId;
  if (typeof fallbackCallId === "string" && fallbackCallId.length > 0) {
    return fallbackCallId;
  }

  return undefined;
}

export function collectQuestionApprovalToolUseIds(
  approvals: QuestionApprovalDescriptor[],
): Set<string> {
  const toolUseIds = new Set<string>();

  for (const approval of approvals) {
    if (!isQuestionApprovalRequest(approval)) {
      continue;
    }

    toolUseIds.add(approval.toolUseId);
    const linkedToolUseId = extractApprovalLinkedToolUseId(approval.toolInput);
    if (linkedToolUseId) {
      toolUseIds.add(linkedToolUseId);
    }
  }

  return toolUseIds;
}
