import { coworker, coworkerFolder } from "@bap/db/schema";
import { describe, expect, it, vi } from "vitest";
import {
  deleteCoworkerFolder,
  listVisibleCoworkerFolders,
  moveCoworkerToFolder,
  updateTopLevelCoworkerFolderVisibility,
} from "./coworker-folder-domain";

type FolderRow = typeof coworkerFolder.$inferSelect;
type CoworkerRow = typeof coworker.$inferSelect;

function folder(input: Partial<FolderRow> & Pick<FolderRow, "id" | "name" | "ownerId">): FolderRow {
  const now = new Date("2026-06-18T00:00:00.000Z");
  return {
    id: input.id,
    workspaceId: input.workspaceId ?? "workspace-1",
    ownerId: input.ownerId,
    parentId: input.parentId ?? null,
    name: input.name,
    visibility: input.visibility ?? "private",
    position: input.position ?? 0,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

function coworkerRow(
  input: Partial<CoworkerRow> & Pick<CoworkerRow, "id" | "ownerId">,
): CoworkerRow {
  const now = new Date("2026-06-18T00:00:00.000Z");
  return {
    id: input.id,
    workspaceId: input.workspaceId ?? "workspace-1",
    ownerId: input.ownerId,
    folderId: input.folderId ?? null,
    name: input.name ?? "Coworker",
    description: input.description ?? null,
    username: input.username ?? null,
    status: input.status ?? "on",
    disabledReason: input.disabledReason ?? null,
    disabledAt: input.disabledAt ?? null,
    triggerType: input.triggerType ?? "manual",
    prompt: input.prompt ?? "",
    model: input.model ?? "gpt-5",
    authSource: input.authSource ?? "shared",
    builderConversationId: input.builderConversationId ?? null,
    autoApprove: input.autoApprove ?? true,
    toolAccessMode: input.toolAccessMode ?? "all",
    allowedIntegrations: input.allowedIntegrations ?? [],
    allowedCustomIntegrations: input.allowedCustomIntegrations ?? [],
    allowedWorkspaceMcpServerIds: input.allowedWorkspaceMcpServerIds ?? [],
    allowedSkillSlugs: input.allowedSkillSlugs ?? [],
    schedule: input.schedule ?? null,
    requiresUserInput: input.requiresUserInput ?? false,
    userInputPrompt: input.userInputPrompt ?? null,
    isPinned: input.isPinned ?? false,
    sharedAt: input.sharedAt ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

function createContext(input: { folders: FolderRow[]; coworkers?: CoworkerRow[] }) {
  const updateSetMock = vi.fn<(table: unknown, values: unknown) => void>();
  const deleteWhereMock = vi.fn<() => void>();
  const updateReturningMock = vi.fn<() => Promise<FolderRow[]>>(async () =>
    input.folders.slice(0, 1),
  );
  const db = {
    query: {
      coworkerFolder: {
        findMany: vi.fn<() => Promise<FolderRow[]>>(async () => input.folders),
      },
      coworker: {
        findFirst: vi.fn<() => Promise<CoworkerRow | null>>(
          async () => input.coworkers?.[0] ?? null,
        ),
      },
    },
    update: vi.fn<(table: unknown) => { set: (values: unknown) => unknown }>((table: unknown) => ({
      set: (values: unknown) => {
        updateSetMock(table, values);
        return {
          where: () => ({
            returning: updateReturningMock,
          }),
        };
      },
    })),
    delete: vi.fn<() => { where: () => void }>(() => ({
      where: deleteWhereMock,
    })),
  };
  return {
    context: { db: db as never },
    db,
    updateSetMock,
    deleteWhereMock,
  };
}

describe("coworker folder domain", () => {
  it("lists private folders only for the owner and workspace folders for teammates", async () => {
    const rootPrivate = folder({ id: "folder-private", name: "Private", ownerId: "user-1" });
    const rootShared = folder({
      id: "folder-shared",
      name: "Shared",
      ownerId: "user-1",
      visibility: "workspace",
    });
    const nestedShared = folder({
      id: "folder-nested",
      name: "Nested",
      ownerId: "user-1",
      parentId: rootShared.id,
      visibility: "workspace",
    });
    const { context } = createContext({ folders: [rootPrivate, rootShared, nestedShared] });

    await expect(
      listVisibleCoworkerFolders({ context, workspaceId: "workspace-1", userId: "user-2" }),
    ).resolves.toEqual([
      expect.objectContaining({ id: rootShared.id, effectiveVisibility: "workspace" }),
      expect.objectContaining({ id: nestedShared.id, effectiveVisibility: "workspace" }),
    ]);
  });

  it("prevents teammates from mutating workspace-visible folders they do not own", async () => {
    const sharedFolder = folder({
      id: "folder-shared",
      name: "Shared",
      ownerId: "user-1",
      visibility: "workspace",
    });
    const { context, db } = createContext({ folders: [sharedFolder] });

    await expect(
      deleteCoworkerFolder({
        context,
        workspaceId: "workspace-1",
        userId: "user-2",
        folderId: sharedFolder.id,
      }),
    ).rejects.toThrow("Folder not found.");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("updates contained coworker sharing when a top-level folder changes visibility", async () => {
    const root = folder({ id: "folder-root", name: "Root", ownerId: "user-1" });
    const child = folder({
      id: "folder-child",
      name: "Child",
      ownerId: "user-1",
      parentId: root.id,
    });
    const { context, updateSetMock } = createContext({ folders: [root, child] });

    await updateTopLevelCoworkerFolderVisibility({
      context,
      workspaceId: "workspace-1",
      userId: "user-1",
      folderId: root.id,
      visibility: "workspace",
    });

    expect(updateSetMock).toHaveBeenCalledWith(coworkerFolder, { visibility: "workspace" });
    expect(updateSetMock).toHaveBeenCalledWith(
      coworker,
      expect.objectContaining({ sharedAt: expect.any(Date) }),
    );
  });

  it("moves coworkers into folders using the destination folder visibility", async () => {
    const destination = folder({
      id: "folder-shared",
      name: "Shared",
      ownerId: "user-1",
      visibility: "workspace",
    });
    const ownedCoworker = coworkerRow({ id: "coworker-1", ownerId: "user-1" });
    const { context, updateSetMock } = createContext({
      folders: [destination],
      coworkers: [ownedCoworker],
    });

    await moveCoworkerToFolder({
      context,
      workspaceId: "workspace-1",
      userId: "user-1",
      coworkerId: ownedCoworker.id,
      folderId: destination.id,
    });

    expect(updateSetMock).toHaveBeenCalledWith(
      coworker,
      expect.objectContaining({ folderId: destination.id, sharedAt: expect.any(Date) }),
    );
  });

  it("reparents folder contents when deleting a folder", async () => {
    const parent = folder({ id: "folder-parent", name: "Parent", ownerId: "user-1" });
    const deleted = folder({
      id: "folder-deleted",
      name: "Deleted",
      ownerId: "user-1",
      parentId: parent.id,
    });
    const { context, deleteWhereMock, updateSetMock } = createContext({
      folders: [parent, deleted],
    });

    await deleteCoworkerFolder({
      context,
      workspaceId: "workspace-1",
      userId: "user-1",
      folderId: deleted.id,
    });

    expect(updateSetMock).toHaveBeenCalledWith(coworker, { folderId: parent.id });
    expect(updateSetMock).toHaveBeenCalledWith(coworkerFolder, { parentId: parent.id });
    expect(deleteWhereMock).toHaveBeenCalled();
  });
});
