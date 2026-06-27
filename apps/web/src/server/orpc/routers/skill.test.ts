import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

function createProcedureStub() {
  const stub = {
    input: vi.fn<VitestProcedure>(),
    output: vi.fn<VitestProcedure>(),
    handler: vi.fn<VitestProcedure>((fn: unknown) => fn),
  };
  stub.input.mockReturnValue(stub);
  stub.output.mockReturnValue(stub);
  return stub;
}

const {
  uploadToS3Mock,
  deleteFromS3Mock,
  getPresignedDownloadUrlMock,
  generateStorageKeyMock,
  ensureBucketMock,
  validateFileUploadMock,
  importSkillMock,
  requireActiveWorkspaceAccessMock,
  resolveUniqueSkillNameInWorkspaceMock,
  copySkillToWorkspaceOwnerMock,
  writeRuntimeVolumeFileMock,
  deleteRuntimeVolumeFileMock,
  deleteRuntimeVolumePrefixMock,
  copyRuntimeVolumePrefixMock,
  readRuntimeVolumeFileMock,
  reconcileRuntimeVolumeProjectionMock,
} = vi.hoisted(() => ({
  uploadToS3Mock: vi.fn<VitestProcedure>(),
  deleteFromS3Mock: vi.fn<VitestProcedure>(),
  getPresignedDownloadUrlMock: vi.fn<VitestProcedure>(),
  generateStorageKeyMock: vi.fn<VitestProcedure>(),
  ensureBucketMock: vi.fn<VitestProcedure>(),
  validateFileUploadMock: vi.fn<VitestProcedure>(),
  importSkillMock: vi.fn<VitestProcedure>(),
  requireActiveWorkspaceAccessMock: vi.fn<VitestProcedure>(),
  resolveUniqueSkillNameInWorkspaceMock: vi.fn<VitestProcedure>(),
  copySkillToWorkspaceOwnerMock: vi.fn<VitestProcedure>(),
  writeRuntimeVolumeFileMock: vi.fn<VitestProcedure>(),
  deleteRuntimeVolumeFileMock: vi.fn<VitestProcedure>(),
  deleteRuntimeVolumePrefixMock: vi.fn<VitestProcedure>(),
  copyRuntimeVolumePrefixMock: vi.fn<VitestProcedure>(),
  readRuntimeVolumeFileMock: vi.fn<VitestProcedure>(),
  reconcileRuntimeVolumeProjectionMock: vi.fn<VitestProcedure>(),
}));

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("../workspace-access", () => ({
  requireActiveWorkspaceAccess: requireActiveWorkspaceAccessMock,
}));

vi.mock("@bap/core/server/storage/s3-client", () => ({
  uploadToS3: uploadToS3Mock,
  deleteFromS3: deleteFromS3Mock,
  getPresignedDownloadUrl: getPresignedDownloadUrlMock,
  generateStorageKey: generateStorageKeyMock,
  ensureBucket: ensureBucketMock,
}));

vi.mock("@bap/core/server/services/runtime-volume-service", () => ({
  appendRuntimeVolumeSkillSlug: (prefix: string, skillSlug: string) =>
    `${prefix.replace(/\/?$/, "/")}${skillSlug}/`,
  buildOwnedSkillsRuntimeVolumePrefix: ({
    workspaceId,
    userId,
  }: {
    workspaceId: string;
    userId: string;
  }) => `runtime-volumes/${workspaceId}/users/${userId}/skills/`,
  buildSharedSkillsRuntimeVolumePrefix: ({ workspaceId }: { workspaceId: string }) =>
    `runtime-volumes/${workspaceId}/shared-skills/`,
  buildRuntimeVolumeObjectKey: (prefix: string, relativePath: string) => `${prefix}${relativePath}`,
  copyRuntimeVolumePrefix: copyRuntimeVolumePrefixMock,
  deleteRuntimeVolumeFile: deleteRuntimeVolumeFileMock,
  deleteRuntimeVolumePrefix: deleteRuntimeVolumePrefixMock,
  readRuntimeVolumeFile: readRuntimeVolumeFileMock,
  reconcileRuntimeVolumeProjection: reconcileRuntimeVolumeProjectionMock,
  writeRuntimeVolumeFile: writeRuntimeVolumeFileMock,
}));

vi.mock("@bap/core/server/services/workspace-skill-service", () => ({
  buildAccessibleSkillWhere: vi.fn<VitestProcedure>(() => "accessible-where"),
  buildOwnedSkillWhere: vi.fn<VitestProcedure>(() => "owned-where"),
  copySkillToWorkspaceOwner: copySkillToWorkspaceOwnerMock,
  resolveUniqueSkillNameInWorkspace: resolveUniqueSkillNameInWorkspaceMock,
}));

vi.mock("@/server/storage/validation", () => ({
  validateFileUpload: validateFileUploadMock,
}));

vi.mock("@/server/services/skill-import", () => ({
  importSkill: importSkillMock,
}));

import { skillRouter } from "./skill";

const skillRouterAny = skillRouter as unknown as Record<
  string,
  (args: unknown) => Promise<unknown>
>;

function createContext() {
  const insertReturningMock = vi.fn<VitestProcedure>();
  const insertValuesMock = vi.fn<VitestProcedure>(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn<VitestProcedure>(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn<VitestProcedure>();
  const updateWhereMock = vi.fn<VitestProcedure>(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn<VitestProcedure>(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn<VitestProcedure>(() => ({ set: updateSetMock }));

  const deleteReturningMock = vi.fn<VitestProcedure>();
  const deleteWhereMock = vi.fn<VitestProcedure>(() => ({ returning: deleteReturningMock }));
  const deleteMock = vi.fn<VitestProcedure>(() => ({ where: deleteWhereMock }));

  const selectWhereMock = vi.fn<VitestProcedure>();
  const selectFromMock = vi.fn<VitestProcedure>(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn<VitestProcedure>(() => ({ from: selectFromMock }));

  return {
    user: { id: "user-1" },
    db: {
      query: {
        skill: {
          findMany: vi.fn<VitestProcedure>(),
          findFirst: vi.fn<VitestProcedure>(),
        },
        skillFile: {
          findFirst: vi.fn<VitestProcedure>(),
        },
        skillDocument: {
          findFirst: vi.fn<VitestProcedure>(),
        },
      },
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
      select: selectMock,
      transaction: vi.fn<VitestProcedure>(
        async (callback: (tx: unknown) => Promise<unknown>) => await callback({}),
      ),
    },
    mocks: {
      insertReturningMock,
      insertValuesMock,
      updateSetMock,
      updateWhereMock,
      updateReturningMock,
      deleteReturningMock,
      selectWhereMock,
    },
  };
}

describe("skillRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireActiveWorkspaceAccessMock.mockResolvedValue({
      workspace: { id: "ws-1" },
      membership: { role: "member" },
    });
    resolveUniqueSkillNameInWorkspaceMock.mockImplementation(
      async (_db: unknown, _workspaceId: string, name: string) => name,
    );
    generateStorageKeyMock.mockReturnValue("skills/user-1/skill-1/doc.pdf");
    getPresignedDownloadUrlMock.mockResolvedValue("https://example.com/doc.pdf");
    readRuntimeVolumeFileMock.mockResolvedValue(Buffer.from("content"));
    writeRuntimeVolumeFileMock.mockResolvedValue(undefined);
    deleteRuntimeVolumeFileMock.mockResolvedValue(undefined);
    deleteRuntimeVolumePrefixMock.mockResolvedValue(undefined);
    copyRuntimeVolumePrefixMock.mockResolvedValue(1);
    reconcileRuntimeVolumeProjectionMock.mockResolvedValue({
      changed: true,
      manifestHash: "hash",
      entryCount: 1,
    });
  });

  it("lists accessible skills with owner and visibility info", async () => {
    const context = createContext();
    const now = new Date("2024-01-01T00:00:00.000Z");
    context.db.query.skill.findMany.mockResolvedValue([
      {
        id: "skill-1",
        name: "my-skill",
        displayName: "My Skill",
        description: "desc",
        icon: "rocket",
        enabled: true,
        visibility: "private",
        userId: "user-1",
        createdAt: now,
        updatedAt: now,
        files: [{ id: "f1" }, { id: "f2" }],
        user: { id: "user-1", name: "Me", email: "me@example.com" },
      },
      {
        id: "skill-2",
        name: "shared-skill",
        displayName: "Shared Skill",
        description: "shared",
        icon: null,
        enabled: true,
        visibility: "public",
        userId: "user-2",
        createdAt: now,
        updatedAt: now,
        files: [{ id: "f3" }],
        user: { id: "user-2", name: "Alex", email: "alex@example.com" },
      },
    ]);

    await expect(skillRouterAny.list({ context })).resolves.toEqual([
      expect.objectContaining({
        id: "skill-1",
        visibility: "private",
        fileCount: 2,
        owner: { id: "user-1", name: "Me", email: "me@example.com" },
        isOwnedByCurrentUser: true,
        canEdit: true,
      }),
      expect.objectContaining({
        id: "skill-2",
        visibility: "public",
        fileCount: 1,
        owner: { id: "user-2", name: "Alex", email: "alex@example.com" },
        isOwnedByCurrentUser: false,
        canEdit: false,
      }),
    ]);
  });

  it("gets a shared skill for read-only access", async () => {
    const context = createContext();
    const now = new Date("2024-02-02T00:00:00.000Z");
    context.db.query.skill.findFirst.mockResolvedValue({
      id: "skill-1",
      name: "shared-skill",
      displayName: "Shared Skill",
      description: "desc",
      icon: null,
      enabled: true,
      visibility: "public",
      userId: "user-2",
      files: [
        {
          id: "file-1",
          path: "SKILL.md",
          content: "content",
          createdAt: now,
          updatedAt: now,
        },
      ],
      documents: [
        {
          id: "doc-1",
          filename: "doc.pdf",
          path: "references/doc.pdf",
          mimeType: "application/pdf",
          sizeBytes: 42,
          description: "spec",
          createdAt: now,
        },
      ],
      user: {
        id: "user-2",
        name: "Alex",
        email: "alex@example.com",
      },
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      skillRouterAny.get({
        input: { id: "skill-1" },
        context,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "skill-1",
        visibility: "public",
        owner: { id: "user-2", name: "Alex", email: "alex@example.com" },
        isOwnedByCurrentUser: false,
        canEdit: false,
      }),
    );
  });

  it("creates a private workspace skill and seeds SKILL.md", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "skill-1",
        name: "my-skill",
        displayName: "My Skill",
        description: "A test skill",
        icon: "sparkles",
        visibility: "private",
      },
    ]);

    await expect(
      skillRouterAny.create({
        input: {
          displayName: "My Skill",
          description: "A test skill",
          icon: "sparkles",
        },
        context,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "skill-1",
        name: "my-skill",
        visibility: "private",
      }),
    );

    expect(context.mocks.insertValuesMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: "user-1",
        workspaceId: "ws-1",
        visibility: "private",
      }),
    );
  });

  it("delegates imports with the active workspace id", async () => {
    const context = createContext();
    importSkillMock.mockResolvedValue({ id: "skill-1", name: "imported" });

    await skillRouterAny.import({
      input: {
        mode: "zip",
        filename: "skill.zip",
        contentBase64: "Zm9v",
      },
      context,
    });

    expect(importSkillMock).toHaveBeenCalledWith(context.db, "user-1", "ws-1", {
      mode: "zip",
      filename: "skill.zip",
      contentBase64: "Zm9v",
    });
  });

  it("shares and unshares owned skills", async () => {
    const context = createContext();
    context.db.query.skill.findFirst.mockResolvedValue({
      id: "skill-1",
      name: "my-skill",
      userId: "user-1",
      workspaceId: "ws-1",
    });
    context.mocks.updateReturningMock
      .mockResolvedValueOnce([{ id: "skill-1", visibility: "public" }])
      .mockResolvedValueOnce([{ id: "skill-1", visibility: "private" }]);

    await expect(skillRouterAny.share({ input: { id: "skill-1" }, context })).resolves.toEqual({
      success: true,
      id: "skill-1",
      visibility: "public",
    });

    await expect(skillRouterAny.unshare({ input: { id: "skill-1" }, context })).resolves.toEqual({
      success: true,
      id: "skill-1",
      visibility: "private",
    });
  });

  it("copies a shared skill into a private saved copy", async () => {
    const context = createContext();
    context.db.query.skill.findFirst.mockResolvedValue({
      id: "skill-shared",
      name: "shared-skill",
      userId: "user-2",
      workspaceId: "ws-1",
      visibility: "public",
    });
    copySkillToWorkspaceOwnerMock.mockResolvedValue({
      id: "skill-copy",
      name: "shared-skill-2",
      displayName: "Shared Skill",
      description: "shared",
      icon: null,
      enabled: false,
      visibility: "private",
    });

    await expect(
      skillRouterAny.saveShared({
        input: { sourceSkillId: "skill-shared" },
        context,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "skill-copy",
        enabled: false,
        visibility: "private",
      }),
    );
  });

  it("returns a document url for readable shared skills", async () => {
    const context = createContext();
    context.db.query.skillDocument.findFirst.mockResolvedValue({
      id: "doc-1",
      filename: "doc.pdf",
      storageKey: "skills/user-2/skill-shared/doc.pdf",
      skill: {
        userId: "user-2",
        workspaceId: "ws-1",
        visibility: "public",
      },
    });

    await expect(
      skillRouterAny.getDocumentUrl({
        input: { id: "doc-1" },
        context,
      }),
    ).resolves.toEqual({
      url: "https://example.com/doc.pdf",
      filename: "doc.pdf",
    });
  });

  it("rejects file updates for non-owners", async () => {
    const context = createContext();
    context.db.query.skillFile.findFirst.mockResolvedValue({
      id: "file-1",
      skill: {
        userId: "user-2",
        workspaceId: "ws-1",
      },
    });

    await expect(
      skillRouterAny.updateFile({
        input: { id: "file-1", contentBase64: Buffer.from("updated", "utf8").toString("base64") },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
