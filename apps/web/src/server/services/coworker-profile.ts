import { isRetiredChatModel } from "@bap/core/lib/chat-model-policy";
import {
  normalizeCoworkerToolAccessMode,
  normalizeCoworkerAllowedSkillSlugs,
  type CoworkerToolAccessMode,
} from "@bap/core/lib/coworker-tool-policy";
import {
  COWORKER_RUN_BACKLOG_LIMIT,
  COWORKER_RUN_BACKLOG_STATUSES,
} from "@bap/core/server/services/coworker-run-policy";
import {
  applyCanonicalCoworkerChange,
  type CoworkerConfigurationPatch,
} from "@bap/core/server/services/coworker-change-service";
import { createDrizzleCoworkerChangeRepository } from "@bap/core/server/services/coworker-change-repository";
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
import {
  coworker,
  coworkerFolder,
  coworkerMemberPreference,
  coworkerRun,
  user,
} from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { resolveSelectedWorkspaceMcpServerIds } from "@/server/services/coworker-toolbox";
import { activateCoworkerAutomationRegistration } from "@/server/services/coworker-automation-registration";

const DISABLED_TRIGGER_TYPES = ["gmail.new_email"] as const;
const RESET_REQUIRED_ENABLE_MESSAGE = "Reset coworker runs before enabling automated triggers.";

type ProfileContext = {
  user: { id: string };
  db: typeof import("@bap/db/client").db;
};

function assertModelIsSelectable(model: string): void {
  if (isRetiredChatModel(model)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Anthropic models are no longer available. Choose a GPT model instead.",
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

async function assertCanEnableCoworker(input: {
  context: ProfileContext;
  existing: typeof coworker.$inferSelect;
}): Promise<void> {
  if (input.existing.disabledReason === "run_backlog_limit") {
    throw new ORPCError("BAD_REQUEST", {
      message: RESET_REQUIRED_ENABLE_MESSAGE,
    });
  }

  const backlogRuns = await input.context.db.query.coworkerRun.findMany({
    where: and(
      eq(coworkerRun.coworkerId, input.existing.id),
      inArray(coworkerRun.status, [...COWORKER_RUN_BACKLOG_STATUSES]),
    ),
    columns: { id: true },
    limit: COWORKER_RUN_BACKLOG_LIMIT,
  });

  if (backlogRuns.length >= COWORKER_RUN_BACKLOG_LIMIT) {
    throw new ORPCError("BAD_REQUEST", {
      message: RESET_REQUIRED_ENABLE_MESSAGE,
    });
  }
}

async function resolveCreateFolderSharing(input: {
  context: ProfileContext;
  workspaceId: string;
  userId: string;
  folderId: string | null;
  requestedVisibility: "private" | "workspace";
}) {
  if (!input.folderId) {
    return {
      folderId: null,
      sharedAt: input.requestedVisibility === "workspace" ? new Date() : null,
      visibility: input.requestedVisibility,
    };
  }

  const folders = await input.context.db.query.coworkerFolder.findMany({
    where: eq(coworkerFolder.workspaceId, input.workspaceId),
  });
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  let current = foldersById.get(input.folderId);
  if (!current) {
    throw new ORPCError("BAD_REQUEST", { message: "Folder not found." });
  }

  const seen = new Set<string>();
  while (current.parentId) {
    if (seen.has(current.id)) {
      throw new ORPCError("BAD_REQUEST", { message: "Folder tree contains a cycle." });
    }
    seen.add(current.id);
    const parent = foldersById.get(current.parentId);
    if (!parent) {
      break;
    }
    current = parent;
  }

  if (current.visibility === "private" && current.ownerId !== input.userId) {
    throw new ORPCError("BAD_REQUEST", { message: "Folder not found." });
  }

  return {
    folderId: input.folderId,
    sharedAt: current.visibility === "workspace" ? new Date() : null,
    visibility: current.visibility,
  };
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
  autoApprove?: boolean;
  toolAccessMode: CoworkerToolAccessMode;
  allowedIntegrations: IntegrationType[];
  allowedCustomIntegrations: string[];
  allowedWorkspaceMcpServerIds: string[];
  allowedSkillSlugs: string[];
  folderId?: string | null;
  visibility?: "private" | "workspace";
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
    columns: { name: true, email: true, image: true },
  });
  assertModelIsSelectable(input.payload.model);
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
  const initialFolder = await resolveCreateFolderSharing({
    context: input.context,
    workspaceId: input.workspaceId,
    userId: input.context.user.id,
    folderId: input.payload.folderId ?? null,
    requestedVisibility: input.payload.visibility ?? "private",
  });

  const [created] = await input.context.db
    .insert(coworker)
    .values({
      id: coworkerId,
      name: nameToSave,
      description: descriptionToSave,
      username: usernameToSave,
      ownerId: input.context.user.id,
      createdByUserId: input.context.user.id,
      createdByNameSnapshot: dbUser?.name ?? dbUser?.email ?? null,
      createdByAvatarSnapshot: dbUser?.image ?? null,
      workspaceId: input.workspaceId,
      folderId: initialFolder.folderId,
      sharedAt: initialFolder.sharedAt,
      visibility: initialFolder.visibility,
      automationOwnerUserId: input.context.user.id,
      automationOwnerConsentedAt: new Date(),
      status: "on",
      triggerType: input.payload.triggerType,
      prompt: input.payload.prompt,
      model: input.payload.model,
      authSource: resolvedAuthSource,
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
  isHidden?: boolean;
  schedule?: typeof coworker.$inferInsert.schedule | null;
  expectedRevision?: number;
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
  membershipRole: string | null;
}) {
  const { existing } = input;
  if (input.payload.model !== undefined) {
    assertModelIsSelectable(input.payload.model);
  }

  const updates: Partial<typeof coworker.$inferInsert> = {};
  if (input.payload.visibility !== undefined && existing.folderId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Folder-contained coworker visibility is controlled by its folder.",
    });
  }
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
    if (input.payload.status === "on" && existing.status !== "on") {
      await assertCanEnableCoworker({
        context: input.context,
        existing,
      });
    }
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
  if (input.payload.autoApprove !== undefined) {
    updates.autoApprove = input.payload.autoApprove;
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
  if (input.payload.visibility !== undefined) {
    updates.visibility = input.payload.visibility;
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
    },
  });
  Object.assign(updates, metadataUpdates);

  const canonicalFieldNames = new Set([
    "name",
    "description",
    "username",
    "status",
    "triggerType",
    "prompt",
    "model",
    "authSource",
    "autoApprove",
    "toolAccessMode",
    "allowedIntegrations",
    "allowedCustomIntegrations",
    "allowedWorkspaceMcpServerIds",
    "allowedSkillSlugs",
    "schedule",
    "requiresUserInput",
    "userInputPrompt",
    "visibility",
  ]);
  const canonicalChanges = Object.fromEntries(
    Object.entries(updates).filter(([field]) => canonicalFieldNames.has(field)),
  ) as CoworkerConfigurationPatch;
  let changedConfiguration:
    | Extract<Awaited<ReturnType<typeof applyCanonicalCoworkerChange>>, { kind: "applied" }>
    | undefined;

  if (Object.keys(canonicalChanges).length > 0) {
    const actor = await input.context.db.query.user.findFirst({
      where: eq(user.id, input.context.user.id),
      columns: { name: true, image: true },
    });
    const changeResult = await applyCanonicalCoworkerChange({
      repository: createDrizzleCoworkerChangeRepository(input.context.db),
      coworkerId: existing.id,
      actor: {
        userId: input.context.user.id,
        name: actor?.name ?? null,
        avatar: actor?.image ?? null,
        workspaceRole: input.membershipRole,
        isActiveWorkspaceMember: true,
      },
      origin: "direct",
      expectedRevision: input.payload.expectedRevision ?? existing.configurationRevision ?? 0,
      changes: canonicalChanges,
    });
    if (changeResult.kind === "not_found") {
      throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
    }
    if (changeResult.kind === "forbidden") {
      throw new ORPCError("FORBIDDEN", { message: "Coworker action is not allowed" });
    }
    if (changeResult.kind === "conflict") {
      throw new ORPCError("CONFLICT", {
        message: "Coworker changed since this edit was prepared",
        data: changeResult,
      });
    }
    if (changeResult.kind === "applied") {
      changedConfiguration = changeResult;
    }
  }

  const scheduleWasEdited = Boolean(
    changedConfiguration?.coworker.configuration.triggerType === "schedule" &&
    changedConfiguration.revision.changedFields.some(
      (field) => field === "schedule" || field === "triggerType",
    ),
  );
  if (scheduleWasEdited) {
    const actor = await input.context.db.query.user.findFirst({
      where: eq(user.id, input.context.user.id),
      columns: { name: true, image: true },
    });
    await activateCoworkerAutomationRegistration({
      database: input.context.db,
      coworkerId: existing.id,
      workspaceId: input.workspaceId,
      actor: {
        userId: input.context.user.id,
        name: actor?.name ?? null,
        image: actor?.image ?? null,
      },
    });
  }

  if (input.payload.isPinned !== undefined || input.payload.isHidden !== undefined) {
    await input.context.db
      .insert(coworkerMemberPreference)
      .values({
        coworkerId: existing.id,
        userId: input.context.user.id,
        isPinned: input.payload.isPinned ?? false,
        isHidden: input.payload.isHidden ?? false,
      })
      .onConflictDoUpdate({
        target: [coworkerMemberPreference.coworkerId, coworkerMemberPreference.userId],
        set: {
          ...(input.payload.isPinned !== undefined ? { isPinned: input.payload.isPinned } : {}),
          ...(input.payload.isHidden !== undefined ? { isHidden: input.payload.isHidden } : {}),
          updatedAt: new Date(),
        },
      });
  }

  const shouldSyncSchedule =
    input.payload.status !== undefined ||
    input.payload.triggerType !== undefined ||
    input.payload.schedule !== undefined;

  if (shouldSyncSchedule) {
    try {
      const configuration = changedConfiguration?.coworker.configuration;
      await syncCoworkerScheduleJob({
        id: existing.id,
        status: configuration?.status ?? existing.status,
        triggerType: configuration?.triggerType ?? existing.triggerType,
        schedule: configuration?.schedule ?? existing.schedule,
      });
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

export async function setCoworkerStatus(input: {
  context: ProfileContext;
  workspaceId: string;
  existing: typeof coworker.$inferSelect;
  status: "on" | "off";
  membershipRole: string | null;
}) {
  if (input.status === "on" && input.existing.status !== "on") {
    await assertCanEnableCoworker({
      context: input.context,
      existing: input.existing,
    });
  }

  await updateCoworkerProfile({
    context: input.context,
    workspaceId: input.workspaceId,
    existing: input.existing,
    membershipRole: input.membershipRole,
    payload: {
      id: input.existing.id,
      status: input.status,
      expectedRevision: input.existing.configurationRevision,
    },
  });

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
    .where(and(eq(coworker.id, input.coworkerId), eq(coworker.workspaceId, input.workspaceId)))
    .returning({ id: coworker.id });

  if (result.length === 0) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  return { success: true };
}
