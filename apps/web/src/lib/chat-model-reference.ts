const LEGACY_MODEL_PROVIDER_MAP = new Map<string, string>([
  ["claude-sonnet-4-6", "anthropic/claude-sonnet-4-6"],
  ["gpt-5.5", "openai/gpt-5.5"],
  ["gpt-5.4", "openai/gpt-5.4"],
  ["gpt-5.4-mini", "openai/gpt-5.4-mini"],
  ["gpt-5.1-codex-max", "openai/gpt-5.1-codex-max"],
  ["gpt-5.1-codex-mini", "openai/gpt-5.1-codex-mini"],
  ["gpt-5.2", "openai/gpt-5.2"],
  ["gpt-5.2-codex", "openai/gpt-5.2-codex"],
  ["gpt-5.1-codex", "openai/gpt-5.1-codex"],
]);

export function normalizeChatModelReference(model: string | null | undefined): string {
  const trimmed = model?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("/")) {
    return trimmed;
  }
  return LEGACY_MODEL_PROVIDER_MAP.get(trimmed) ?? trimmed;
}
