const PENDING_COWORKER_PROMPT_KEY = "bap.pendingCoworkerPrompt";
const DRAFT_COWORKER_PROMPT_KEY = "bap.draftCoworkerPrompt";
const MAX_PENDING_PROMPT_AGE_MS = 10 * 60 * 1000;
const ATTACHMENT_ONLY_INITIAL_MESSAGE =
  "Use the attached files as context while building this coworker.";

export type PendingCoworkerAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type PendingCoworkerPrompt = {
  initialMessage: string;
  attachments?: PendingCoworkerAttachment[];
};

type StoredPendingCoworkerPrompt = PendingCoworkerPrompt & {
  createdAt: number;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function clearPendingCoworkerPrompt() {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(PENDING_COWORKER_PROMPT_KEY);
}

function normalizeAttachments(
  attachments: PendingCoworkerAttachment[] | undefined,
): PendingCoworkerAttachment[] {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  return attachments.filter(
    (attachment) =>
      attachment.name.trim().length > 0 &&
      attachment.mimeType.trim().length > 0 &&
      attachment.dataUrl.trim().length > 0,
  );
}

function isValidAttachment(value: unknown): value is PendingCoworkerAttachment {
  if (!value || typeof value !== "object") {
    return false;
  }

  const attachment = value as Partial<PendingCoworkerAttachment>;
  return (
    typeof attachment.name === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.dataUrl === "string"
  );
}

export function getPendingCoworkerGenerationContent(
  pendingPrompt: PendingCoworkerPrompt,
): string | null {
  const trimmedMessage = pendingPrompt.initialMessage.trim();
  if (trimmedMessage) {
    return trimmedMessage;
  }

  if ((pendingPrompt.attachments?.length ?? 0) > 0) {
    return ATTACHMENT_ONLY_INITIAL_MESSAGE;
  }

  return null;
}

export function writePendingCoworkerPrompt(pendingPrompt: PendingCoworkerPrompt) {
  if (!canUseStorage()) {
    return;
  }

  const trimmedMessage = pendingPrompt.initialMessage.trim();
  const attachments = normalizeAttachments(pendingPrompt.attachments);
  if (!trimmedMessage && attachments.length === 0) {
    clearPendingCoworkerPrompt();
    return;
  }

  const payload: StoredPendingCoworkerPrompt = {
    initialMessage: trimmedMessage,
    attachments,
    createdAt: Date.now(),
  };

  window.localStorage.setItem(PENDING_COWORKER_PROMPT_KEY, JSON.stringify(payload));
}

export function readPendingCoworkerPrompt(): PendingCoworkerPrompt | null {
  if (!canUseStorage()) {
    return null;
  }

  const rawValue = window.localStorage.getItem(PENDING_COWORKER_PROMPT_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredPendingCoworkerPrompt>;
    if (typeof parsed.initialMessage !== "string" || typeof parsed.createdAt !== "number") {
      clearPendingCoworkerPrompt();
      return null;
    }

    if (Date.now() - parsed.createdAt > MAX_PENDING_PROMPT_AGE_MS) {
      clearPendingCoworkerPrompt();
      return null;
    }

    const attachments =
      parsed.attachments === undefined
        ? []
        : Array.isArray(parsed.attachments) && parsed.attachments.every(isValidAttachment)
          ? normalizeAttachments(parsed.attachments)
          : null;
    if (attachments === null) {
      clearPendingCoworkerPrompt();
      return null;
    }

    const trimmedMessage = parsed.initialMessage.trim();
    if (!trimmedMessage && attachments.length === 0) {
      clearPendingCoworkerPrompt();
      return null;
    }

    return {
      initialMessage: trimmedMessage,
      attachments,
    };
  } catch {
    clearPendingCoworkerPrompt();
    return null;
  }
}

/**
 * Draft prompt: pre-fills the home composer WITHOUT submitting it (unlike the pending prompt,
 * which auto-creates the coworker). The home page reads this once on mount, drops it into the
 * prompt bar, and clears it. The user can then edit and send it themselves.
 */
type StoredDraftCoworkerPrompt = { text: string; createdAt: number };

export function writeDraftCoworkerPrompt(text: string) {
  if (!canUseStorage()) {
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    window.localStorage.removeItem(DRAFT_COWORKER_PROMPT_KEY);
    return;
  }
  const payload: StoredDraftCoworkerPrompt = { text: trimmed, createdAt: Date.now() };
  window.localStorage.setItem(DRAFT_COWORKER_PROMPT_KEY, JSON.stringify(payload));
}

/** Reads and clears the draft prompt. Returns null if absent or stale. */
export function takeDraftCoworkerPrompt(): string | null {
  if (!canUseStorage()) {
    return null;
  }
  const rawValue = window.localStorage.getItem(DRAFT_COWORKER_PROMPT_KEY);
  if (!rawValue) {
    return null;
  }
  window.localStorage.removeItem(DRAFT_COWORKER_PROMPT_KEY);
  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredDraftCoworkerPrompt>;
    if (typeof parsed.text !== "string" || typeof parsed.createdAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.createdAt > MAX_PENDING_PROMPT_AGE_MS) {
      return null;
    }
    const trimmed = parsed.text.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}
