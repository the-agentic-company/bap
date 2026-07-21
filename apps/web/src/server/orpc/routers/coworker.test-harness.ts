import { vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import { z } from "zod";

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

const coworkerRouterMocks = vi.hoisted(() => ({
  triggerCoworkerRunMock: vi.fn<VitestProcedure>(),
  reconcileStaleCoworkerRunsForCoworkerMock: vi.fn<VitestProcedure>(),
  reconcileStaleCoworkerRunsForCoworkersMock: vi.fn<VitestProcedure>(),
  reconcileCoworkerScheduleJobMock: vi.fn<VitestProcedure>(),
  syncCoworkerScheduleJobMock: vi.fn<VitestProcedure>(),
  removeCoworkerScheduleJobMock: vi.fn<VitestProcedure>(),
  generateCoworkerMetadataOnFirstPromptFillMock: vi.fn<VitestProcedure>(),
  normalizeAndEnsureUniqueCoworkerUsernameMock: vi.fn<VitestProcedure>(),
  applyCoworkerEditMock: vi.fn<VitestProcedure>(),
  uploadCoworkerDocumentMock: vi.fn<VitestProcedure>(),
  updateCoworkerDocumentMock: vi.fn<VitestProcedure>(),
  deleteCoworkerDocumentMock: vi.fn<VitestProcedure>(),
  createFileAssetFromBufferMock: vi.fn<VitestProcedure>(),
  markFileAssetReferenceMock: vi.fn<VitestProcedure>(),
  downloadFromS3Mock: vi.fn<VitestProcedure>(),
  ensureBucketMock: vi.fn<VitestProcedure>(),
  getPresignedDownloadUrlMock: vi.fn<VitestProcedure>(),
  uploadToS3Mock: vi.fn<VitestProcedure>(),
  listConfiguredRemoteIntegrationTargetsMock: vi.fn<VitestProcedure>(),
  searchRemoteIntegrationUsersMock: vi.fn<VitestProcedure>(),
  getWorkspaceMembershipForUserMock: vi.fn<VitestProcedure>(),
}));

export const {
  triggerCoworkerRunMock,
  reconcileStaleCoworkerRunsForCoworkerMock,
  reconcileStaleCoworkerRunsForCoworkersMock,
  reconcileCoworkerScheduleJobMock,
  syncCoworkerScheduleJobMock,
  removeCoworkerScheduleJobMock,
  generateCoworkerMetadataOnFirstPromptFillMock,
  normalizeAndEnsureUniqueCoworkerUsernameMock,
  applyCoworkerEditMock,
  uploadCoworkerDocumentMock,
  updateCoworkerDocumentMock,
  deleteCoworkerDocumentMock,
  createFileAssetFromBufferMock,
  markFileAssetReferenceMock,
  downloadFromS3Mock,
  ensureBucketMock,
  getPresignedDownloadUrlMock,
  uploadToS3Mock,
  listConfiguredRemoteIntegrationTargetsMock,
  searchRemoteIntegrationUsersMock,
  getWorkspaceMembershipForUserMock,
} = coworkerRouterMocks;

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("@bap/core/server/services/coworker-service", () => ({
  reconcileStaleCoworkerRunsForCoworker:
    coworkerRouterMocks.reconcileStaleCoworkerRunsForCoworkerMock,
  reconcileStaleCoworkerRunsForCoworkers:
    coworkerRouterMocks.reconcileStaleCoworkerRunsForCoworkersMock,
  triggerCoworkerRun: coworkerRouterMocks.triggerCoworkerRunMock,
}));

vi.mock("@bap/core/server/services/coworker-scheduler", () => ({
  reconcileCoworkerScheduleJob: coworkerRouterMocks.reconcileCoworkerScheduleJobMock,
  syncCoworkerScheduleJob: coworkerRouterMocks.syncCoworkerScheduleJobMock,
  removeCoworkerScheduleJob: coworkerRouterMocks.removeCoworkerScheduleJobMock,
}));

vi.mock("@bap/core/server/services/coworker-metadata", () => ({
  generateCoworkerMetadataOnFirstPromptFill:
    coworkerRouterMocks.generateCoworkerMetadataOnFirstPromptFillMock,
  normalizeAndEnsureUniqueCoworkerUsername:
    coworkerRouterMocks.normalizeAndEnsureUniqueCoworkerUsernameMock,
}));

vi.mock("@bap/core/server/billing/service", () => ({
  getWorkspaceMembershipForUser: coworkerRouterMocks.getWorkspaceMembershipForUserMock,
}));

vi.mock("@bap/core/server/services/coworker-builder-service", async () => {
  const actual = await vi.importActual<
    typeof import("@bap/core/server/services/coworker-builder-service")
  >("@bap/core/server/services/coworker-builder-service");
  return {
    ...actual,
    applyCoworkerEdit: coworkerRouterMocks.applyCoworkerEditMock,
  };
});

vi.mock("@/server/services/coworker-document", () => ({
  deleteCoworkerDocument: coworkerRouterMocks.deleteCoworkerDocumentMock,
  updateCoworkerDocument: coworkerRouterMocks.updateCoworkerDocumentMock,
  uploadCoworkerDocument: coworkerRouterMocks.uploadCoworkerDocumentMock,
}));

vi.mock("@bap/core/server/services/file-asset-service", () => ({
  createFileAssetFromBuffer: coworkerRouterMocks.createFileAssetFromBufferMock,
  markFileAssetReference: coworkerRouterMocks.markFileAssetReferenceMock,
}));

vi.mock("@bap/core/server/storage/s3-client", () => ({
  downloadFromS3: coworkerRouterMocks.downloadFromS3Mock,
  ensureBucket: coworkerRouterMocks.ensureBucketMock,
  getPresignedDownloadUrl: coworkerRouterMocks.getPresignedDownloadUrlMock,
  uploadToS3: coworkerRouterMocks.uploadToS3Mock,
}));

vi.mock("@bap/core/server/integrations/remote-integrations", () => {
  return {
    listConfiguredRemoteIntegrationTargets:
      coworkerRouterMocks.listConfiguredRemoteIntegrationTargetsMock,
    searchRemoteIntegrationUsers: coworkerRouterMocks.searchRemoteIntegrationUsersMock,
    remoteIntegrationTargetEnvSchema: z.enum(["staging", "prod"]),
    remoteIntegrationSourceSchema: z.object({
      targetEnv: z.enum(["staging", "prod"]),
      remoteUserId: z.string().min(1),
      requestedByUserId: z.string().min(1).optional(),
      requestedByEmail: z.email().nullable().optional(),
      remoteUserEmail: z.email().nullable().optional(),
    }),
  };
});

vi.mock("../workspace-access", () => ({
  requireActiveWorkspaceAccess: vi.fn<VitestProcedure>(async () => ({
    workspace: { id: "ws-1" },
    membership: { role: "member" },
  })),
  requireActiveWorkspaceAdmin: vi.fn<VitestProcedure>(async () => ({
    workspace: { id: "ws-1" },
    membership: { role: "admin" },
  })),
  isWorkspaceAdminRole: (role: string | null | undefined) => role === "admin" || role === "owner",
}));

import { coworkerRouter } from "./coworker";
export const coworkerRouterAny = coworkerRouter as unknown as Record<
  string,
  (args: unknown) => Promise<unknown>
>;
export const DEFAULT_MODEL = "openai/gpt-5.5";

export function createContext() {
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
  const transactionMock = vi.fn<VitestProcedure>((fn: (tx: unknown) => unknown) => fn(context.db));

  const selectResultQueue: unknown[][] = [];
  const enqueueSelectResult = (...rows: unknown[][]) => {
    selectResultQueue.push(...rows);
  };
  const buildSelectQuery = (shape: Record<string, unknown>, rows: unknown[]) => {
    const resolvedRows = Promise.resolve(rows);
    const result = Object.assign(resolvedRows, {
      orderBy: vi.fn<VitestProcedure>(() => resolvedRows),
      as: vi.fn<VitestProcedure>((alias: string) => ({ ...shape, __alias: alias })),
    });
    const query = {
      from: vi.fn<VitestProcedure>(() => query),
      innerJoin: vi.fn<VitestProcedure>(() => query),
      leftJoin: vi.fn<VitestProcedure>(() => query),
      where: vi.fn<VitestProcedure>(() => result),
    };
    return query;
  };
  const selectMock = vi.fn<VitestProcedure>((shape: Record<string, unknown>) =>
    buildSelectQuery(shape, selectResultQueue.shift() ?? []),
  );

  const context = {
    user: { id: "user-1" },
    session: { impersonatedBy: null },
    db: {
      query: {
        coworker: {
          findFirst: vi.fn<VitestProcedure>(),
          findMany: vi.fn<VitestProcedure>(),
        },
        coworkerDocument: {
          findFirst: vi.fn<VitestProcedure>(),
          findMany: vi.fn<VitestProcedure>(),
        },
        coworkerRun: {
          findMany: vi.fn<VitestProcedure>(),
          findFirst: vi.fn<VitestProcedure>(),
        },
        coworkerRunEvent: {
          findMany: vi.fn<VitestProcedure>(),
        },
        sandboxFile: {
          findMany: vi.fn<VitestProcedure>(),
        },
        generation: {
          findFirst: vi.fn<VitestProcedure>(),
        },
        conversation: {
          findFirst: vi.fn<VitestProcedure>(),
        },
        user: {
          findFirst: vi.fn<VitestProcedure>(),
        },
        workspace: {
          findFirst: vi.fn<VitestProcedure>(),
        },
        workspaceMcpServer: {
          findMany: vi.fn<VitestProcedure>(),
        },
      },
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
      select: selectMock,
      transaction: transactionMock,
    },
    mocks: {
      insertReturningMock,
      insertValuesMock,
      updateSetMock,
      updateReturningMock,
      deleteMock,
      deleteReturningMock,
      deleteWhereMock,
      transactionMock,
      enqueueSelectResult,
    },
  };

  context.db.query.user.findFirst.mockResolvedValue({ role: "member" });
  context.db.query.coworker.findMany.mockResolvedValue([]);
  context.db.query.coworkerRun.findMany.mockResolvedValue([]);
  context.db.query.coworkerRunEvent.findMany.mockResolvedValue([]);
  context.db.query.coworker.findFirst.mockResolvedValue({
    id: "wf-1",
    ownerId: "user-1",
    workspaceId: "ws-1",
    name: "Coworker",
    description: null,
    username: null,
    status: "on",
    triggerType: "manual",
    prompt: "",
    model: DEFAULT_MODEL,
    authSource: null,
    autoApprove: true,
    toolAccessMode: "all",
    allowedIntegrations: [],
    allowedCustomIntegrations: [],
    allowedSkillSlugs: [],
    schedule: null,
    builderConversationId: null,
    sharedAt: null,
    createdAt: new Date("2026-03-03T12:00:00.000Z"),
    updatedAt: new Date("2026-03-03T12:00:00.000Z"),
  });
  context.db.query.coworkerDocument.findFirst.mockResolvedValue({
    id: "doc-1",
    coworkerId: "wf-1",
  });
  context.db.query.coworkerDocument.findMany.mockResolvedValue([]);
  context.db.query.sandboxFile.findMany.mockResolvedValue([]);
  context.db.query.workspace.findFirst.mockResolvedValue({ id: "ws-2" });
  context.db.query.workspaceMcpServer.findMany.mockResolvedValue([]);

  return context;
}

export function resetCoworkerRouterTestHarness() {
  vi.clearAllMocks();
  generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValue({});
  normalizeAndEnsureUniqueCoworkerUsernameMock.mockImplementation(
    async ({ username }: { username?: string | null }) => {
      const trimmed = username?.trim();
      return trimmed ? trimmed.toLowerCase().replace(/\s+/g, "-") : null;
    },
  );
  syncCoworkerScheduleJobMock.mockResolvedValue(undefined);
  reconcileCoworkerScheduleJobMock.mockResolvedValue(undefined);
  removeCoworkerScheduleJobMock.mockResolvedValue(undefined);
  ensureBucketMock.mockResolvedValue(undefined);
  uploadToS3Mock.mockResolvedValue(undefined);
  reconcileStaleCoworkerRunsForCoworkerMock.mockResolvedValue(undefined);
  reconcileStaleCoworkerRunsForCoworkersMock.mockResolvedValue(undefined);
  triggerCoworkerRunMock.mockResolvedValue({
    coworkerId: "wf-1",
    runId: "run-1",
    generationId: "gen-1",
    conversationId: "conv-1",
  });
  applyCoworkerEditMock.mockResolvedValue({
    status: "applied",
    coworker: {
      coworkerId: "wf-1",
      updatedAt: "2026-03-03T12:01:00.000Z",
      prompt: "updated",
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
    },
    appliedChanges: ["prompt"],
  });
  uploadCoworkerDocumentMock.mockResolvedValue({
    id: "doc-1",
    filename: "brief.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4,
  });
  updateCoworkerDocumentMock.mockResolvedValue({
    id: "doc-1",
    filename: "brief-v2.pdf",
    mimeType: "application/pdf",
    sizeBytes: 8,
    description: null,
  });
  deleteCoworkerDocumentMock.mockResolvedValue({
    success: true,
    filename: "brief.pdf",
  });
  let fileAssetSequence = 0;
  createFileAssetFromBufferMock.mockImplementation(
    async ({
      workspaceId,
      filename,
      mimeType,
      content,
    }: {
      workspaceId: string;
      filename: string;
      mimeType: string;
      content: Buffer;
    }) => {
      fileAssetSequence += 1;
      const fileAssetId = `asset-${fileAssetSequence}`;
      return {
        id: fileAssetId,
        filename,
        mimeType,
        sizeBytes: content.length,
        storageKey: `file-assets/${workspaceId}/server/${fileAssetId}`,
      };
    },
  );
  markFileAssetReferenceMock.mockResolvedValue(undefined);
  downloadFromS3Mock.mockResolvedValue(Buffer.from("hello world"));
  getPresignedDownloadUrlMock.mockResolvedValue("https://storage.example.com/brief.pdf");
  listConfiguredRemoteIntegrationTargetsMock.mockReturnValue(["staging", "prod"]);
  searchRemoteIntegrationUsersMock.mockResolvedValue([
    {
      id: "remote-user-1",
      email: "client@example.com",
      name: "Client User",
      enabledIntegrationTypes: ["google_gmail", "hubspot"],
    },
  ]);
  getWorkspaceMembershipForUserMock.mockResolvedValue({ id: "membership-1", role: "member" });
}
