import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { ProviderAuthSource } from "../../lib/provider-auth-source";
import { getResolvedProviderAuth } from "../control-plane/subscription-providers";
import {
  toRuntimeProviderAuthPayload,
  type RuntimeProviderAuthPayload,
} from "./provider-auth-runtime";

const AUTH_SET_MAX_ATTEMPTS = 3;
const AUTH_SET_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getSdkError(result: unknown): unknown | null {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return null;
  }
  const error = (result as { error?: unknown }).error;
  return error || null;
}

async function setRuntimeProviderAuth(
  client: OpencodeClient,
  auth: RuntimeProviderAuthPayload,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= AUTH_SET_MAX_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- retries are intentionally bounded per provider
      const result = await client.auth.set(auth);
      const sdkError = getSdkError(result);
      if (sdkError) {
        throw new Error(`OpenCode auth.set returned error: ${formatError(sdkError)}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= AUTH_SET_MAX_ATTEMPTS) {
        break;
      }
      // eslint-disable-next-line no-await-in-loop -- retry delay is intentionally bounded per provider
      await sleep(AUTH_SET_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`OpenCode auth.set failed: ${formatError(lastError)}`);
}

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
    for (const auth of auths) {
      try {
        // eslint-disable-next-line no-await-in-loop -- OpenCode auth writes must be serialized
        await setRuntimeProviderAuth(client, auth);
        console.log(`${logPrefix} Injected ${auth.providerID} auth for user ${userId}`);
      } catch (err) {
        console.error(
          `${logPrefix} Failed to inject ${auth.providerID} auth after ${AUTH_SET_MAX_ATTEMPTS} attempts:`,
          err,
        );
      }
    }
  } catch (err) {
    console.error(`${logPrefix} Failed to load provider auths:`, err);
  }
}
