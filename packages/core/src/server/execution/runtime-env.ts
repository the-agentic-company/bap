import { db } from "@cmdclaw/db/client";
import { user } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { env } from "../../env";
import type { IntegrationType } from "../oauth/config";
import {
  filterCliEnvToAllowedIntegrations,
  getCliEnvForUser,
  getCliInstructionsWithCustom,
  getEnabledIntegrationTypes,
} from "../integrations/cli-env";
import {
  getRemoteIntegrationCredentials,
  type RemoteIntegrationSource,
} from "../integrations/remote-integrations";
import { resolveSandboxRuntimeAppUrl } from "../sandbox/prep/runtime-env-prep";

function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildRuntimeEnvSourcedCommand(params: {
  command: string;
  workdir?: string;
}): string {
  const workdir = params.workdir?.trim() || "/app";
  const script = [
    "set -o allexport",
    "[ ! -f /app/.cmdclaw/runtime-env.sh ] || . /app/.cmdclaw/runtime-env.sh",
    "set +o allexport",
    `cd ${escapeShellArg(workdir)}`,
    params.command,
  ].join("\n");
  return `bash -lc ${escapeShellArg(script)}`;
}

export type RuntimeEnvironmentInput = {
  userId: string;
  conversationId: string;
  allowedIntegrations?: IntegrationType[];
  remoteIntegrationSource?: RemoteIntegrationSource | null;
};

export type RuntimeEnvironmentResolution = {
  allowedIntegrations: IntegrationType[];
  cliInstructions: string;
  integrationEnvs: Record<string, string>;
  sandboxRuntimeEnv: Record<string, string | null | undefined>;
  userTimezone: string | null;
};

export async function resolveRuntimeEnvironmentForTurn(
  input: RuntimeEnvironmentInput,
  callbacks?: {
    onRemoteCredentialsAttached?: (input: {
      remoteUserEmail?: string | null;
      allowedIntegrations: IntegrationType[];
      attachedTokenEnvVarNames: string[];
    }) => void;
  },
): Promise<RuntimeEnvironmentResolution> {
  const userTimezonePromise =
    typeof db.query.user?.findFirst === "function"
      ? db.query.user.findFirst({
          where: eq(user.id, input.userId),
          columns: { timezone: true },
        })
      : Promise.resolve(null);
  const [cliEnv, enabledIntegrations, dbUser] = await Promise.all([
    getCliEnvForUser(input.userId),
    getEnabledIntegrationTypes(input.userId),
    userTimezonePromise,
  ]);
  const allowedIntegrations = input.allowedIntegrations ?? enabledIntegrations;
  const cliInstructions = await getCliInstructionsWithCustom(allowedIntegrations, input.userId);
  let filteredCliEnv = filterCliEnvToAllowedIntegrations(cliEnv, input.allowedIntegrations);

  if (input.remoteIntegrationSource && allowedIntegrations.length > 0) {
    const remoteCredentials = await getRemoteIntegrationCredentials({
      targetEnv: input.remoteIntegrationSource.targetEnv,
      remoteUserId: input.remoteIntegrationSource.remoteUserId,
      integrationTypes: allowedIntegrations,
      requestedByUserId: input.remoteIntegrationSource.requestedByUserId,
      requestedByEmail: input.remoteIntegrationSource.requestedByEmail ?? null,
    });
    const attachedTokenEnvVarNames = Object.keys(remoteCredentials.tokens).toSorted();
    callbacks?.onRemoteCredentialsAttached?.({
      remoteUserEmail:
        input.remoteIntegrationSource.remoteUserEmail ?? remoteCredentials.remoteUserEmail,
      allowedIntegrations,
      attachedTokenEnvVarNames,
    });

    filteredCliEnv = {
      ...filteredCliEnv,
      ...remoteCredentials.tokens,
    };
  }

  if (input.allowedIntegrations !== undefined) {
    filteredCliEnv.ALLOWED_INTEGRATIONS = input.allowedIntegrations.join(",");
  }
  if (dbUser?.timezone) {
    filteredCliEnv.CMDCLAW_USER_TIMEZONE = dbUser.timezone;
  }

  return {
    allowedIntegrations,
    cliInstructions,
    integrationEnvs: filteredCliEnv,
    sandboxRuntimeEnv: {
      ...filteredCliEnv,
      APP_URL: resolveSandboxRuntimeAppUrl(),
      CMDCLAW_SERVER_SECRET: env.CMDCLAW_SERVER_SECRET || "",
      CONVERSATION_ID: input.conversationId,
    },
    userTimezone: dbUser?.timezone ?? null,
  };
}
