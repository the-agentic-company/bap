import { isAdminOnlyChatModel } from "@bap/core/lib/chat-model-policy";
import {
  normalizeCoworkerToolAccessMode,
  normalizeCoworkerAllowedSkillSlugs,
  type CoworkerToolAccessMode,
} from "@bap/core/lib/coworker-tool-policy";
import { parseModelReference } from "@bap/core/lib/model-reference";
import {
  normalizeModelAuthSource,
  providerSupportsAuthSource,
  type ProviderAuthSource,
} from "@bap/core/lib/provider-auth-source";
import { normalizeAndEnsureUniqueCoworkerUsername } from "@bap/core/server/services/coworker-metadata";
import { generateCoworkerMetadataOnFirstPromptFill } from "@bap/core/server/services/coworker-metadata";
import {
  removeCoworkerScheduleJob,
  syncCoworkerScheduleJob,
} from "@bap/core/server/services/coworker-scheduler";
import type { IntegrationType } from "@bap/core/server/oauth/config";
import { coworker, user } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { resolveSelectedWorkspaceMcpServerIds } from "@/server/services/coworker-toolbox";

const DISABLED_TRIGGER_TYPES = ["gmail.new_email"] as const;

type ProfileContext = {
  user: { id: string };
  db: typeof import("@bap/db/client").db;
};

function assertModelAllowedForRole(model: string, role: string | null | undefined): void {
  if (isAdminOnlyChatModel(model) && role !== "admin") {
    throw new ORPCError("FORBIDDEN", {
      message: "Claude Sonnet 4.6 is only available to admins.",
    });
  }
}

function resolveCoworkerAuthSource(
  model: string,
  authSource?: ProviderAuthSource | null,
): ProviderAuthSource | null {
  const { providerID } = parseModelReference(model);
  if (authSource && !providerSupportsAuthSource(providerID, authSource)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Model provider "${providerID}" does not support auth source "${authSource}".`,
    });
  }
  return normalizeModelAuthSource({
    model,
    authSource,
  });
}

function normalizeDescriptionInput(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertNewTriggerTypeAllowed(triggerType: string): void {
  if (DISABLED_TRIGGER_TYPES.includes(triggerType as (typeof DISABLED_TRIGGER_TYPES)[number])) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Coworker trigger type is disabled: ${triggerType}`,
    });
  }
}

function normalizeUserInputPromptInput(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertUserInputConfig(input: {
  requiresUserInput?: boolean;
  userInputPrompt?: string | null;
}): void {
  if (input.requiresUserInput && !normalizeUserInputPromptInput(input.userInputPrompt)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "User input prompt is required when user input is required.",
    });
  }
}

async function resolveCoworkerUsername(params: {
  database: unknown;
  coworkerId: string;
  username: string | null | undefined;
}): Promise<string | null> {
  if (typeof params.username !== "string") {
    return null;
  }

  const trimmed = params.username.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = await normalizeAndEnsureUniqueCoworkerUsername({
    database: params.database as {
      query: { coworker: { findFirst: (args: unknown) => Promise<unknown> } };
    },
    coworkerId: params.coworkerId,
    username: trimmed,
  });

  if (!normalized) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Username must contain letters, numbers, or hyphens",
    });
  }

  return normalized;
}

type CoworkerCreateInput = {
  name?: string;
  description?: string | null;
  username?: string | null;
  triggerType: string;
  prompt: string;
  model: string;
  authSource?: ProviderAuthSource | null;
  promptDo?: string | null;
  promptDont?: string | null;
  autoApprove?: boolean;
  toolAccessMode: CoworkerToolAccessMode;
  allowedIntegrations: IntegrationType[];
  allowedCustomIntegrations: string[];
  allowedWorkspaceMcpServerIds: string[];
  allowedSkillSlugs: string[];
  schedule?: typeof coworker.$inferInsert.schedule;
  requiresUserInput?: boolean;
  userInputPrompt?: string | null;
};

export async function createCoworkerProfile(input: {
  context: ProfileContext;
  workspaceId: string;
  payload: CoworkerCreateInput;
}) {
  assertUserInputConfig({
    requiresUserInput: input.payload.requiresUserInput ?? false,
    userInputPrompt: input.payload.userInputPrompt ?? null,
  });
  const coworkerId = crypto.randomUUID();
  const dbUser = await input.context.db.query.user.findFirst({
    where: eq(user.id, input.context.user.id),
    columns: { role: true },
  });
  assertModelAllowedForRole(input.payload.model, dbUser?.role);
  const resolvedAuthSource = resolveCoworkerAuthSource(
    input.payload.model,
    input.payload.authSource,
  );
  const providedName = input.payload.name?.trim();
  const nameToSave = providedName && providedName.length > 0 ? providedName : "";
  const descriptionToSave = normalizeDescriptionInput(input.payload.description);
  const usernameToSave = await resolveCoworkerUsername({
    database: input.context.db,
    coworkerId,
    username: input.payload.username,
  });
  assertNewTriggerTypeAllowed(input.payload.triggerType);
  const allowedWorkspaceMcpServerIds = await resolveSelectedWorkspaceMcpServerIds({
    database: input.context.db as Parameters<
      typeof resolveSelectedWorkspaceMcpServerIds
    >[0]["database"],
    workspaceId: input.workspaceId,
    toolAccessMode: input.payload.toolAccessMode,
    allowedIntegrations: input.payload.allowedIntegrations,
    allowedWorkspaceMcpServerIds: input.payload.allowedWorkspaceMcpServerIds,
  });

  const [created] = await input.context.db
    .insert(coworker)
    .values({
      id: coworkerId,
      name: nameToSave,
      description: descriptionToSave,
      username: usernameToSave,
      ownerId: input.context.user.id,
      workspaceId: input.workspaceId,
      status: "on",
      triggerType: input.payload.triggerType,
      prompt: input.payload.prompt,
      model: input.payload.model,
      authSource: resolvedAuthSource,
      promptDo: input.payload.promptDo,
      promptDont: input.payload.promptDont,
      autoApprove: input.payload.autoApprove ?? true,
      allowedIntegrations: input.payload.allowedIntegrations,
      allowedCustomIntegrations: input.payload.allowedCustomIntegrations,
      allowedWorkspaceMcpServerIds,
      toolAccessMode: input.payload.toolAccessMode,
      allowedSkillSlugs: normalizeCoworkerAllowedSkillSlugs(input.payload.allowedSkillSlugs),
      schedule: input.payload.schedule ?? null,
      requiresUserInput: input.payload.requiresUserInput ?? false,
      userInputPrompt: normalizeUserInputPromptInput(input.payload.userInputPrompt),
    } satisfies typeof coworker.$inferInsert)
    .returning();

  if (created.triggerType === "schedule") {
    try {
      await syncCoworkerScheduleJob(created);
    } catch (error) {
      console.error(`[coworker] failed to sync scheduler after create (${created.id})`, error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Coworker created but failed to sync schedule job",
      });
    }
  }

  return {
    id: created.id,
    name: created.name,
    description: created.description,
    username: created.username,
    status: created.status,
  };
}

type CoworkerUpdateInput = Partial<CoworkerCreateInput> & {
  id: string;
  status?: "on" | "off";
  isPinned?: boolean;
  promptDo?: string | null;
  promptDont?: string | null;
  schedule?: typeof coworker.$inferInsert.schedule | null;
};

async function resolveUpdatedWorkspaceMcpServerIds(input: {
  context: ProfileContext;
  workspaceId: string;
  existing: typeof coworker.$inferSelect;
  payload: CoworkerUpdateInput;
}): Promise<string[] | undefined> {
  const toolboxChanged =
    input.payload.toolAccessMode !== undefined ||
    input.payload.allowedIntegrations !== undefined ||
    input.payload.allowedWorkspaceMcpServerIds !== undefined;

  if (!toolboxChanged) {
    return undefined;
  }

  const allowedIntegrations =
    input.payload.allowedIntegrations ?? input.existing.allowedIntegrations;
  const toolAccessMode =
    input.payload.toolAccessMode ??
    normalizeCoworkerToolAccessMode(input.existing.toolAccessMode, allowedIntegrations);
  const allowedWorkspaceMcpServerIds =
    input.payload.allowedWorkspaceMcpServerIds ??
    (input.payload.allowedIntegrations !== undefined
      ? []
      : (input.existing.allowedWorkspaceMcpServerIds ?? []));

  return resolveSelectedWorkspaceMcpServerIds({
    database: input.context.db as Parameters<
      typeof resolveSelectedWorkspaceMcpServerIds
    >[0]["database"],
    workspaceId: input.workspaceId,
    toolAccessMode,
    allowedIntegrations,
    allowedWorkspaceMcpServerIds,
  });
}

export async function updateCoworkerProfile(input: {
  context: ProfileContext;
  workspaceId: string;
  existing: typeof coworker.$inferSelect;
  payload: CoworkerUpdateInput;
}) {
  const { existing } = input;
  if (input.payload.model !== undefined) {
    const dbUser = await input.context.db.query.user.findFirst({
      where: eq(user.id, input.context.user.id),
      columns: { role: true },
    });
    assertModelAllowedForRole(input.payload.model, dbUser?.role);
  }

  const updates: Partial<typeof coworker.$inferInsert> = {};
  const nextPrompt = input.payload.prompt ?? existing.prompt;
  const nextName =
    input.payload.name !== undefined ? input.payload.name.trim() : (existing.name ?? "");
  const nextDescription =
    input.payload.description !== undefined
      ? normalizeDescriptionInput(input.payload.description)
      : existing.description;
  const nextUsername =
    input.payload.username !== undefined
      ? await resolveCoworkerUsername({
          database: input.context.db,
          coworkerId: existing.id,
          username: input.payload.username,
        })
      : existing.username;
  const nextRequiresUserInput = input.payload.requiresUserInput ?? existing.requiresUserInput;
  const nextUserInputPrompt =
    input.payload.userInputPrompt !== undefined
      ? normalizeUserInputPromptInput(input.payload.userInputPrompt)
      : existing.userInputPrompt;
  assertUserInputConfig({
    requiresUserInput: nextRequiresUserInput,
    userInputPrompt: nextUserInputPrompt,
  });
  const resolvedWorkspaceMcpServerIds = await resolveUpdatedWorkspaceMcpServerIds(input);

  if (input.payload.name !== undefined) {
    updates.name = nextName;
  }
  if (input.payload.description !== undefined) {
    updates.description = nextDescription;
  }
  if (input.payload.username !== undefined) {
    updates.username = nextUsername;
  }
  if (input.payload.status !== undefined) {
    updates.status = input.payload.status;
  }
  if (input.payload.triggerType !== undefined) {
    if (input.payload.triggerType !== existing.triggerType) {
      assertNewTriggerTypeAllowed(input.payload.triggerType);
    }
    updates.triggerType = input.payload.triggerType;
  }
  if (input.payload.prompt !== undefined) {
    updates.prompt = input.payload.prompt;
  }
  if (input.payload.model !== undefined) {
    updates.model = input.payload.model;
    updates.authSource = resolveCoworkerAuthSource(
      input.payload.model,
      input.payload.authSource ?? existing.authSource,
    );
  } else if (input.payload.authSource !== undefined) {
    updates.authSource = resolveCoworkerAuthSource(existing.model, input.payload.authSource);
  }
  if (input.payload.promptDo !== undefined) {
    updates.promptDo = input.payload.promptDo ?? null;
  }
  if (input.payload.promptDont !== undefined) {
    updates.promptDont = input.payload.promptDont ?? null;
  }
  if (input.payload.autoApprove !== undefined) {
    updates.autoApprove = input.payload.autoApprove;
  }
  if (input.payload.isPinned !== undefined) {
    updates.isPinned = input.payload.isPinned;
  }
  if (input.payload.toolAccessMode !== undefined) {
    updates.toolAccessMode = input.payload.toolAccessMode;
  }
  if (input.payload.allowedIntegrations !== undefined) {
    updates.allowedIntegrations = input.payload.allowedIntegrations;
  }
  if (input.payload.allowedCustomIntegrations !== undefined) {
    updates.allowedCustomIntegrations = input.payload.allowedCustomIntegrations;
  }
  if (resolvedWorkspaceMcpServerIds !== undefined) {
    updates.allowedWorkspaceMcpServerIds = resolvedWorkspaceMcpServerIds;
  }
  if (input.payload.allowedSkillSlugs !== undefined) {
    updates.allowedSkillSlugs = normalizeCoworkerAllowedSkillSlugs(input.payload.allowedSkillSlugs);
  }
  if (input.payload.schedule !== undefined) {
    updates.schedule = input.payload.schedule ?? null;
  }
  if (input.payload.requiresUserInput !== undefined) {
    updates.requiresUserInput = input.payload.requiresUserInput;
  }
  if (input.payload.userInputPrompt !== undefined) {
    updates.userInputPrompt = nextUserInputPrompt;
  }

  const metadataUpdates = await generateCoworkerMetadataOnFirstPromptFill({
    database: input.context.db as unknown as {
      query: { coworker: { findFirst: (...args: unknown[]) => Promise<unknown> } };
    },
    current: {
      id: existing.id,
      name: existing.name,
      description: existing.description,
      username: existing.username,
      prompt: existing.prompt,
      triggerType: existing.triggerType,
      allowedIntegrations: existing.allowedIntegrations,
      allowedCustomIntegrations: existing.allowedCustomIntegrations,
      schedule: existing.schedule ?? null,
      autoApprove: existing.autoApprove,
      promptDo: existing.promptDo ?? null,
      promptDont: existing.promptDont ?? null,
    },
    next: {
      id: existing.id,
      name: nextName,
      description: nextDescription,
      username: nextUsername,
      prompt: nextPrompt,
      triggerType: input.payload.triggerType ?? existing.triggerType,
      allowedIntegrations: input.payload.allowedIntegrations ?? existing.allowedIntegrations,
      allowedCustomIntegrations:
        input.payload.allowedCustomIntegrations ?? existing.allowedCustomIntegrations,
      schedule:
        input.payload.schedule === undefined ? existing.schedule : (input.payload.schedule ?? null),
      autoApprove: input.payload.autoApprove ?? existing.autoApprove,
      promptDo:
        input.payload.promptDo === undefined ? existing.promptDo : (input.payload.promptDo ?? null),
      promptDont:
        input.payload.promptDont === undefined
          ? existing.promptDont
          : (input.payload.promptDont ?? null),
    },
  });
  Object.assign(updates, metadataUpdates);

  const result = await input.context.db
    .update(coworker)
    .set(updates)
    .where(
      and(
        eq(coworker.id, input.payload.id),
        eq(coworker.ownerId, input.context.user.id),
        eq(coworker.workspaceId, input.workspaceId),
      ),
    )
    .returning({
      id: coworker.id,
      status: coworker.status,
      triggerType: coworker.triggerType,
      schedule: coworker.schedule,
    });

  if (result.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  const shouldSyncSchedule =
    input.payload.status !== undefined ||
    input.payload.triggerType !== undefined ||
    input.payload.schedule !== undefined;

  if (shouldSyncSchedule) {
    try {
      await syncCoworkerScheduleJob(result[0]!);
    } catch (error) {
      console.error(
        `[coworker] failed to sync scheduler after update (${input.payload.id})`,
        error,
      );
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Coworker updated but failed to sync schedule job",
      });
    }
  }

  return { success: true };
}

export async function deleteCoworkerProfile(input: {
  context: ProfileContext;
  workspaceId: string;
  existing: typeof coworker.$inferSelect;
  coworkerId: string;
}) {
  if (input.existing.triggerType === "schedule") {
    try {
      await removeCoworkerScheduleJob(input.coworkerId);
    } catch (error) {
      console.error(
        `[coworker] failed to remove scheduler before delete (${input.coworkerId})`,
        error,
      );
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Failed to remove coworker schedule job",
      });
    }
  }

  const result = await input.context.db
    .delete(coworker)
    .where(
      and(
        eq(coworker.id, input.coworkerId),
        eq(coworker.ownerId, input.context.user.id),
        eq(coworker.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: coworker.id });

  if (result.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  return { success: true };
}
