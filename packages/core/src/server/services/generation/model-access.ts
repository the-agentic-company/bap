import { db } from "@cmdclaw/db/client";
import { user } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { env } from "../../../env";
import { isAdminOnlyChatModel } from "../../../lib/chat-model-policy";
import { parseModelReference } from "../../../lib/model-reference";
import {
  getProviderAuthProviderID,
  getProviderDisplayName,
  normalizeModelAuthSource,
  resolveProviderAuthAvailability,
  type ProviderAuthAvailability,
  type ProviderAuthSource,
} from "../../../lib/provider-auth-source";
import { listOpencodeFreeModels } from "../../ai/opencode-models";
import { getProviderModels } from "../../ai/subscription-providers";
import { hasConnectedProviderAuthForUser } from "../../control-plane/subscription-providers";

export type ModelAccessCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      userMessage: string;
    };

export async function checkModelAccessForUser(params: {
  userId: string;
  model: string;
  authSource?: ProviderAuthSource | null;
}): Promise<ModelAccessCheckResult> {
  const { providerID, modelID } = parseModelReference(params.model);
  const authSource = normalizeModelAuthSource({
    model: params.model,
    authSource: params.authSource,
  });

  if (providerID === "opencode") {
    const models = await listOpencodeFreeModels();
    if (models.some((model) => model.id === params.model)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "opencode_model_unavailable",
      userMessage: "Selected OpenCode model is no longer available. Choose another model and retry.",
    };
  }

  if (isAdminOnlyChatModel(params.model)) {
    const dbUser =
      "user" in db.query
        ? await db.query.user.findFirst({
            where: eq(user.id, params.userId),
            columns: { role: true },
          })
        : null;
    if (dbUser?.role !== "admin") {
      return {
        allowed: false,
        reason: "admin_only_model",
        userMessage: "Claude Sonnet 4.6 is only available to admins. Choose another model and retry.",
      };
    }
  }

  const authProviderID = getProviderAuthProviderID(providerID);
  if (authSource !== null || authProviderID !== null) {
    const availabilityChecks: ProviderAuthAvailability =
      authProviderID === null
        ? resolveProviderAuthAvailability({
            providerID,
            sharedConnectedProviderIds: env.ANTHROPIC_API_KEY ? ["anthropic"] : [],
          })
        : authSource === "user"
          ? {
              user: await hasConnectedProviderAuthForUser(params.userId, authProviderID, "user"),
              shared: false,
            }
          : authSource === "shared"
            ? {
                user: false,
                shared: await hasConnectedProviderAuthForUser(
                  params.userId,
                  authProviderID,
                  "shared",
                ),
              }
            : {
                user: await hasConnectedProviderAuthForUser(
                  params.userId,
                  authProviderID,
                  "user",
                ),
                shared: await hasConnectedProviderAuthForUser(
                  params.userId,
                  authProviderID,
                  "shared",
                ),
              };
    const hasAuth = authSource ? availabilityChecks[authSource] : true;
    if (!hasAuth) {
      const providerLabel = getProviderDisplayName(providerID);
      return {
        allowed: false,
        reason: `${providerID}_not_connected`,
        userMessage:
          authSource === "shared"
            ? `This ${providerLabel} model requires the shared workspace connection. Ask an admin to reconnect it, then retry.`
            : `This ${providerLabel} model requires your connected account. Connect it in Settings > Connected AI Account, then retry.`,
      };
    }
  }

  if (authProviderID === "openai" || authProviderID === "google" || authProviderID === "kimi") {
    const allowedIDs = new Set(getProviderModels(authProviderID).map((model) => model.id));
    if (!allowedIDs.has(modelID)) {
      const providerLabel = getProviderDisplayName(providerID);
      return {
        allowed: false,
        reason: `${providerID}_model_not_allowed`,
        userMessage: `Selected ${providerLabel} model is not available for your current connection. Choose another model and retry.`,
      };
    }
    return { allowed: true };
  }

  if (providerID === "anthropic") {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "provider_not_supported",
    userMessage: `Selected model provider "${providerID}" is not supported in this environment.`,
  };
}
