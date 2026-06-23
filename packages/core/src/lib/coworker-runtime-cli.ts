export const COWORKER_INVOCATION_ENVELOPE_KIND = "coworker_invocation" as const;
export const COWORKER_EDIT_APPLY_ENVELOPE_KIND = "coworker_edit_apply" as const;

export { getCoworkerCliSystemPrompt } from "@bap/prompts";

export type CoworkerRuntimeRunStatus =
  | "running"
  | "needs_user_input"
  | "awaiting_approval"
  | "awaiting_auth"
  | "paused"
  | "cancelling"
  | "completed"
  | "error"
  | "cancelled";

export type CoworkerInvocationEnvelope = {
  kind: typeof COWORKER_INVOCATION_ENVELOPE_KIND;
  coworkerId: string;
  username: string;
  name: string;
  runId: string;
  conversationId: string;
  generationId: string | null;
  status: CoworkerRuntimeRunStatus;
  attachmentNames: string[];
  message: string;
};

export type CoworkerEditApplyEnvelopeCoworker = {
  coworkerId: string;
  updatedAt: string;
  prompt: string;
  model: string;
  toolAccessMode: "all" | "selected";
  triggerType: string;
  schedule: unknown;
  requiresUserInput: boolean;
  userInputPrompt: string | null;
  allowedIntegrations: string[];
};

export type CoworkerEditApplyEnvelope =
  | {
      kind: typeof COWORKER_EDIT_APPLY_ENVELOPE_KIND;
      status: "applied";
      coworkerId: string;
      appliedChanges: string[];
      coworker: CoworkerEditApplyEnvelopeCoworker;
      message: string;
      details?: string[] | undefined;
    }
  | {
      kind: typeof COWORKER_EDIT_APPLY_ENVELOPE_KIND;
      status: "conflict";
      coworkerId: string;
      appliedChanges?: string[] | undefined;
      coworker: CoworkerEditApplyEnvelopeCoworker;
      message: string;
      details?: string[] | undefined;
    }
  | {
      kind: typeof COWORKER_EDIT_APPLY_ENVELOPE_KIND;
      status: "validation_error";
      coworkerId: string;
      appliedChanges?: string[] | undefined;
      coworker?: CoworkerEditApplyEnvelopeCoworker | undefined;
      message: string;
      details: string[];
    };

const JSON_FLAG = "--json";

function extractJsonCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.startsWith("{") && line.endsWith("}")) {
      return line;
    }
  }

  return null;
}

function looksLikeCoworkerInvokeCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized) {
    return false;
  }

  return (
    /^coworker\s+invoke(?:\s|$)/.test(normalized) || /\/coworker\s+invoke(?:\s|$)/.test(normalized)
  );
}

function looksLikeCoworkerEditCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized) {
    return false;
  }

  return (
    /^coworker\s+edit(?:\s|$)/.test(normalized) || /\/coworker\s+edit(?:\s|$)/.test(normalized)
  );
}

function parseEnvelopeObject(value: unknown): CoworkerInvocationEnvelope | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== COWORKER_INVOCATION_ENVELOPE_KIND) {
    return null;
  }

  if (
    typeof candidate.coworkerId !== "string" ||
    typeof candidate.username !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.runId !== "string" ||
    typeof candidate.conversationId !== "string" ||
    (typeof candidate.generationId !== "string" && candidate.generationId !== null) ||
    typeof candidate.status !== "string" ||
    typeof candidate.message !== "string"
  ) {
    return null;
  }

  const attachmentNames = Array.isArray(candidate.attachmentNames)
    ? candidate.attachmentNames.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    kind: COWORKER_INVOCATION_ENVELOPE_KIND,
    coworkerId: candidate.coworkerId,
    username: candidate.username,
    name: candidate.name,
    runId: candidate.runId,
    conversationId: candidate.conversationId,
    generationId: candidate.generationId,
    status: candidate.status as CoworkerRuntimeRunStatus,
    attachmentNames,
    message: candidate.message,
  };
}

function parseEditCoworker(value: unknown): CoworkerEditApplyEnvelopeCoworker | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.coworkerId !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.prompt !== "string" ||
    typeof candidate.model !== "string" ||
    (candidate.toolAccessMode !== "all" && candidate.toolAccessMode !== "selected") ||
    typeof candidate.triggerType !== "string" ||
    !Array.isArray(candidate.allowedIntegrations)
  ) {
    return null;
  }

  const allowedIntegrations = candidate.allowedIntegrations.filter(
    (entry): entry is string => typeof entry === "string",
  );

  return {
    coworkerId: candidate.coworkerId,
    updatedAt: candidate.updatedAt,
    prompt: candidate.prompt,
    model: candidate.model,
    toolAccessMode: candidate.toolAccessMode,
    triggerType: candidate.triggerType,
    schedule: candidate.schedule ?? null,
    requiresUserInput: candidate.requiresUserInput === true,
    userInputPrompt: typeof candidate.userInputPrompt === "string" ? candidate.userInputPrompt : null,
    allowedIntegrations,
  };
}

function parseEditEnvelopeObject(value: unknown): CoworkerEditApplyEnvelope | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== COWORKER_EDIT_APPLY_ENVELOPE_KIND) {
    return null;
  }

  if (
    candidate.status !== "applied" &&
    candidate.status !== "conflict" &&
    candidate.status !== "validation_error"
  ) {
    return null;
  }

  if (typeof candidate.coworkerId !== "string" || typeof candidate.message !== "string") {
    return null;
  }

  const appliedChanges = Array.isArray(candidate.appliedChanges)
    ? candidate.appliedChanges.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const details = Array.isArray(candidate.details)
    ? candidate.details.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  const coworker = parseEditCoworker(candidate.coworker);

  if (candidate.status === "applied") {
    if (!coworker) {
      return null;
    }
    return {
      kind: COWORKER_EDIT_APPLY_ENVELOPE_KIND,
      status: "applied",
      coworkerId: candidate.coworkerId,
      appliedChanges: appliedChanges ?? [],
      coworker,
      message: candidate.message,
      details,
    };
  }

  if (candidate.status === "conflict") {
    if (!coworker) {
      return null;
    }
    return {
      kind: COWORKER_EDIT_APPLY_ENVELOPE_KIND,
      status: "conflict",
      coworkerId: candidate.coworkerId,
      appliedChanges,
      coworker,
      message: candidate.message,
      details,
    };
  }

  if (!details) {
    return null;
  }

  return {
    kind: COWORKER_EDIT_APPLY_ENVELOPE_KIND,
    status: "validation_error",
    coworkerId: candidate.coworkerId,
    appliedChanges,
    coworker: coworker ?? undefined,
    message: candidate.message,
    details,
  };
}

export function parseCoworkerInvocationEnvelope(params: {
  toolName: string;
  toolInput: unknown;
  toolResult: unknown;
}): CoworkerInvocationEnvelope | null {
  if (params.toolName !== "Bash") {
    return null;
  }

  if (!params.toolInput || typeof params.toolInput !== "object") {
    return null;
  }

  const command = (params.toolInput as { command?: unknown }).command;
  if (typeof command !== "string" || !looksLikeCoworkerInvokeCommand(command)) {
    return null;
  }

  if (!command.includes(JSON_FLAG)) {
    return null;
  }

  if (typeof params.toolResult === "string") {
    const candidate = extractJsonCandidate(params.toolResult);
    if (!candidate) {
      return null;
    }

    try {
      return parseEnvelopeObject(JSON.parse(candidate));
    } catch {
      return null;
    }
  }

  if (params.toolResult && typeof params.toolResult === "object") {
    const record = params.toolResult as Record<string, unknown>;
    if (typeof record.stdout === "string") {
      const candidate = extractJsonCandidate(record.stdout);
      if (candidate) {
        try {
          return parseEnvelopeObject(JSON.parse(candidate));
        } catch {
          return null;
        }
      }
    }
    return parseEnvelopeObject(record);
  }

  return null;
}

export function parseCoworkerEditApplyEnvelope(params: {
  toolName: string;
  toolInput: unknown;
  toolResult: unknown;
}): CoworkerEditApplyEnvelope | null {
  if (params.toolName !== "Bash") {
    return null;
  }

  if (!params.toolInput || typeof params.toolInput !== "object") {
    return null;
  }

  const command = (params.toolInput as { command?: unknown }).command;
  if (typeof command !== "string" || !looksLikeCoworkerEditCommand(command)) {
    return null;
  }

  if (typeof params.toolResult === "string") {
    const candidate = extractJsonCandidate(params.toolResult);
    if (!candidate) {
      return null;
    }

    try {
      return parseEditEnvelopeObject(JSON.parse(candidate));
    } catch {
      return null;
    }
  }

  if (params.toolResult && typeof params.toolResult === "object") {
    const record = params.toolResult as Record<string, unknown>;
    if (typeof record.stdout === "string") {
      const candidate = extractJsonCandidate(record.stdout);
      if (candidate) {
        try {
          return parseEditEnvelopeObject(JSON.parse(candidate));
        } catch {
          return null;
        }
      }
    }
    return parseEditEnvelopeObject(record);
  }

  return null;
}

export function buildCoworkerEditApplyEnvelope(params: {
  result:
    | {
        status: "applied";
        coworker: CoworkerEditApplyEnvelopeCoworker;
        appliedChanges: string[];
      }
    | {
        status: "conflict";
        coworker: CoworkerEditApplyEnvelopeCoworker;
        message: string;
      }
    | {
        status: "validation_error";
        message: string;
        details: string[];
      };
  coworkerId: string;
}): CoworkerEditApplyEnvelope {
  if (params.result.status === "applied") {
    return {
      kind: COWORKER_EDIT_APPLY_ENVELOPE_KIND,
      status: "applied",
      coworkerId: params.coworkerId,
      appliedChanges: params.result.appliedChanges,
      coworker: params.result.coworker,
      message:
        params.result.appliedChanges.length > 0
          ? `Saved coworker edits: ${params.result.appliedChanges.join(", ")}.`
          : "No coworker edits were needed.",
    };
  }

  if (params.result.status === "conflict") {
    return {
      kind: COWORKER_EDIT_APPLY_ENVELOPE_KIND,
      status: "conflict",
      coworkerId: params.coworkerId,
      coworker: params.result.coworker,
      message: params.result.message,
    };
  }

  return {
    kind: COWORKER_EDIT_APPLY_ENVELOPE_KIND,
    status: "validation_error",
    coworkerId: params.coworkerId,
    message: params.result.message,
    details: params.result.details,
  };
}
