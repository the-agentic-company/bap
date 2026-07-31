import { normalizeModelReference } from "./model-reference";

export function isRetiredChatModel(model: string | null | undefined): boolean {
  return normalizeModelReference(model).startsWith("anthropic/");
}
