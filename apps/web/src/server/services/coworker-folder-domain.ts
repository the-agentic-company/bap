import { coworker, coworkerFolder } from "@bap/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

export type CoworkerFolderVisibility = "private" | "workspace";

type Database = typeof import("@bap/db/client").db;

type CoworkerFolderRow = typeof coworkerFolder.$inferSelect;

export type CoworkerFolderContext = {
  db: Database;
};

export function normalizeFolderName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function assertValidFolderName(value: string) {
  const name = normalizeFolderName(value);
  if (!name) {
    throw new Error("Folder name is required.");
  }
  if (name.length > 100) {
    throw new Error("Folder name must be 100 characters or fewer.");
  }
  return name;
}

function byId(folders: CoworkerFolderRow[]) {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

function getRootFolder(folder: CoworkerFolderRow, foldersById: Map<string, CoworkerFolderRow>) {
  let current = folder;
  const seen = new Set<string>();

  while (current.parentId) {
    if (seen.has(current.id)) {
      throw new Error("Folder tree contains a cycle.");
    }
    seen.add(current.id);

    const parent = foldersById.get(current.parentId);
    if (!parent) {
      break;
    }
    current = parent;
  }

  return current;
}

function getEffectiveVisibility(
  folder: CoworkerFolderRow,
  foldersById: Map<string, CoworkerFolderRow>,
) {
  return getRootFolder(folder, foldersById).visibility;
}

function canSeeFolder(params: {
  folder: CoworkerFolderRow;
  foldersById: Map<string, CoworkerFolderRow>;
  userId: string;
}) {
  const root = getRootFolder(params.folder, params.foldersById);
  return root.visibility === "workspace" || root.ownerId === params.userId;
}

function assertCanManageFolder(params: {
  folder: CoworkerFolderRow;
  foldersById: Map<string, CoworkerFolderRow>;
  userId: string;
}) {
  const root = getRootFolder(params.folder, params.foldersById);
  if (root.ownerId !== params.userId) {
    throw new Error("Folder not found.");
  }
}

function isDescendant(
  candidateFolderId: string,
  ancestorFolderId: string,
  foldersById: Map<string, CoworkerFolderRow>,
) {
  let current = foldersById.get(candidateFolderId);
  const seen = new Set<string>();

  while (current?.parentId) {
    if (seen.has(current.id)) {
      throw new Error("Folder tree contains a cycle.");
    }
    seen.add(current.id);

    if (current.parentId === ancestorFolderId) {
      return true;
    }
    current = foldersById.get(current.parentId);
  }

  return false;
}

async function listWorkspaceFolders(context: CoworkerFolderContext, workspaceId: string) {
  return context.db.query.coworkerFolder.findMany({
    where: eq(coworkerFolder.workspaceId, workspaceId),
    orderBy: (folder, { asc }) => [asc(folder.parentId), asc(folder.position), asc(folder.name)],
  });
}

async function requireVisibleFolder(input: {
  context: CoworkerFolderContext;
  workspaceId: string;
  userId: string;
  folderId: string;
}) {
  const folders = await listWorkspaceFolders(input.context, input.workspaceId);
  const foldersById = byId(folders);
  const folder = foldersById.get(input.folderId);

  if (!folder || !canSeeFolder({ folder, foldersById, userId: input.userId })) {
    throw new Error("Folder not found.");
  }

  return { folder, folders, foldersById };
}

async function assertUniqueSiblingName(input: {
  context: CoworkerFolderContext;
  workspaceId: string;
  ownerId: string;
  parentId: string | null;
  visibility: CoworkerFolderVisibility;
  name: string;
  excludeFolderId?: string;
}) {
  const existing = await input.context.db.query.coworkerFolder.findMany({
    where: and(
      eq(coworkerFolder.workspaceId, input.workspaceId),
      eq(coworkerFolder.name, input.name),
      input.parentId
        ? eq(coworkerFolder.parentId, input.parentId)
        : isNull(coworkerFolder.parentId),
    ),
  });

  const conflicting = existing.find((folder) => {
    if (folder.id === input.excludeFolderId) {
      return false;
    }
    if (input.parentId) {
      return true;
    }
    if (input.visibility === "workspace") {
      return folder.visibility === "workspace";
    }
    return folder.visibility === "private" && folder.ownerId === input.ownerId;
  });

  if (conflicting) {
    throw new Error("A folder with that name already exists here.");
  }
}

function collectDescendantFolderIds(folderId: string, folders: CoworkerFolderRow[]) {
  const descendants = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (!folder.parentId) {
        continue;
      }
      if (folder.parentId === folderId || descendants.has(folder.parentId)) {
        if (!descendants.has(folder.id)) {
          descendants.add(folder.id);
          changed = true;
        }
      }
    }
  }

  return [...descendants];
}

async function syncContainedCoworkerSharing(input: {
  context: CoworkerFolderContext;
  folderIds: string[];
  visibility: CoworkerFolderVisibility;
}) {
  if (input.folderIds.length === 0) {
    return;
  }

  await input.context.db
    .update(coworker)
    .set({ sharedAt: input.visibility === "workspace" ? new Date() : null })
    .where(inArray(coworker.folderId, input.folderIds));
}

export async function listVisibleCoworkerFolders(input: {
  context: CoworkerFolderContext;
  workspaceId: string;
  userId: string;
}) {
  const folders = await listWorkspaceFolders(input.context, input.workspaceId);
  const foldersById = byId(folders);
  return folders
    .filter((folder) => canSeeFolder({ folder, foldersById, userId: input.userId }))
    .map((folder) =>
      Object.assign({}, folder, {
        effectiveVisibility: getEffectiveVisibility(folder, foldersById),
      }),
    );
}

export async function createCoworkerFolder(input: {
  context: CoworkerFolderContext;
  workspaceId: string;
  userId: string;
  name: string;
  parentId?: string | null;
  visibility?: CoworkerFolderVisibility;
}) {
  const name = assertValidFolderName(input.name);
  let parent: CoworkerFolderRow | null = null;
  let visibility: CoworkerFolderVisibility = input.visibility ?? "private";

  if (input.parentId) {
    const result = await requireVisibleFolder({
      context: input.context,
      workspaceId: input.workspaceId,
      userId: input.userId,
      folderId: input.parentId,
    });
    assertCanManageFolder({
      folder: result.folder,
      foldersById: result.foldersById,
      userId: input.userId,
    });
    parent = result.folder;
    visibility = getEffectiveVisibility(parent, result.foldersById);
  }

  await assertUniqueSiblingName({
    context: input.context,
    workspaceId: input.workspaceId,
    ownerId: input.userId,
    parentId: input.parentId ?? null,
    visibility,
    name,
  });

  const [created] = await input.context.db
    .insert(coworkerFolder)
    .values({
      workspaceId: input.workspaceId,
      ownerId: input.userId,
      parentId: input.parentId ?? null,
      name,
      visibility,
    })
    .returning();

  return created;
}

export async function moveCoworkerToFolder(input: {
  context: CoworkerFolderContext;
  workspaceId: string;
  userId: string;
  coworkerId: string;
  folderId: string | null;
}) {
  const existingCoworker = await input.context.db.query.coworker.findFirst({
    where: and(
      eq(coworker.id, input.coworkerId),
      eq(coworker.ownerId, input.userId),
      eq(coworker.workspaceId, input.workspaceId),
    ),
  });

  if (!existingCoworker) {
    throw new Error("Coworker not found.");
  }

  let sharedAt = existingCoworker.sharedAt;
  if (input.folderId) {
    const result = await requireVisibleFolder({
      context: input.context,
      workspaceId: input.workspaceId,
      userId: input.userId,
      folderId: input.folderId,
    });
    const visibility = getEffectiveVisibility(result.folder, result.foldersById);
    sharedAt = visibility === "workspace" ? new Date() : null;
  }

  const [updated] = await input.context.db
    .update(coworker)
    .set({ folderId: input.folderId, sharedAt })
    .where(
      and(
        eq(coworker.id, input.coworkerId),
        eq(coworker.ownerId, input.userId),
        eq(coworker.workspaceId, input.workspaceId),
      ),
    )
    .returning();

  return updated;
}

export async function moveCoworkerFolder(input: {
  context: CoworkerFolderContext;
  workspaceId: string;
  userId: string;
  folderId: string;
  parentId: string | null;
}) {
  const result = await requireVisibleFolder({
    context: input.context,
    workspaceId: input.workspaceId,
    userId: input.userId,
    folderId: input.folderId,
  });
  assertCanManageFolder({
    folder: result.folder,
    foldersById: result.foldersById,
    userId: input.userId,
  });

  if (input.parentId === input.folderId) {
    throw new Error("A folder cannot be moved into itself.");
  }
  if (input.parentId && isDescendant(input.parentId, input.folderId, result.foldersById)) {
    throw new Error("A folder cannot be moved into one of its child folders.");
  }

  let visibility = result.folder.visibility;
  if (input.parentId) {
    const parent = result.foldersById.get(input.parentId);
    if (
      !parent ||
      !canSeeFolder({ folder: parent, foldersById: result.foldersById, userId: input.userId })
    ) {
      throw new Error("Folder not found.");
    }
    assertCanManageFolder({
      folder: parent,
      foldersById: result.foldersById,
      userId: input.userId,
    });
    visibility = getEffectiveVisibility(parent, result.foldersById);
  }

  await assertUniqueSiblingName({
    context: input.context,
    workspaceId: input.workspaceId,
    ownerId: input.userId,
    parentId: input.parentId,
    visibility,
    name: result.folder.name,
    excludeFolderId: input.folderId,
  });

  const descendantIds = collectDescendantFolderIds(input.folderId, result.folders);
  const affectedFolderIds = [input.folderId, ...descendantIds];

  const [updated] = await input.context.db
    .update(coworkerFolder)
    .set({ parentId: input.parentId, visibility })
    .where(eq(coworkerFolder.id, input.folderId))
    .returning();

  if (descendantIds.length > 0) {
    await input.context.db
      .update(coworkerFolder)
      .set({ visibility })
      .where(inArray(coworkerFolder.id, descendantIds));
  }

  await syncContainedCoworkerSharing({
    context: input.context,
    folderIds: affectedFolderIds,
    visibility,
  });

  return updated;
}

export async function updateTopLevelCoworkerFolderVisibility(input: {
  context: CoworkerFolderContext;
  workspaceId: string;
  userId: string;
  folderId: string;
  visibility: CoworkerFolderVisibility;
}) {
  const result = await requireVisibleFolder({
    context: input.context,
    workspaceId: input.workspaceId,
    userId: input.userId,
    folderId: input.folderId,
  });
  const root = getRootFolder(result.folder, result.foldersById);
  if (root.id !== result.folder.id) {
    throw new Error("Only top-level folder visibility can be changed.");
  }
  if (root.ownerId !== input.userId) {
    throw new Error("Folder not found.");
  }

  await assertUniqueSiblingName({
    context: input.context,
    workspaceId: input.workspaceId,
    ownerId: input.userId,
    parentId: null,
    visibility: input.visibility,
    name: root.name,
    excludeFolderId: root.id,
  });

  const descendantIds = collectDescendantFolderIds(root.id, result.folders);
  const affectedFolderIds = [root.id, ...descendantIds];

  const [updated] = await input.context.db
    .update(coworkerFolder)
    .set({ visibility: input.visibility })
    .where(eq(coworkerFolder.id, root.id))
    .returning();

  if (descendantIds.length > 0) {
    await input.context.db
      .update(coworkerFolder)
      .set({ visibility: input.visibility })
      .where(inArray(coworkerFolder.id, descendantIds));
  }

  await syncContainedCoworkerSharing({
    context: input.context,
    folderIds: affectedFolderIds,
    visibility: input.visibility,
  });

  return updated;
}

export async function deleteCoworkerFolder(input: {
  context: CoworkerFolderContext;
  workspaceId: string;
  userId: string;
  folderId: string;
}) {
  const result = await requireVisibleFolder({
    context: input.context,
    workspaceId: input.workspaceId,
    userId: input.userId,
    folderId: input.folderId,
  });
  assertCanManageFolder({
    folder: result.folder,
    foldersById: result.foldersById,
    userId: input.userId,
  });

  await input.context.db
    .update(coworker)
    .set({ folderId: result.folder.parentId })
    .where(eq(coworker.folderId, result.folder.id));

  await input.context.db
    .update(coworkerFolder)
    .set({ parentId: result.folder.parentId })
    .where(eq(coworkerFolder.parentId, result.folder.id));

  await input.context.db
    .delete(coworkerFolder)
    .where(
      and(
        eq(coworkerFolder.id, result.folder.id),
        eq(coworkerFolder.workspaceId, input.workspaceId),
      ),
    );

  return { success: true as const };
}
