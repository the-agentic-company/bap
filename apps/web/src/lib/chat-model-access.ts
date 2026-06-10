import type { ProviderAuthSource } from "@cmdclaw/core/lib/provider-auth-source";
import { isAdminOnlyChatModel } from "@cmdclaw/core/lib/chat-model-policy";
import { parseModelReference } from "@cmdclaw/core/lib/model-reference";
import {
  normalizeModelAuthSource,
  resolveProviderAuthAvailability,
} from "@cmdclaw/core/lib/provider-auth-source";
import type { ProviderAuthAvailabilityByProvider } from "./provider-auth-availability";

const PROVIDER_MODEL_IDS_FOR_NEW_CHAT = new Map<string, Set<string>>([
  ["anthropic", new Set(["claude-sonnet-4-6"])],
  [
    "openai",
    new Set([
      "gpt-5.1-codex-max",
      "gpt-5.1-codex-mini",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.1-codex",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]),
  ],
  ["google", new Set(["gemini-3.1-pro-preview"])],
]);

export function isModelAccessibleForNewChat(params: {
  model: string;
  authSource?: ProviderAuthSource | null;
  providerAvailabilityByProvider?: ProviderAuthAvailabilityByProvider;
  isAdmin?: boolean;
}): boolean {
  const model = params.model.trim();
  if (!model) {
    return false;
  }

  if (isAdminOnlyChatModel(model) && params.isAdmin !== true) {
    return false;
  }

  let parsed: ReturnType<typeof parseModelReference>;
  try {
    parsed = parseModelReference(model);
  } catch {
    return false;
  }

  if (parsed.providerID === "opencode") {
    // OpenCode Zen free models are intentionally hidden from new-chat selection for now.
    return false;
  }

  const allowedModelIDs = PROVIDER_MODEL_IDS_FOR_NEW_CHAT.get(parsed.providerID);
  if (!allowedModelIDs?.has(parsed.modelID)) {
    return false;
  }

  const authSource = normalizeModelAuthSource({
    model,
    authSource: params.authSource,
  });
  if (authSource === null) {
    return true;
  }

  const availability =
    params.providerAvailabilityByProvider?.[parsed.providerID] ??
    resolveProviderAuthAvailability({
      providerID: parsed.providerID,
    });
  return availability[authSource];
}
