export const MODEL_PROVIDER_IDS = [
  "opencode",
  "anthropic",
  "openai",
  "google",
  "kimi-for-coding",
] as const;

export type ModelProviderID = (typeof MODEL_PROVIDER_IDS)[number];

const MODEL_PROVIDER_ID_SET = new Set<string>(MODEL_PROVIDER_IDS);
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

export function formatModelReference(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

export function normalizeModelReference(reference: string | null | undefined): string {
  const trimmed = reference?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("/")) {
    return trimmed;
  }
  return LEGACY_MODEL_PROVIDER_MAP.get(trimmed) ?? trimmed;
}

export function parseModelReference(reference: string): {
  providerID: ModelProviderID;
  modelID: string;
} {
  const trimmed = normalizeModelReference(reference);
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    throw new Error(`Model "${reference}" must use provider/model format`);
  }
  const providerID = trimmed.slice(0, slashIndex);
  const modelID = trimmed.slice(slashIndex + 1);
  if (MODEL_PROVIDER_ID_SET.has(providerID) && modelID.length > 0) {
    return { providerID: providerID as ModelProviderID, modelID };
  }
  throw new Error(`Unknown model provider "${providerID}" in "${reference}"`);
}
