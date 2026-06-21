import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { ProviderAuthSource } from "../../lib/provider-auth-source";
import { getResolvedProviderAuth } from "../control-plane/subscription-providers";
import { toRuntimeProviderAuthPayload } from "./provider-auth-runtime";

/**
 * Inject stored subscription provider OAuth tokens into an OpenCode server.
 * Called after sandbox creation to give OpenCode access to the user's
 * ChatGPT/Gemini/Kimi subscriptions.
 */
export async function injectProviderAuth(
  client: OpencodeClient,
  userId: string,
  options?: { openAIAuthSource?: ProviderAuthSource | null; logPrefix?: string },
): Promise<void> {
  const logPrefix = options?.logPrefix ?? "[OpenCode]";
  try {
    const [openaiAuth, googleAuth, kimiAuth] = await Promise.all([
      getResolvedProviderAuth({
        userId,
        provider: "openai",
        authSource: options?.openAIAuthSource,
      }),
      getResolvedProviderAuth({
        userId,
        provider: "google",
        authSource: "shared",
      }),
      getResolvedProviderAuth({
        userId,
        provider: "kimi",
        authSource: "user",
      }),
    ]);

    const auths = [openaiAuth, googleAuth, kimiAuth]
      .filter((auth): auth is NonNullable<typeof auth> => Boolean(auth))
      .map(toRuntimeProviderAuthPayload);
    await Promise.all(
      auths.map(async (auth) => {
        try {
          await client.auth.set(auth);
          console.log(`${logPrefix} Injected ${auth.providerID} auth for user ${userId}`);
        } catch (err) {
          console.error(`${logPrefix} Failed to inject ${auth.providerID} auth:`, err);
        }
      }),
    );
  } catch (err) {
    console.error(`${logPrefix} Failed to load provider auths:`, err);
  }
}
