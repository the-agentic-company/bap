import { isAdminOnlyChatModel } from "@bap/core/lib/chat-model-policy";
import {
  COWORKER_TOOL_ACCESS_MODES,
  normalizeCoworkerAllowedSkillSlugs,
} from "@bap/core/lib/coworker-tool-policy";
import { parseModelReference } from "@bap/core/lib/model-reference";
import {
  normalizeModelAuthSource,
  providerSupportsAuthSource,
  type ProviderAuthSource,
} from "@bap/core/lib/provider-auth-source";
import { normalizeAndEnsureUniqueCoworkerUsername } from "@bap/core/server/services/coworker-metadata";
import {
  createFileAssetFromBuffer,
  markFileAssetReference,
} from "@bap/core/server/services/file-asset-service";
import { downloadFromS3 } from "@bap/core/server/storage/s3-client";
import { conversation, coworker, coworkerDocument, coworkerRun, sandboxFile } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { uploadCoworkerDocument } from "@/server/services/coworker-document";
import { ensureBuilderCoworkerMetadata } from "@/server/services/coworker-builder-metadata";
import {
  getResolvedCoworkerToolPolicy,
  resolveSelectedWorkspaceMcpServerIds,
} from "@/server/services/coworker-toolbox";

const integrationTypeSchema = z.enum([
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
]);
const toolAccessModeSchema = z.enum(COWORKER_TOOL_ACCESS_MODES);
const providerAuthSourceSchema = z.enum(["user", "shared"]);
const triggerTypeSchema = z.string().min(1).max(128);
const userInputPromptSchema = z.string().max(1000).nullish();
const modelReferenceSchema = z
  .string()
  .min(3)
  .refine((value) => {
    try {
      parseModelReference(value);
      return true;
    } catch {
      return false;
    }
  }, "Model must use provider/model format");

const scheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    intervalMinutes: z.number().min(60).max(10080),
  }),
  z.object({
    type: z.literal("daily"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    timezone: z.string().default("UTC"),
  }),
  z.object({
    type: z.literal("weekly"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    daysOfWeek: z.array(z.number().min(0).max(6)).min(1),
    timezone: z.string().default("UTC"),
  }),
  z.object({
    type: z.literal("monthly"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    dayOfMonth: z.number().min(1).max(31),
    timezone: z.string().default("UTC"),
  }),
]);

const coworkerDefinitionDocumentSchema = z.object({
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  description: z.string().max(2000).nullish(),
  contentBase64: z.string().min(1),
});

const coworkerDefinitionArtifactSchema = z.object({
  path: z.string().min(1).max(2000),
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  contentBase64: z.string().min(1),
});

const coworkerDefinitionSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string().datetime(),
  coworker: z.object({
    name: z.string().max(128),
    description: z.string().max(280).nullable(),
    username: z.string().max(128).nullable(),
    status: z.enum(["on", "off"]),
    triggerType: triggerTypeSchema,
    prompt: z.string().max(20000),
    model: modelReferenceSchema,
    authSource: providerAuthSourceSchema.nullable(),
    autoApprove: z.boolean(),
    toolAccessMode: toolAccessModeSchema,
    allowedIntegrations: z.array(integrationTypeSchema),
    allowedCustomIntegrations: z.array(z.string()),
    allowedWorkspaceMcpServerIds: z.array(z.string()),
    allowedSkillSlugs: z.array(z.string()),
    schedule: scheduleSchema.nullable(),
    requiresUserInput: z.boolean().default(false),
    userInputPrompt: userInputPromptSchema,
  }),
  documents: z.array(coworkerDefinitionDocumentSchema).default([]),
  artifacts: z.array(coworkerDefinitionArtifactSchema).default([]),
});

type CoworkerDefinition = z.infer<typeof coworkerDefinitionSchema>;

type DefinitionContext = {
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
  return normalizeModelAuthSource({ model, authSource });
}

function normalizeDescriptionInput(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

async function createBuilderConversationForImportedArtifacts(params: {
  context: DefinitionContext;
  workspaceId: string;
  coworkerId: string;
  coworkerName: string;
  model: string;
  authSource: ProviderAuthSource | null;
}): Promise<string> {
  const [createdConversation] = await params.context.db
    .insert(conversation)
    .values({
      userId: params.context.user.id,
      workspaceId: params.workspaceId,
      type: "coworker",
      title: `${params.coworkerName || "Coworker"} – Chat`,
      model: params.model,
      authSource: params.authSource,
      autoApprove: false,
    })
    .returning({ id: conversation.id });

  if (!createdConversation) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Failed to create artifact conversation",
    });
  }

  await params.context.db
    .update(coworker)
    .set({ builderConversationId: createdConversation.id })
    .where(eq(coworker.id, params.coworkerId));

  return createdConversation.id;
}

async function importCoworkerArtifacts(params: {
  context: DefinitionContext;
  workspaceId: string;
  coworkerId: string;
  coworkerName: string;
  model: string;
  authSource: ProviderAuthSource | null;
  artifacts: z.infer<typeof coworkerDefinitionArtifactSchema>[];
}) {
  if (params.artifacts.length === 0) {
    return;
  }

  const conversationId = await createBuilderConversationForImportedArtifacts({
    context: params.context,
    workspaceId: params.workspaceId,
    coworkerId: params.coworkerId,
    coworkerName: params.coworkerName,
    model: params.model,
    authSource: params.authSource,
  });

  await Promise.all(
    params.artifacts.map(async (artifact) => {
      const fileBuffer = Buffer.from(artifact.contentBase64, "base64");
      const asset = await createFileAssetFromBuffer({
        database: params.context.db,
        userId: params.context.user.id,
        workspaceId: params.workspaceId,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        content: fileBuffer,
      });

      const [created] = await params.context.db
        .insert(sandboxFile)
        .values({
          conversationId,
          fileAssetId: asset.id,
          path: artifact.path,
          filename: asset.filename,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          storageKey: asset.storageKey,
        })
        .returning({ id: sandboxFile.id });

      if (created) {
        await markFileAssetReference({
          database: params.context.db,
          fileAssetId: asset.id,
          kind: "sandbox_file",
          referenceId: created.id,
        });
      }
    }),
  );
}

export async function exportCoworkerDefinition(input: {
  context: DefinitionContext;
  coworker: typeof coworker.$inferSelect;
}) {
  const wf = await ensureBuilderCoworkerMetadata({
    context: input.context,
    wf: input.coworker,
  });
  const { toolAccessMode, allowedSkillSlugs } = getResolvedCoworkerToolPolicy(wf);
  const documents = await input.context.db.query.coworkerDocument.findMany({
    where: eq(coworkerDocument.coworkerId, wf.id),
    orderBy: (document, { asc }) => [asc(document.createdAt)],
    with: {
      fileAsset: true,
    },
  });
  const latestRun = await input.context.db.query.coworkerRun.findFirst({
    where: eq(coworkerRun.coworkerId, wf.id),
    orderBy: (run, { desc }) => [desc(run.startedAt)],
    columns: {
      conversationId: true,
    },
  });
  const artifactConversationIds = [
    wf.builderConversationId,
    latestRun?.conversationId ?? null,
  ].filter((conversationId): conversationId is string => Boolean(conversationId));
  const artifactFiles =
    artifactConversationIds.length > 0
      ? await input.context.db.query.sandboxFile.findMany({
          where: inArray(sandboxFile.conversationId, artifactConversationIds),
          orderBy: (file, { asc }) => [asc(file.createdAt)],
          with: {
            fileAsset: true,
          },
        })
      : [];
  const uniqueArtifactFiles = Array.from(
    new Map(artifactFiles.map((file) => [file.id, file])).values(),
  ).filter((file) => Boolean(file.fileAsset?.storageKey ?? file.storageKey));

  return {
    version: 2 as const,
    exportedAt: new Date().toISOString(),
    coworker: {
      name: wf.name ?? "",
      description: wf.description,
      username: wf.username,
      status: wf.status,
      triggerType: wf.triggerType,
      prompt: wf.prompt,
      model: wf.model,
      authSource: wf.authSource,
      autoApprove: wf.autoApprove,
      toolAccessMode,
      allowedIntegrations: wf.allowedIntegrations,
      allowedCustomIntegrations: wf.allowedCustomIntegrations,
      allowedWorkspaceMcpServerIds: wf.allowedWorkspaceMcpServerIds,
      allowedSkillSlugs,
      schedule: wf.schedule ?? null,
      requiresUserInput: wf.requiresUserInput,
      userInputPrompt: wf.userInputPrompt,
    },
    documents: await Promise.all(
      documents.map(async (document) => ({
        filename: document.filename,
        mimeType: document.mimeType,
        description: document.description,
        contentBase64: (
          await downloadFromS3(document.fileAsset?.storageKey ?? document.storageKey)
        ).toString("base64"),
      })),
    ),
    artifacts: await Promise.all(
      uniqueArtifactFiles.map(async (file) => ({
        path: file.path,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        contentBase64: (
          await downloadFromS3(file.fileAsset?.storageKey ?? (file.storageKey as string))
        ).toString("base64"),
      })),
    ),
  };
}

export async function importSharedCoworkerDefinition(input: {
  context: DefinitionContext;
  workspaceId: string;
  sourceCoworkerId: string;
  userRole: string | null | undefined;
}) {
  const source = await input.context.db.query.coworker.findFirst({
    where: eq(coworker.id, input.sourceCoworkerId),
  });

  if (!source || source.workspaceId !== input.workspaceId || !source.sharedAt) {
    throw new ORPCError("NOT_FOUND", {
      message: "Shared coworker not found",
    });
  }

  assertModelAllowedForRole(source.model, input.userRole);

  const definition = coworkerDefinitionSchema.parse(
    await exportCoworkerDefinition({
      context: input.context,
      coworker: source,
    }),
  );

  return importCoworkerDefinition({
    context: input.context,
    workspaceId: input.workspaceId,
    definition,
    userRole: input.userRole,
  });
}

async function importCoworkerDefinition(input: {
  context: DefinitionContext;
  workspaceId: string;
  definition: CoworkerDefinition;
  userRole: string | null | undefined;
}) {
  const { definition } = input;

  assertModelAllowedForRole(definition.coworker.model, input.userRole);
  assertUserInputConfig({
    requiresUserInput: definition.coworker.requiresUserInput,
    userInputPrompt: definition.coworker.userInputPrompt,
  });

  const coworkerId = crypto.randomUUID();
  const username = await resolveCoworkerUsername({
    database: input.context.db,
    coworkerId,
    username: definition.coworker.username,
  });
  const resolvedAuthSource = resolveCoworkerAuthSource(
    definition.coworker.model,
    definition.coworker.authSource,
  );
  const allowedWorkspaceMcpServerIds = await resolveSelectedWorkspaceMcpServerIds({
    database: input.context.db as Parameters<
      typeof resolveSelectedWorkspaceMcpServerIds
    >[0]["database"],
    workspaceId: input.workspaceId,
    toolAccessMode: definition.coworker.toolAccessMode,
    allowedIntegrations: definition.coworker.allowedIntegrations,
    allowedWorkspaceMcpServerIds: [],
  });

  const [created] = await input.context.db
    .insert(coworker)
    .values({
      id: coworkerId,
      name: definition.coworker.name.trim(),
      description: normalizeDescriptionInput(definition.coworker.description),
      username,
      ownerId: input.context.user.id,
      workspaceId: input.workspaceId,
      status: "off",
      triggerType: definition.coworker.triggerType,
      prompt: definition.coworker.prompt,
      model: definition.coworker.model,
      authSource: resolvedAuthSource,
      autoApprove: definition.coworker.autoApprove,
      toolAccessMode: definition.coworker.toolAccessMode,
      allowedIntegrations: definition.coworker.allowedIntegrations,
      allowedCustomIntegrations: definition.coworker.allowedCustomIntegrations,
      allowedWorkspaceMcpServerIds,
      allowedSkillSlugs: normalizeCoworkerAllowedSkillSlugs(definition.coworker.allowedSkillSlugs),
      schedule: definition.coworker.schedule,
      requiresUserInput: definition.coworker.requiresUserInput,
      userInputPrompt: normalizeUserInputPromptInput(definition.coworker.userInputPrompt),
      sharedAt: null,
    })
    .returning({
      id: coworker.id,
      name: coworker.name,
      description: coworker.description,
      username: coworker.username,
      status: coworker.status,
    });

  await Promise.all(
    definition.documents.map((document) =>
      uploadCoworkerDocument({
        database: input.context.db,
        userId: input.context.user.id,
        coworkerId,
        filename: document.filename,
        mimeType: document.mimeType,
        contentBase64: document.contentBase64,
        description: document.description ?? undefined,
      }),
    ),
  );

  await importCoworkerArtifacts({
    context: input.context,
    workspaceId: input.workspaceId,
    coworkerId,
    coworkerName: definition.coworker.name.trim(),
    model: definition.coworker.model,
    authSource: resolvedAuthSource,
    artifacts: definition.artifacts,
  });

  return created;
}

export async function importCoworkerDefinitionFromJson(input: {
  context: DefinitionContext;
  workspaceId: string;
  definitionJson: string;
  userRole: string | null | undefined;
}) {
  let parsedDefinition: unknown;

  try {
    parsedDefinition = JSON.parse(input.definitionJson);
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "Coworker JSON is not valid JSON.",
    });
  }

  return importCoworkerDefinition({
    context: input.context,
    workspaceId: input.workspaceId,
    definition: coworkerDefinitionSchema.parse(parsedDefinition),
    userRole: input.userRole,
  });
}
