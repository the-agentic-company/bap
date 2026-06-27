import {
  buildAccessibleSkillWhere,
  buildOwnedSkillWhere,
  copySkillToWorkspaceOwner,
  resolveUniqueSkillNameInWorkspace,
} from "@bap/core/server/services/workspace-skill-service";
import {
  appendRuntimeVolumeSkillSlug,
  buildOwnedSkillsRuntimeVolumePrefix,
  buildSharedSkillsRuntimeVolumePrefix,
  buildRuntimeVolumeObjectKey,
  copyRuntimeVolumePrefix,
  deleteRuntimeVolumeFile,
  deleteRuntimeVolumePrefix,
  readRuntimeVolumeFile,
  reconcileRuntimeVolumeProjection,
  writeRuntimeVolumeFile,
} from "@bap/core/server/services/runtime-volume-service";
import {
  assertReadyFileAssetsForWorkspace,
  getFileAssetDownloadUrl,
} from "@bap/core/server/services/file-asset-service";
import { downloadFromS3, getPresignedDownloadUrl } from "@bap/core/server/storage/s3-client";
import { skill, skillDocument, skillFile } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { extractSkillToolIntegrations } from "@/lib/skill-markdown";
import { importSkill } from "@/server/services/skill-import";
import { validateFileUpload } from "@/server/storage/validation";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess } from "../workspace-access";

function toSkillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function generateSkillMd(displayName: string, slug: string, description: string): string {
  return `---
name: ${slug}
description: ${description}
---

# ${displayName}

Add your skill instructions here...
`;
}

function decodeRpcContent(contentBase64: string): string {
  return Buffer.from(contentBase64, "base64").toString("utf8");
}

function buildOwnedSkillRuntimeVolumePrefix(input: {
  workspaceId: string;
  userId: string;
  skillName: string;
}): string {
  return appendRuntimeVolumeSkillSlug(
    buildOwnedSkillsRuntimeVolumePrefix({
      workspaceId: input.workspaceId,
      userId: input.userId,
    }),
    input.skillName,
  );
}

function buildSharedSkillRuntimeVolumePrefix(input: {
  workspaceId: string;
  skillName: string;
}): string {
  return appendRuntimeVolumeSkillSlug(
    buildSharedSkillsRuntimeVolumePrefix({ workspaceId: input.workspaceId }),
    input.skillName,
  );
}

function buildReadableSkillRuntimeVolumePrefix(input: {
  workspaceId: string;
  currentUserId: string;
  skill: {
    name: string;
    userId: string;
    visibility: "private" | "public";
  };
}): string {
  if (input.skill.userId === input.currentUserId) {
    return buildOwnedSkillRuntimeVolumePrefix({
      workspaceId: input.workspaceId,
      userId: input.currentUserId,
      skillName: input.skill.name,
    });
  }

  return buildSharedSkillRuntimeVolumePrefix({
    workspaceId: input.workspaceId,
    skillName: input.skill.name,
  });
}

async function hydrateSkillTextFiles(input: {
  workspaceId: string;
  currentUserId: string;
  skill: {
    name: string;
    userId: string;
    visibility: "private" | "public";
  };
  files: Array<{
    id: string;
    path: string;
    content: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  const storagePrefix = buildReadableSkillRuntimeVolumePrefix(input);
  return await Promise.all(
    input.files.map(async (file) => ({
      ...file,
      content: (
        await readRuntimeVolumeFile({
          storagePrefix,
          relativePath: file.path,
        })
      ).toString("utf8"),
    })),
  );
}

function formatSkillSummary(
  row: {
    id: string;
    name: string;
    displayName: string;
    description: string;
    icon: string | null;
    enabled: boolean;
    visibility: "private" | "public";
    createdAt: Date;
    updatedAt: Date;
    files: Array<{
      path: string;
      content: string | null;
    }>;
    user: {
      id: string;
      name: string | null;
      email: string | null;
    };
    userId: string;
  },
  currentUserId: string,
) {
  const isOwnedByCurrentUser = row.userId === currentUserId;
  const skillMd = row.files.find((file) => file.path === "SKILL.md");
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    icon: row.icon,
    enabled: row.enabled,
    visibility: row.visibility,
    owner: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
    },
    isOwnedByCurrentUser,
    canEdit: isOwnedByCurrentUser,
    toolIntegrations: skillMd ? extractSkillToolIntegrations(skillMd.content ?? "") : [],
    fileCount: row.files.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireOwnedSkillInActiveWorkspace(
  context: {
    user: { id: string };
    db: typeof import("@bap/db/client").db;
  },
  skillId: string,
) {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id);

  const existingSkill = await context.db.query.skill.findFirst({
    where: and(eq(skill.id, skillId), buildOwnedSkillWhere(workspaceId, context.user.id)),
  });

  if (!existingSkill) {
    throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
  }

  return { existingSkill, workspaceId };
}

async function requireReadableSkillInActiveWorkspace(
  context: {
    user: { id: string };
    db: typeof import("@bap/db/client").db;
  },
  skillId: string,
) {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id);

  const existingSkill = await context.db.query.skill.findFirst({
    where: and(eq(skill.id, skillId), buildAccessibleSkillWhere(workspaceId, context.user.id)),
    with: {
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
      files: true,
      documents: true,
    },
  });

  if (!existingSkill) {
    throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
  }

  return { existingSkill, workspaceId };
}

const list = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id);

  const skills = await context.db.query.skill.findMany({
    where: buildAccessibleSkillWhere(workspaceId, context.user.id),
    with: {
      files: true,
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: (table, { desc, asc }) => [desc(table.createdAt), asc(table.name)],
  });

  return skills.map((row) => formatSkillSummary(row, context.user.id));
});

const get = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { existingSkill, workspaceId } = await requireReadableSkillInActiveWorkspace(
      context,
      input.id,
    );
    const isOwnedByCurrentUser = existingSkill.userId === context.user.id;

    console.info("[Skill Debug] Loaded skill", {
      skillId: existingSkill.id,
      requestUserId: context.user.id,
      skillUserId: existingSkill.userId,
      resolvedWorkspaceId: workspaceId,
      skillWorkspaceId: existingSkill.workspaceId,
      canEdit: isOwnedByCurrentUser,
      authSource: context.authSource,
    });

    const files = await hydrateSkillTextFiles({
      workspaceId,
      currentUserId: context.user.id,
      skill: existingSkill,
      files: existingSkill.files,
    });

    return {
      id: existingSkill.id,
      name: existingSkill.name,
      displayName: existingSkill.displayName,
      description: existingSkill.description,
      icon: existingSkill.icon,
      enabled: existingSkill.enabled,
      visibility: existingSkill.visibility,
      owner: {
        id: existingSkill.user.id,
        name: existingSkill.user.name,
        email: existingSkill.user.email,
      },
      isOwnedByCurrentUser,
      canEdit: isOwnedByCurrentUser,
      toolIntegrations: extractSkillToolIntegrations(
        files.find((file) => file.path === "SKILL.md")?.content ?? "",
      ),
      files: files.map((file) => ({
        id: file.id,
        path: file.path,
        content: file.content,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      })),
      documents: existingSkill.documents.map((document) => ({
        id: document.id,
        filename: document.filename,
        path: document.path,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        description: document.description,
        createdAt: document.createdAt,
      })),
      createdAt: existingSkill.createdAt,
      updatedAt: existingSkill.updatedAt,
    };
  });

const create = protectedProcedure
  .input(
    z.object({
      displayName: z.string().min(1).max(128),
      description: z.string().min(1).max(1024),
      icon: z.string().max(64).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);
    const slug = toSkillSlug(input.displayName);

    if (!slug) {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid skill name" });
    }

    const resolvedSlug = await resolveUniqueSkillNameInWorkspace(
      context.db as never,
      workspaceId,
      slug,
    ).catch((error) => {
      throw new ORPCError("BAD_REQUEST", {
        message: error instanceof Error ? error.message : "Invalid skill name",
      });
    });

    if (resolvedSlug !== slug) {
      throw new ORPCError("BAD_REQUEST", {
        message: "A skill with that name already exists in this workspace",
      });
    }

    const skillMd = generateSkillMd(input.displayName, slug, input.description);
    await writeRuntimeVolumeFile({
      storagePrefix: buildOwnedSkillRuntimeVolumePrefix({
        workspaceId,
        userId: context.user.id,
        skillName: slug,
      }),
      relativePath: "SKILL.md",
      body: Buffer.from(skillMd, "utf8"),
      contentType: "text/markdown; charset=utf-8",
    });
    const [newSkill] = await context.db
      .insert(skill)
      .values({
        userId: context.user.id,
        workspaceId,
        name: slug,
        displayName: input.displayName,
        description: input.description,
        icon: input.icon,
        visibility: "private",
      })
      .returning();

    await context.db.insert(skillFile).values({
      skillId: newSkill.id,
      path: "SKILL.md",
      content: null,
    });

    return {
      id: newSkill.id,
      name: newSkill.name,
      displayName: newSkill.displayName,
      description: newSkill.description,
      icon: newSkill.icon,
      visibility: newSkill.visibility,
    };
  });

const importInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("zip"),
    filename: z.string().min(1).max(256),
    contentBase64: z.string().min(1),
  }),
  z.object({
    mode: z.literal("folder"),
    files: z
      .array(
        z.object({
          path: z.string().min(1).max(256),
          mimeType: z.string().min(1).max(256).optional(),
          contentBase64: z.string().min(1),
        }),
      )
      .min(1)
      .max(100),
  }),
]);

const importSkillDefinition = protectedProcedure
  .input(importInputSchema)
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);

    const created = await importSkill(context.db as never, context.user.id, workspaceId, input);

    console.info("[Skill Debug] Imported skill", {
      skillId: created.id,
      skillName: created.name,
      requestUserId: context.user.id,
      workspaceId,
      authSource: context.authSource,
      mode: input.mode,
    });

    return created;
  });

const update = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      name: z.string().min(1).max(64).optional(),
      displayName: z.string().min(1).max(128).optional(),
      description: z.string().min(1).max(1024).optional(),
      icon: z.string().max(64).nullish(),
      enabled: z.boolean().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const { existingSkill, workspaceId } = await requireOwnedSkillInActiveWorkspace(
      context,
      input.id,
    );
    const updates: Partial<typeof skill.$inferInsert> = {};

    if (input.name !== undefined) {
      const normalizedName = toSkillSlug(input.name);
      if (!normalizedName) {
        throw new ORPCError("BAD_REQUEST", { message: "Invalid skill name" });
      }

      const resolvedName = await resolveUniqueSkillNameInWorkspace(
        context.db as never,
        workspaceId,
        normalizedName,
        { excludeSkillId: input.id },
      ).catch((error) => {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Invalid skill name",
        });
      });

      if (resolvedName !== normalizedName) {
        throw new ORPCError("BAD_REQUEST", {
          message: "A skill with that name already exists in this workspace",
        });
      }

      updates.name = resolvedName;
    }

    if (input.displayName !== undefined) {
      updates.displayName = input.displayName;
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }
    if (input.icon !== undefined) {
      updates.icon = input.icon;
    }
    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }

    const result = await context.db
      .update(skill)
      .set(updates)
      .where(eq(skill.id, input.id))
      .returning({ id: skill.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
    }

    if (updates.name && updates.name !== existingSkill.name) {
      await copyRuntimeVolumePrefix({
        sourceStoragePrefix: buildOwnedSkillRuntimeVolumePrefix({
          workspaceId,
          userId: context.user.id,
          skillName: existingSkill.name,
        }),
        targetStoragePrefix: buildOwnedSkillRuntimeVolumePrefix({
          workspaceId,
          userId: context.user.id,
          skillName: updates.name,
        }),
      });
      await deleteRuntimeVolumePrefix(
        buildOwnedSkillRuntimeVolumePrefix({
          workspaceId,
          userId: context.user.id,
          skillName: existingSkill.name,
        }),
      );
    }

    return { success: true };
  });

const deleteSkill = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { existingSkill, workspaceId } = await requireOwnedSkillInActiveWorkspace(
      context,
      input.id,
    );
    await deleteRuntimeVolumePrefix(
      buildOwnedSkillRuntimeVolumePrefix({
        workspaceId,
        userId: context.user.id,
        skillName: existingSkill.name,
      }),
    );

    const result = await context.db
      .delete(skill)
      .where(eq(skill.id, input.id))
      .returning({ id: skill.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
    }

    return { success: true };
  });

const share = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { existingSkill, workspaceId } = await requireOwnedSkillInActiveWorkspace(
      context,
      input.id,
    );
    await copyRuntimeVolumePrefix({
      sourceStoragePrefix: buildOwnedSkillRuntimeVolumePrefix({
        workspaceId,
        userId: context.user.id,
        skillName: existingSkill.name,
      }),
      targetStoragePrefix: buildSharedSkillRuntimeVolumePrefix({
        workspaceId,
        skillName: existingSkill.name,
      }),
    });
    const [shared] = await context.db
      .update(skill)
      .set({ visibility: "public" })
      .where(eq(skill.id, input.id))
      .returning({ id: skill.id, visibility: skill.visibility });

    return {
      success: true,
      id: shared?.id ?? input.id,
      visibility: shared?.visibility ?? "public",
    };
  });

const unshare = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { existingSkill, workspaceId } = await requireOwnedSkillInActiveWorkspace(
      context,
      input.id,
    );
    await deleteRuntimeVolumePrefix(
      buildSharedSkillRuntimeVolumePrefix({
        workspaceId,
        skillName: existingSkill.name,
      }),
    );
    const [unshared] = await context.db
      .update(skill)
      .set({ visibility: "private" })
      .where(eq(skill.id, input.id))
      .returning({ id: skill.id, visibility: skill.visibility });

    return {
      success: true,
      id: unshared?.id ?? input.id,
      visibility: unshared?.visibility ?? "private",
    };
  });

const saveShared = protectedProcedure
  .input(z.object({ sourceSkillId: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);

    const sourceSkill = await context.db.query.skill.findFirst({
      where: and(
        eq(skill.id, input.sourceSkillId),
        eq(skill.workspaceId, workspaceId),
        eq(skill.visibility, "public"),
      ),
    });

    if (!sourceSkill) {
      throw new ORPCError("NOT_FOUND", { message: "Shared skill not found" });
    }

    const copiedSkill = await copySkillToWorkspaceOwner({
      database: context.db as never,
      sourceSkillId: sourceSkill.id,
      targetUserId: context.user.id,
      targetWorkspaceId: workspaceId,
      enabled: false,
      visibility: "private",
    });

    if (!copiedSkill) {
      throw new ORPCError("NOT_FOUND", { message: "Shared skill not found" });
    }
    await copyRuntimeVolumePrefix({
      sourceStoragePrefix: buildSharedSkillRuntimeVolumePrefix({
        workspaceId,
        skillName: sourceSkill.name,
      }),
      targetStoragePrefix: buildOwnedSkillRuntimeVolumePrefix({
        workspaceId,
        userId: context.user.id,
        skillName: copiedSkill.name,
      }),
    });
    await reconcileRuntimeVolumeProjection({
      workspaceId,
      kind: "owned_skills",
      ownerUserId: context.user.id,
      storagePrefix: buildOwnedSkillRuntimeVolumePrefix({
        workspaceId,
        userId: context.user.id,
        skillName: copiedSkill.name,
      }),
      mountPath: `/app/.opencode/skills/${copiedSkill.name}`,
      readOnly: false,
      generationId: null,
    });

    return {
      id: copiedSkill.id,
      name: copiedSkill.name,
      displayName: copiedSkill.displayName,
      description: copiedSkill.description,
      icon: copiedSkill.icon,
      enabled: copiedSkill.enabled,
      visibility: copiedSkill.visibility,
    };
  });

const addFile = protectedProcedure
  .input(
    z.object({
      skillId: z.string(),
      path: z.string().min(1).max(256),
      contentBase64: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    const { existingSkill, workspaceId } = await requireOwnedSkillInActiveWorkspace(
      context,
      input.skillId,
    );

    const content = decodeRpcContent(input.contentBase64);
    await writeRuntimeVolumeFile({
      storagePrefix: buildOwnedSkillRuntimeVolumePrefix({
        workspaceId,
        userId: context.user.id,
        skillName: existingSkill.name,
      }),
      relativePath: input.path,
      body: Buffer.from(content, "utf8"),
      contentType: "text/plain; charset=utf-8",
    });

    const [newFile] = await context.db
      .insert(skillFile)
      .values({
        skillId: input.skillId,
        path: input.path,
        content: null,
      })
      .returning();

    return {
      id: newFile.id,
      path: newFile.path,
    };
  });

const updateFile = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      contentBase64: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);

    const existingFile = await context.db.query.skillFile.findFirst({
      where: eq(skillFile.id, input.id),
      with: {
        skill: true,
      },
    });

    if (!existingFile) {
      console.warn("[Skill Debug] updateFile missing file", {
        fileId: input.id,
        requestUserId: context.user.id,
        resolvedWorkspaceId: workspaceId,
        authSource: context.authSource,
      });
      throw new ORPCError("NOT_FOUND", { message: "File not found" });
    }

    if (
      existingFile.skill.userId !== context.user.id ||
      existingFile.skill.workspaceId !== workspaceId
    ) {
      console.warn("[Skill Debug] updateFile denied", {
        fileId: input.id,
        skillId: existingFile.skill.id,
        requestUserId: context.user.id,
        skillUserId: existingFile.skill.userId,
        resolvedWorkspaceId: workspaceId,
        skillWorkspaceId: existingFile.skill.workspaceId,
        ownerMismatch: existingFile.skill.userId !== context.user.id,
        workspaceMismatch: existingFile.skill.workspaceId !== workspaceId,
        authSource: context.authSource,
      });
      throw new ORPCError("NOT_FOUND", { message: "File not found" });
    }

    const content = decodeRpcContent(input.contentBase64);

    await writeRuntimeVolumeFile({
      storagePrefix: buildOwnedSkillRuntimeVolumePrefix({
        workspaceId,
        userId: context.user.id,
        skillName: existingFile.skill.name,
      }),
      relativePath: existingFile.path,
      body: Buffer.from(content, "utf8"),
      contentType: "text/plain; charset=utf-8",
    });
    await context.db
      .update(skillFile)
      .set({ updatedAt: new Date() })
      .where(eq(skillFile.id, input.id));

    return { success: true };
  });

const deleteFile = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);

    const existingFile = await context.db.query.skillFile.findFirst({
      where: eq(skillFile.id, input.id),
      with: {
        skill: true,
      },
    });

    if (
      !existingFile ||
      existingFile.skill.userId !== context.user.id ||
      existingFile.skill.workspaceId !== workspaceId
    ) {
      throw new ORPCError("NOT_FOUND", { message: "File not found" });
    }

    if (existingFile.path === "SKILL.md") {
      throw new ORPCError("BAD_REQUEST", { message: "Cannot delete SKILL.md" });
    }

    await deleteRuntimeVolumeFile({
      storagePrefix: buildOwnedSkillRuntimeVolumePrefix({
        workspaceId,
        userId: context.user.id,
        skillName: existingFile.skill.name,
      }),
      relativePath: existingFile.path,
    });
    await context.db.delete(skillFile).where(eq(skillFile.id, input.id));

    return { success: true };
  });

const uploadDocument = protectedProcedure
  .input(
    z.object({
      skillId: z.string(),
      filename: z.string().min(1).max(256),
      mimeType: z.string(),
      fileAssetId: z.string().min(1),
      description: z.string().max(1024).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const { workspaceId } = await requireOwnedSkillInActiveWorkspace(context, input.skillId);

    const [{ value: docCount }] = await context.db
      .select({ value: count() })
      .from(skillDocument)
      .where(eq(skillDocument.skillId, input.skillId));

    const [asset] = await assertReadyFileAssetsForWorkspace({
      database: context.db as typeof import("@bap/db/client").db,
      workspaceId,
      fileAssetIds: [input.fileAssetId],
    });

    validateFileUpload(asset.filename, asset.mimeType, asset.sizeBytes, docCount);

    const skillRow = await context.db.query.skill.findFirst({
      where: eq(skill.id, input.skillId),
      columns: { name: true },
    });
    let runtimeVolumeStorageKey: string | null = null;
    if (skillRow) {
      const storagePrefix = buildOwnedSkillRuntimeVolumePrefix({
        workspaceId,
        userId: context.user.id,
        skillName: skillRow.name,
      });
      await writeRuntimeVolumeFile({
        storagePrefix,
        relativePath: asset.filename,
        body: await downloadFromS3(asset.storageKey),
        contentType: asset.mimeType,
      });
      runtimeVolumeStorageKey = buildRuntimeVolumeObjectKey(storagePrefix, asset.filename);
    }
    const [newDocument] = await context.db
      .insert(skillDocument)
      .values({
        skillId: input.skillId,
        fileAssetId: null,
        filename: asset.filename,
        path: asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        storageKey: runtimeVolumeStorageKey ?? asset.storageKey,
        description: input.description,
      })
      .returning();

    return {
      id: newDocument.id,
      filename: newDocument.filename,
      mimeType: newDocument.mimeType,
      sizeBytes: newDocument.sizeBytes,
    };
  });

const getDocumentUrl = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);

    const document = await context.db.query.skillDocument.findFirst({
      where: eq(skillDocument.id, input.id),
      with: {
        skill: true,
      },
    });

    if (
      !document ||
      document.skill.workspaceId !== workspaceId ||
      (document.skill.userId !== context.user.id && document.skill.visibility !== "public")
    ) {
      throw new ORPCError("NOT_FOUND", { message: "Document not found" });
    }

    const url = document.fileAssetId
      ? (
          await getFileAssetDownloadUrl({
            database: context.db as typeof import("@bap/db/client").db,
            workspaceId,
            fileAssetId: document.fileAssetId,
          })
        ).url
      : await getPresignedDownloadUrl(document.storageKey, 300, {
          filename: document.filename,
          contentType: document.mimeType,
        });

    return { url, filename: document.filename };
  });

const deleteDocument = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id);

    const document = await context.db.query.skillDocument.findFirst({
      where: eq(skillDocument.id, input.id),
      with: { skill: true },
    });

    if (
      !document ||
      document.skill.userId !== context.user.id ||
      document.skill.workspaceId !== workspaceId
    ) {
      throw new ORPCError("NOT_FOUND", { message: "Document not found" });
    }

    await deleteRuntimeVolumeFile({
      storagePrefix: buildOwnedSkillRuntimeVolumePrefix({
        workspaceId,
        userId: context.user.id,
        skillName: document.skill.name,
      }),
      relativePath: document.path,
    });
    await context.db.delete(skillDocument).where(eq(skillDocument.id, input.id));

    return { success: true };
  });

export const skillRouter = {
  list,
  get,
  create,
  import: importSkillDefinition,
  update,
  delete: deleteSkill,
  share,
  unshare,
  saveShared,
  addFile,
  updateFile,
  deleteFile,
  uploadDocument,
  getDocumentUrl,
  deleteDocument,
};
