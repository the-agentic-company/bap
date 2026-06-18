import { resolveDefaultChatModel } from "@bap/core/lib/chat-model-defaults";
import { listOpencodeFreeModels } from "@bap/core/server/ai/opencode-models";
import type { BapApiClient } from "@bap/client";
import { resolveCliModelSelection } from "../../lib/chat-model-source";
import type { ChatState } from "./chat-types";

export async function printAuthenticatedUserDeferred(client: BapApiClient): Promise<string> {
  try {
    const me = await client.user.me();
    return `[auth] ${me.email} (${me.id})\n`;
  } catch (error) {
    return `[auth] failed to resolve current user: ${error instanceof Error ? error.message : String(error)}\n`;
  }
}

export async function hydrateProviderAvailability(client: BapApiClient, state: ChatState) {
  const [authStatus, freeModels] = await Promise.all([
    client.providerAuth.status(),
    client.providerAuth.freeModels(),
  ]);

  state.connectedProviderIds = Object.keys(authStatus.connected ?? {});
  state.sharedConnectedProviderIds = Object.keys(authStatus.shared ?? {});

  if (state.model?.trim()) {
    const resolvedSelection = resolveCliModelSelection({
      model: state.model.trim(),
      authSource: state.authSource,
      connectedProviderIds: state.connectedProviderIds,
      sharedConnectedProviderIds: state.sharedConnectedProviderIds,
    });
    state.model = resolvedSelection.model;
    state.authSource = resolvedSelection.authSource;
  } else {
    const defaultModel = resolveDefaultChatModel({
      isOpenAIConnected:
        (state.connectedProviderIds ?? []).includes("openai") ||
        (state.sharedConnectedProviderIds ?? []).includes("openai"),
      availableOpencodeFreeModelIDs: (freeModels.models ?? []).map((model) => model.id),
    });
    const resolvedSelection = resolveCliModelSelection({
      model: defaultModel,
      connectedProviderIds: state.connectedProviderIds,
      sharedConnectedProviderIds: state.sharedConnectedProviderIds,
    });
    state.model = resolvedSelection.model;
    state.authSource = resolvedSelection.authSource;
  }

  return freeModels.models ?? [];
}

export async function printAvailableModels(
  stdout: NodeJS.WriteStream,
  state: Pick<ChatState, "connectedProviderIds" | "sharedConnectedProviderIds">,
): Promise<void> {
  const freeModels = await listOpencodeFreeModels();
  const userOpenAIAvailable = (state.connectedProviderIds ?? []).includes("openai");
  const sharedGeminiAvailable = (state.sharedConnectedProviderIds ?? []).includes("google");

  stdout.write("Bap Models:\n");
  stdout.write("- Claude Sonnet 4.6 (anthropic/claude-sonnet-4-6) [source=shared]\n");
  stdout.write("- GPT-5.5 (openai/gpt-5.5) [source=shared]\n");
  stdout.write("- GPT-5.4 (openai/gpt-5.4) [source=shared]\n");
  stdout.write("- GPT-5.4 Mini (openai/gpt-5.4-mini) [source=shared]\n");
  stdout.write(
    `- Gemini 3.1 Pro Preview (google/gemini-3.1-pro-preview) [source=shared]${sharedGeminiAvailable ? "" : " [unavailable]"}\n`,
  );
  stdout.write("\nYour AI Accounts:\n");
  if (userOpenAIAvailable) {
    stdout.write("- GPT-5.5 (openai/gpt-5.5) [source=user]\n");
    stdout.write("- GPT-5.4 (openai/gpt-5.4) [source=user]\n");
    stdout.write("- GPT-5.4 Mini (openai/gpt-5.4-mini) [source=user]\n");
  } else {
    stdout.write("- ChatGPT not connected [source=user]\n");
  }
  if (freeModels.length > 0) {
    stdout.write(`\nFree OpenCode Models (${freeModels.length}):\n`);
    for (const model of freeModels) {
      stdout.write(`- ${model.name} (${model.id})\n`);
    }
  }
}
