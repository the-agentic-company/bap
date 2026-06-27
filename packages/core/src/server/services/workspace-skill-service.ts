import { db as defaultDb } from "@bap/db/client";
import { skill } from "@bap/db/schema";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { requireActiveWorkspaceForUser } from "../billing/service";

type DatabaseLike = typeof defaultDb;

export function buildAccessibleSkillWhere(workspaceId: string, userId: string) {
  return and(
    eq(skill.workspaceId, workspaceId),
    or(eq(skill.userId, userId), eq(skill.visibility, "public")),
  );
}

export function buildOwnedSkillWhere(workspaceId: string, userId: string) {
  return and(eq(skill.workspaceId, workspaceId), eq(skill.userId, userId));
}

function toWorkspaceSkillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export async function resolveUniqueSkillNameInWorkspace(
  database: DatabaseLike,
  workspaceId: string,
  baseName: string,
  options?: { excludeSkillId?: string },
): Promise<string> {
  const normalizedBaseName = toWorkspaceSkillSlug(baseName);
  if (!normalizedBaseName) {
    throw new Error("Invalid skill name");
  }

  const filters = [eq(skill.workspaceId, workspaceId)];
  if (options?.excludeSkillId) {
    filters.push(ne(skill.id, options.excludeSkillId));
  }

  const existing = await database.query.skill.findMany({
    where: and(...filters),
    columns: { name: true },
  });

  const usedNames = new Set(existing.map((record) => record.name));
  if (!usedNames.has(normalizedBaseName)) {
    return normalizedBaseName;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = toWorkspaceSkillSlug(`${normalizedBaseName}-${index}`);
    if (candidate && !usedNames.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not allocate a unique skill name for '${normalizedBaseName}'.`);
}

export async function listAccessibleEnabledSkillsForUser(
  userId: string,
  allowedSkillNames?: string[],
) {
  const workspace = await requireActiveWorkspaceForUser(userId);
  const filters = [
    buildAccessibleSkillWhere(workspace.id, userId),
    eq(skill.enabled, true),
  ];

  if (allowedSkillNames && allowedSkillNames.length > 0) {
    filters.push(inArray(skill.name, allowedSkillNames));
  }

  return await defaultDb.query.skill.findMany({
    where: and(...filters),
    with: {
      files: true,
      documents: {
        with: {
          fileAsset: true,
        },
      },
    },
    orderBy: (table, { asc }) => [asc(table.name)],
  });
}

export async function listAccessibleEnabledSkillMetadataForUser(userId: string) {
  const workspace = await requireActiveWorkspaceForUser(userId);
  return await defaultDb.query.skill.findMany({
    where: and(buildAccessibleSkillWhere(workspace.id, userId), eq(skill.enabled, true)),
    columns: {
      name: true,
      displayName: true,
      description: true,
      updatedAt: true,
      visibility: true,
      userId: true,
    },
    orderBy: (table, { asc }) => [asc(table.name)],
  });
}

export async function copySkillToWorkspaceOwner(params: {
  database: DatabaseLike;
  sourceSkillId: string;
  targetUserId: string;
  targetWorkspaceId: string;
  enabled?: boolean;
  visibility?: "private" | "public";
}) {
  const source = await params.database.query.skill.findFirst({
    where: eq(skill.id, params.sourceSkillId),
  });

  if (!source) {
    return null;
  }

  const copiedName = await resolveUniqueSkillNameInWorkspace(
    params.database,
    params.targetWorkspaceId,
    source.name,
  );

  return await params.database.transaction(async (tx) => {
    const [createdSkill] = await tx
      .insert(skill)
      .values({
        userId: params.targetUserId,
        workspaceId: params.targetWorkspaceId,
        name: copiedName,
        displayName: source.displayName,
        description: source.description,
        icon: source.icon,
        visibility: params.visibility ?? "private",
        enabled: params.enabled ?? false,
      })
      .returning();

    return createdSkill;
  });
}
