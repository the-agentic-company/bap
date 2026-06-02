import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

function createProcedureStub() {
  const stub = {
    input: vi.fn(),
    output: vi.fn(),
    handler: vi.fn((fn: unknown) => fn),
  };
  stub.input.mockReturnValue(stub);
  stub.output.mockReturnValue(stub);
  return stub;
}

const {
  triggerCoworkerRunMock,
  reconcileStaleCoworkerRunsForCoworkerMock,
  reconcileStaleCoworkerRunsForCoworkersMock,
  syncCoworkerScheduleJobMock,
  removeCoworkerScheduleJobMock,
  generateCoworkerMetadataOnFirstPromptFillMock,
  normalizeAndEnsureUniqueCoworkerUsernameMock,
  applyCoworkerEditMock,
  uploadCoworkerDocumentMock,
  deleteCoworkerDocumentMock,
  downloadFromS3Mock,
  getPresignedDownloadUrlMock,
  listConfiguredRemoteIntegrationTargetsMock,
  searchRemoteIntegrationUsersMock,
} = vi.hoisted(() => ({
  triggerCoworkerRunMock: vi.fn(),
  reconcileStaleCoworkerRunsForCoworkerMock: vi.fn(),
  reconcileStaleCoworkerRunsForCoworkersMock: vi.fn(),
  syncCoworkerScheduleJobMock: vi.fn(),
  removeCoworkerScheduleJobMock: vi.fn(),
  generateCoworkerMetadataOnFirstPromptFillMock: vi.fn(),
  normalizeAndEnsureUniqueCoworkerUsernameMock: vi.fn(),
  applyCoworkerEditMock: vi.fn(),
  uploadCoworkerDocumentMock: vi.fn(),
  deleteCoworkerDocumentMock: vi.fn(),
  downloadFromS3Mock: vi.fn(),
  getPresignedDownloadUrlMock: vi.fn(),
  listConfiguredRemoteIntegrationTargetsMock: vi.fn(),
  searchRemoteIntegrationUsersMock: vi.fn(),
}));

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("@cmdclaw/core/server/services/coworker-service", () => ({
  reconcileStaleCoworkerRunsForCoworker: reconcileStaleCoworkerRunsForCoworkerMock,
  reconcileStaleCoworkerRunsForCoworkers: reconcileStaleCoworkerRunsForCoworkersMock,
  triggerCoworkerRun: triggerCoworkerRunMock,
}));

vi.mock("@cmdclaw/core/server/services/coworker-scheduler", () => ({
  syncCoworkerScheduleJob: syncCoworkerScheduleJobMock,
  removeCoworkerScheduleJob: removeCoworkerScheduleJobMock,
}));

vi.mock("@cmdclaw/core/server/services/coworker-metadata", () => ({
  generateCoworkerMetadataOnFirstPromptFill: generateCoworkerMetadataOnFirstPromptFillMock,
  normalizeAndEnsureUniqueCoworkerUsername: normalizeAndEnsureUniqueCoworkerUsernameMock,
}));

vi.mock("@cmdclaw/core/server/services/coworker-builder-service", async () => {
  const actual = await vi.importActual<
    typeof import("@cmdclaw/core/server/services/coworker-builder-service")
  >("@cmdclaw/core/server/services/coworker-builder-service");
  return {
    ...actual,
    applyCoworkerEdit: applyCoworkerEditMock,
  };
});

vi.mock("@/server/services/coworker-document", () => ({
  deleteCoworkerDocument: deleteCoworkerDocumentMock,
  uploadCoworkerDocument: uploadCoworkerDocumentMock,
}));

vi.mock("@cmdclaw/core/server/storage/s3-client", () => ({
  downloadFromS3: downloadFromS3Mock,
  getPresignedDownloadUrl: getPresignedDownloadUrlMock,
}));

vi.mock("@cmdclaw/core/server/integrations/remote-integrations", () => {
  return {
    listConfiguredRemoteIntegrationTargets: listConfiguredRemoteIntegrationTargetsMock,
    searchRemoteIntegrationUsers: searchRemoteIntegrationUsersMock,
    remoteIntegrationTargetEnvSchema: z.enum(["staging", "prod"]),
    remoteIntegrationSourceSchema: z.object({
      targetEnv: z.enum(["staging", "prod"]),
      remoteUserId: z.string().min(1),
      requestedByUserId: z.string().min(1).optional(),
      requestedByEmail: z.string().email().nullable().optional(),
      remoteUserEmail: z.string().email().nullable().optional(),
    }),
  };
});

vi.mock("../workspace-access", () => ({
  requireActiveWorkspaceAccess: vi.fn(async () => ({
    workspace: { id: "ws-1" },
    membership: { role: "member" },
  })),
  requireActiveWorkspaceAdmin: vi.fn(async () => ({
    workspace: { id: "ws-1" },
    membership: { role: "admin" },
  })),
  isWorkspaceAdminRole: (role: string | null | undefined) => role === "admin" || role === "owner",
}));

import { coworkerRouter } from "./coworker";
const coworkerRouterAny = coworkerRouter as unknown as Record<
  string,
  (args: unknown) => Promise<unknown>
>;
const DEFAULT_MODEL = "openai/gpt-5.4";

function createContext() {
  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn();
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const deleteReturningMock = vi.fn();
  const deleteWhereMock = vi.fn(() => ({ returning: deleteReturningMock }));
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  const selectResultQueue: unknown[][] = [];
  const enqueueSelectResult = (...rows: unknown[][]) => {
    selectResultQueue.push(...rows);
  };
  const buildSelectQuery = (shape: Record<string, unknown>, rows: unknown[]) => {
    const resolvedRows = Promise.resolve(rows);
    const result = Object.assign(resolvedRows, {
      orderBy: vi.fn(() => resolvedRows),
      as: vi.fn((alias: string) => ({ ...shape, __alias: alias })),
    });
    const query = {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => query),
      leftJoin: vi.fn(() => query),
      where: vi.fn(() => result),
    };
    return query;
  };
  const selectMock = vi.fn((shape: Record<string, unknown>) =>
    buildSelectQuery(shape, selectResultQueue.shift() ?? []),
  );

  const context = {
    user: { id: "user-1" },
    session: { impersonatedBy: null },
    db: {
      query: {
        coworker: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        coworkerDocument: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        coworkerRun: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        coworkerRunEvent: {
          findMany: vi.fn(),
        },
        generation: {
          findFirst: vi.fn(),
        },
        conversation: {
          findFirst: vi.fn(),
        },
        user: {
          findFirst: vi.fn(),
        },
        workspaceMcpServer: {
          findMany: vi.fn(),
        },
      },
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
      select: selectMock,
    },
    mocks: {
      insertReturningMock,
      insertValuesMock,
      updateSetMock,
      updateReturningMock,
      deleteReturningMock,
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
    promptDo: null,
    promptDont: null,
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
  context.db.query.workspaceMcpServer.findMany.mockResolvedValue([]);

  return context;
}

describe("coworkerRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValue({});
    normalizeAndEnsureUniqueCoworkerUsernameMock.mockImplementation(
      async ({ username }: { username?: string | null }) => {
        const trimmed = username?.trim();
        return trimmed ? trimmed.toLowerCase().replace(/\s+/g, "-") : null;
      },
    );
    syncCoworkerScheduleJobMock.mockResolvedValue(undefined);
    removeCoworkerScheduleJobMock.mockResolvedValue(undefined);
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
    deleteCoworkerDocumentMock.mockResolvedValue({
      success: true,
      filename: "brief.pdf",
    });
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
  });

  it("creates a coworker and syncs schedule on happy path", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        name: "",
        description: null,
        username: null,
        status: "on",
        triggerType: "schedule",
      },
    ]);
    context.db.query.workspaceMcpServer.findMany.mockResolvedValue([
      {
        id: "linear-source-1",
        namespace: "linear",
        createdAt: new Date("2026-03-03T12:00:00.000Z"),
      },
    ]);

    const result = await coworkerRouterAny.create({
      input: {
        triggerType: "schedule",
        prompt: "Daily task",
        model: DEFAULT_MODEL,
        autoApprove: true,
        toolAccessMode: "selected",
        allowedIntegrations: ["linear", "slack"],
        allowedCustomIntegrations: [],
        schedule: {
          type: "daily",
          time: "09:30",
          timezone: "UTC",
        },
      },
      context,
    });

    expect(result).toEqual({
      id: "wf-1",
      name: "",
      description: null,
      username: null,
      status: "on",
    });
    expect(syncCoworkerScheduleJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wf-1" }),
    );
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedIntegrations: ["linear", "slack"],
        allowedWorkspaceMcpServerIds: ["linear-source-1"],
      }),
    );
  });

  it("rejects creating a Gmail-trigger coworker", async () => {
    const context = createContext();

    await expect(
      coworkerRouterAny.create({
        input: {
          triggerType: "gmail.new_email",
          prompt: "Watch Gmail",
          model: DEFAULT_MODEL,
          autoApprove: true,
          allowedIntegrations: ["slack"],
          allowedCustomIntegrations: [],
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Coworker trigger type is disabled: gmail.new_email",
    });

    expect(context.mocks.insertValuesMock).not.toHaveBeenCalled();
  });

  it("lists coworkers with run summaries and source classification", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    const startedAt = new Date("2026-02-11T09:30:00.000Z");
    const secondStartedAt = new Date("2026-02-10T09:30:00.000Z");

    context.db.query.coworker.findMany.mockResolvedValue([
      {
        id: "wf-1",
        name: "Daily Coworker",
        description: "Daily summary",
        username: "daily-coworker",
        status: "on",
        autoApprove: true,
        isPinned: false,
        triggerType: "schedule",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: { type: "daily", time: "09:30", timezone: "UTC" },
        updatedAt: now,
      },
      {
        id: "wf-2",
        name: "Manual Coworker",
        description: null,
        username: null,
        status: "off",
        autoApprove: false,
        isPinned: false,
        triggerType: "manual",
        allowedIntegrations: ["github"],
        allowedCustomIntegrations: [],
        schedule: null,
        updatedAt: now,
      },
    ]);
    context.mocks.enqueueSelectResult(
      [],
      [],
      [
        {
          runId: "run-1",
          coworkerId: "wf-1",
          status: "success",
          startedAt,
          conversationId: "conv-1",
          triggerPayload: { event: "schedule" },
        },
        {
          runId: "run-2",
          coworkerId: "wf-1",
          status: "failed",
          startedAt: secondStartedAt,
          conversationId: null,
          triggerPayload: {},
        },
      ],
    );

    const result = await coworkerRouterAny.list({ context });

    expect(result).toEqual([
      {
        id: "wf-1",
        name: "Daily Coworker",
        description: "Daily summary",
        username: "daily-coworker",
        status: "on",
        autoApprove: true,
        toolAccessMode: "selected",
        allowedSkillSlugs: [],
        triggerType: "schedule",
        integrations: ["slack"],
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: { type: "daily", time: "09:30", timezone: "UTC" },
        updatedAt: now,
        isPinned: false,
        tags: [],
        lastRunStatus: "success",
        lastRunAt: startedAt,
        recentRuns: [
          {
            id: "run-1",
            status: "success",
            startedAt,
            conversationId: "conv-1",
            source: "trigger",
          },
          {
            id: "run-2",
            status: "failed",
            startedAt: secondStartedAt,
            conversationId: null,
            source: "manual",
          },
        ],
      },
      {
        id: "wf-2",
        name: "Manual Coworker",
        description: null,
        username: null,
        status: "off",
        autoApprove: false,
        toolAccessMode: "selected",
        allowedSkillSlugs: [],
        triggerType: "manual",
        integrations: ["github"],
        allowedIntegrations: ["github"],
        allowedCustomIntegrations: [],
        schedule: null,
        updatedAt: now,
        isPinned: false,
        tags: [],
        lastRunStatus: null,
        lastRunAt: null,
        recentRuns: [],
      },
    ]);
    expect(reconcileStaleCoworkerRunsForCoworkersMock).toHaveBeenCalledWith(["wf-1", "wf-2"]);
  });

  it("gets a coworker with mapped runs", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      description: "Summarizes things",
      username: "coworker",
      status: "on",
      autoApprove: true,
      toolAccessMode: "selected",
      allowedSkillSlugs: [],
      triggerType: "manual",
      prompt: "Prompt",
      promptDo: "Do this",
      promptDont: "Don't do this",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
      createdAt: now,
      updatedAt: now,
    });
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "success",
        startedAt: now,
        finishedAt: now,
        errorMessage: null,
      },
    ]);

    const result = await coworkerRouterAny.get({
      input: { id: "wf-1" },
      context,
    });
    const getRunsArgs = context.db.query.coworkerRun.findMany.mock.calls[0]?.[0];
    const getRunsOrderBy = getRunsArgs.orderBy(
      { startedAt: "started-col" },
      { desc: (value: unknown) => `d:${value}` },
    );

    expect(result).toEqual({
      id: "wf-1",
      name: "Coworker",
      description: "Summarizes things",
      username: "coworker",
      status: "on",
      autoApprove: true,
      toolAccessMode: "selected",
      allowedSkillSlugs: [],
      triggerType: "manual",
      prompt: "Prompt",
      promptDo: "Do this",
      promptDont: "Don't do this",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
      createdAt: now,
      updatedAt: now,
      documents: [],
      runs: [
        {
          id: "run-1",
          status: "success",
          startedAt: now,
          finishedAt: now,
          errorMessage: null,
        },
      ],
    });
    expect(reconcileStaleCoworkerRunsForCoworkerMock).toHaveBeenCalledWith("wf-1");
    expect(getRunsOrderBy).toEqual(["d:started-col"]);
  });

  it("returns normalized history entries for successful writes", async () => {
    const context = createContext();
    const startedAt = new Date("2026-04-07T09:00:00.000Z");
    const actionAt = new Date("2026-04-07T09:01:00.000Z");

    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "completed",
        errorMessage: null,
        startedAt,
        coworker: {
          id: "wf-1",
          name: "Slack Notifier",
          username: "slack-notifier",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-1",
        coworkerRunId: "run-1",
        type: "tool_use",
        createdAt: actionAt,
        payload: {
          type: "tool_use",
          toolUseId: "tool-1",
          toolName: "bash",
          toolInput: {
            command: 'slack send -c "#eng" -t "hello"',
          },
          integration: "slack",
          operation: "send",
          isWrite: true,
        },
      },
      {
        id: "evt-2",
        coworkerRunId: "run-1",
        type: "tool_result",
        createdAt: new Date("2026-04-07T09:01:03.000Z"),
        payload: {
          type: "tool_result",
          toolUseId: "tool-1",
          toolName: "bash",
          result: { ok: true, channel: "#eng" },
        },
      },
    ]);

    const result = await coworkerRouterAny.getHistory({ context });

    expect(result).toEqual({
      entries: [
        {
          id: "run-1:tool-1",
          runId: "run-1",
          toolUseId: "tool-1",
          timestamp: actionAt,
          coworker: {
            id: "wf-1",
            name: "Slack Notifier",
            username: "slack-notifier",
          },
          integration: "slack",
          operation: "send",
          operationLabel: "Sending message",
          status: "success",
          target: "#eng",
          preview: {
            command: 'slack send -c "#eng" -t "hello"',
          },
        },
      ],
      nextCursor: undefined,
    });
    expect(reconcileStaleCoworkerRunsForCoworkersMock).toHaveBeenCalledWith(["wf-1"]);
  });

  it("marks rejected interrupts as denied", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-2",
        status: "completed",
        errorMessage: null,
        startedAt: new Date("2026-04-07T10:00:00.000Z"),
        coworker: {
          id: "wf-2",
          name: "GitHub Bot",
          username: "github-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-3",
        coworkerRunId: "run-2",
        type: "tool_use",
        createdAt: new Date("2026-04-07T10:00:05.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-2",
          toolName: "bash",
          toolInput: {
            command: 'github issues create --repo acme/api --title "Bug"',
          },
          integration: "github",
          operation: "issues.create",
          isWrite: true,
        },
      },
      {
        id: "evt-4",
        coworkerRunId: "run-2",
        type: "interrupt_resolved",
        createdAt: new Date("2026-04-07T10:00:10.000Z"),
        payload: {
          type: "interrupt_resolved",
          providerToolUseId: "tool-2",
          status: "rejected",
          display: {
            title: "Bash",
            integration: "github",
            operation: "issues.create",
            command: 'github issues create --repo acme/api --title "Bug"',
            toolInput: {
              command: 'github issues create --repo acme/api --title "Bug"',
            },
          },
        },
      },
    ]);

    const result = await coworkerRouterAny.getHistory({ context });

    expect(result).toEqual({
      entries: [
        expect.objectContaining({
          id: "run-2:tool-2",
          integration: "github",
          status: "denied",
          target: "acme/api",
        }),
      ],
      nextCursor: undefined,
    });
  });

  it("marks pending writes and prefers edited approval payloads", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-3",
        status: "awaiting_auth",
        errorMessage: null,
        startedAt: new Date("2026-04-07T11:00:00.000Z"),
        coworker: {
          id: "wf-3",
          name: "Docs Bot",
          username: "docs-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-5",
        coworkerRunId: "run-3",
        type: "tool_use",
        createdAt: new Date("2026-04-07T11:00:03.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-3",
          toolName: "bash",
          toolInput: {
            command: 'google-docs create --title "Draft Spec"',
          },
          integration: "google_docs",
          operation: "create-issue",
          isWrite: true,
        },
      },
      {
        id: "evt-6",
        coworkerRunId: "run-3",
        type: "interrupt_pending",
        createdAt: new Date("2026-04-07T11:00:04.000Z"),
        payload: {
          type: "interrupt_pending",
          providerToolUseId: "tool-3",
          status: "pending",
          kind: "auth",
          display: {
            title: "Bash",
            integration: "google_docs",
            operation: "create-issue",
            command: 'google-docs create --title "Draft Spec"',
            toolInput: {
              title: "Draft Spec",
            },
          },
        },
      },
      {
        id: "evt-7",
        coworkerRunId: "run-3",
        type: "user_interrupt",
        createdAt: new Date("2026-04-07T11:00:05.000Z"),
        payload: {
          toolUseId: "tool-3",
          toolName: "Bash",
          integration: "google_docs",
          operation: "create-issue",
          command: 'google-docs create --title "Edited Spec"',
          originalToolInput: { title: "Draft Spec" },
          updatedToolInput: { title: "Edited Spec" },
        },
      },
    ]);

    const result = await coworkerRouterAny.getHistory({ context });

    expect(result).toEqual({
      entries: [
        expect.objectContaining({
          id: "run-3:tool-3",
          status: "pending",
          target: "Edited Spec",
          preview: {
            title: "Edited Spec",
          },
        }),
      ],
      nextCursor: undefined,
    });
  });

  it("marks failed writes as errors when the run ends before a tool result", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-4",
        status: "error",
        errorMessage: "channel archived",
        startedAt: new Date("2026-04-07T12:00:00.000Z"),
        coworker: {
          id: "wf-4",
          name: "Alerts Bot",
          username: "alerts-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-8",
        coworkerRunId: "run-4",
        type: "tool_use",
        createdAt: new Date("2026-04-07T12:00:02.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-4",
          toolName: "bash",
          toolInput: {
            command: 'slack send -c "#alerts" -t "Outage"',
          },
          integration: "slack",
          operation: "send",
          isWrite: true,
        },
      },
    ]);

    const result = await coworkerRouterAny.getHistory({ context });

    expect(result).toEqual({
      entries: [
        expect.objectContaining({
          id: "run-4:tool-4",
          status: "error",
          preview: {
            command: 'slack send -c "#alerts" -t "Outage"',
            error: "channel archived",
          },
        }),
      ],
      nextCursor: undefined,
    });
  });

  it("returns multiple write actions from the same run", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-5",
        status: "completed",
        errorMessage: null,
        startedAt: new Date("2026-04-07T13:00:00.000Z"),
        coworker: {
          id: "wf-5",
          name: "Ops Bot",
          username: "ops-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-9",
        coworkerRunId: "run-5",
        type: "tool_use",
        createdAt: new Date("2026-04-07T13:00:01.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-5a",
          toolName: "bash",
          toolInput: {
            command: 'slack send -c "#ops" -t "Deploy"',
          },
          integration: "slack",
          operation: "send",
          isWrite: true,
        },
      },
      {
        id: "evt-10",
        coworkerRunId: "run-5",
        type: "tool_result",
        createdAt: new Date("2026-04-07T13:00:02.000Z"),
        payload: {
          type: "tool_result",
          toolUseId: "tool-5a",
          toolName: "bash",
          result: { ok: true },
        },
      },
      {
        id: "evt-11",
        coworkerRunId: "run-5",
        type: "tool_use",
        createdAt: new Date("2026-04-07T13:00:03.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-5b",
          toolName: "bash",
          toolInput: {
            command: 'github create-issue -o acme -r app -t "Follow-up"',
          },
          integration: "github",
          operation: "create-issue",
          isWrite: true,
        },
      },
      {
        id: "evt-12",
        coworkerRunId: "run-5",
        type: "tool_result",
        createdAt: new Date("2026-04-07T13:00:04.000Z"),
        payload: {
          type: "tool_result",
          toolUseId: "tool-5b",
          toolName: "bash",
          result: { ok: true },
        },
      },
    ]);

    const result = (await coworkerRouterAny.getHistory({ context })) as {
      entries: Array<{ id: string }>;
    };

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.id)).toEqual(["run-5:tool-5b", "run-5:tool-5a"]);
  });

  it("excludes read-only tool events from history", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-6",
        status: "completed",
        errorMessage: null,
        startedAt: new Date("2026-04-07T14:00:00.000Z"),
        coworker: {
          id: "wf-6",
          name: "Reader Bot",
          username: "reader-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-13",
        coworkerRunId: "run-6",
        type: "tool_use",
        createdAt: new Date("2026-04-07T14:00:01.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-6",
          toolName: "bash",
          toolInput: {
            command: "slack channels",
          },
          integration: "slack",
          operation: "channels",
          isWrite: false,
        },
      },
      {
        id: "evt-14",
        coworkerRunId: "run-6",
        type: "tool_result",
        createdAt: new Date("2026-04-07T14:00:02.000Z"),
        payload: {
          type: "tool_result",
          toolUseId: "tool-6",
          toolName: "bash",
          result: { ok: true },
        },
      },
    ]);

    const result = await coworkerRouterAny.getHistory({ context });

    expect(result).toEqual({
      entries: [],
      nextCursor: undefined,
    });
  });

  it("returns a cursor when older runs are available", async () => {
    const context = createContext();
    const newestRunAt = new Date("2026-04-07T15:00:00.000Z");
    const olderRunAt = new Date("2026-04-07T14:00:00.000Z");
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-7",
        status: "completed",
        errorMessage: null,
        startedAt: newestRunAt,
        coworker: {
          id: "wf-7",
          name: "Pager Bot",
          username: "pager-bot",
        },
      },
      {
        id: "run-8",
        status: "completed",
        errorMessage: null,
        startedAt: olderRunAt,
        coworker: {
          id: "wf-8",
          name: "Older Bot",
          username: "older-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-15",
        coworkerRunId: "run-7",
        type: "tool_use",
        createdAt: new Date("2026-04-07T15:00:05.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-7",
          toolName: "bash",
          toolInput: {
            command: 'slack send -c "#pager" -t "Heads up"',
          },
          integration: "slack",
          operation: "send",
          isWrite: true,
        },
      },
      {
        id: "evt-16",
        coworkerRunId: "run-7",
        type: "tool_result",
        createdAt: new Date("2026-04-07T15:00:06.000Z"),
        payload: {
          type: "tool_result",
          toolUseId: "tool-7",
          toolName: "bash",
          result: { ok: true },
        },
      },
    ]);

    const result = (await coworkerRouterAny.getHistory({
      input: { limit: 1 },
      context,
    })) as {
      entries: Array<{ id: string }>;
      nextCursor?: string;
    };

    expect(result.entries.map((entry) => entry.id)).toEqual(["run-7:tool-7"]);
    expect(result.nextCursor).toBe(
      JSON.stringify({ startedAt: newestRunAt.toISOString(), runId: "run-7" }),
    );
  });

  it("backfills missing builder metadata on get when prompt already exists", async () => {
    const context = createContext();
    const now = new Date("2026-03-12T10:00:00.000Z");
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValueOnce({
      description: "Summarizes the workflow.",
      username: "summary-sentence",
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-builder-1",
      name: "Builder Draft",
      description: null,
      username: null,
      status: "on",
      autoApprove: true,
      toolAccessMode: "all",
      allowedSkillSlugs: [],
      triggerType: "manual",
      prompt: "Summary sentence. another sentence",
      promptDo: null,
      promptDont: null,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
      createdAt: now,
      updatedAt: now,
    });
    context.mocks.updateReturningMock.mockResolvedValueOnce([
      {
        id: "wf-1",
        ownerId: "user-1",
        builderConversationId: "conv-builder-1",
        name: "Builder Draft",
        description: "Summarizes the workflow.",
        username: "summary-sentence",
        status: "on",
        autoApprove: true,
        toolAccessMode: "all",
        allowedSkillSlugs: [],
        triggerType: "manual",
        prompt: "Summary sentence. another sentence",
        promptDo: null,
        promptDont: null,
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    context.db.query.coworkerRun.findMany.mockResolvedValue([]);

    const result = await coworkerRouterAny.get({
      input: { id: "wf-1" },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Summarizes the workflow.",
        username: "summary-sentence",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        description: "Summarizes the workflow.",
        username: "summary-sentence",
      }),
    );
  });

  it("returns NOT_FOUND when getting a missing coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue(null);

    await expect(
      coworkerRouterAny.get({
        input: { id: "wf-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uploads a document for a coworker", async () => {
    const context = createContext();

    const result = await coworkerRouterAny.uploadDocument({
      input: {
        coworkerId: "wf-1",
        filename: "brief.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("test").toString("base64"),
        description: "Reference brief",
      },
      context,
    });

    expect(uploadCoworkerDocumentMock).toHaveBeenCalledWith({
      database: context.db,
      userId: "user-1",
      coworkerId: "wf-1",
      filename: "brief.pdf",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("test").toString("base64"),
      description: "Reference brief",
    });
    expect(result).toEqual({
      id: "doc-1",
      filename: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    });
  });

  it("deletes a document for a coworker", async () => {
    const context = createContext();

    const result = await coworkerRouterAny.deleteDocument({
      input: { id: "doc-1" },
      context,
    });

    expect(deleteCoworkerDocumentMock).toHaveBeenCalledWith({
      database: context.db,
      userId: "user-1",
      documentId: "doc-1",
    });
    expect(result).toEqual({
      success: true,
      filename: "brief.pdf",
    });
  });

  it("returns an app download URL for a coworker document", async () => {
    const context = createContext();
    context.db.query.coworkerDocument.findFirst.mockResolvedValue({
      coworkerId: "wf-1",
      filename: "brief.pdf",
      mimeType: "application/pdf",
      storageKey: "coworkers/user-1/wf-1/documents/brief.pdf",
    });

    const result = await coworkerRouterAny.getDocumentUrl({
      input: { id: "doc-1" },
      context,
    });

    expect(getPresignedDownloadUrlMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      url: "/api/coworkers/documents/doc-1/download",
      filename: "brief.pdf",
      mimeType: "application/pdf",
    });
  });

  it("uses provided coworker name without generation", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-2",
        name: "Explicit Name",
        description: null,
        username: null,
        status: "on",
        triggerType: "manual",
      },
    ]);

    const result = await coworkerRouterAny.create({
      input: {
        name: "  Explicit Name  ",
        triggerType: "manual",
        prompt: "Prompt text",
        model: DEFAULT_MODEL,
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
      },
      context,
    });

    expect(result).toEqual({
      id: "wf-2",
      name: "Explicit Name",
      description: null,
      username: null,
      status: "on",
    });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Explicit Name" }),
    );
    expect(generateCoworkerMetadataOnFirstPromptFillMock).not.toHaveBeenCalled();
    expect(syncCoworkerScheduleJobMock).not.toHaveBeenCalled();
  });

  it("creates a coworker with blank metadata when no explicit values are provided", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-3",
        name: "",
        description: null,
        username: null,
        status: "on",
        triggerType: "manual",
      },
    ]);

    const result = (await coworkerRouterAny.create({
      input: {
        triggerType: "manual",
        prompt: "First sentence for fallback. second sentence",
        model: DEFAULT_MODEL,
        autoApprove: true,
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
      },
      context,
    })) as {
      name: string;
      description: string | null;
      username: string | null;
    };

    expect(result).toEqual({
      id: "wf-3",
      name: "",
      description: null,
      username: null,
      status: "on",
    });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "", description: null, username: null }),
    );
  });

  it("rejects admin-only Claude model on create for non-admin users", async () => {
    const context = createContext();

    await expect(
      coworkerRouterAny.create({
        input: {
          triggerType: "manual",
          prompt: "Prompt text",
          model: "anthropic/claude-sonnet-4-6",
          allowedIntegrations: ["slack"],
          allowedCustomIntegrations: [],
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Claude Sonnet 4.6 is only available to admins.",
    });
  });

  it("normalizes and persists explicit username and description on create", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-4",
        name: "Coworker",
        description: "Handles follow-ups",
        username: "team-helper",
        status: "on",
        triggerType: "manual",
      },
    ]);

    await coworkerRouterAny.create({
      input: {
        name: "Coworker",
        description: "  Handles follow-ups  ",
        username: " Team Helper ",
        triggerType: "manual",
        prompt: "... \n!",
        model: DEFAULT_MODEL,
        autoApprove: true,
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
      },
      context,
    });

    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Coworker",
        description: "Handles follow-ups",
        username: "team-helper",
      }),
    );
  });

  it("returns INTERNAL_SERVER_ERROR when schedule sync fails during create", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        name: "",
        description: null,
        username: null,
        status: "on",
        triggerType: "schedule",
      },
    ]);
    syncCoworkerScheduleJobMock.mockRejectedValue(new Error("scheduler down"));

    await expect(
      coworkerRouterAny.create({
        input: {
          triggerType: "schedule",
          prompt: "Daily task",
          model: DEFAULT_MODEL,
          autoApprove: true,
          allowedIntegrations: ["slack"],
          allowedCustomIntegrations: [],
          schedule: {
            type: "daily",
            time: "09:30",
            timezone: "UTC",
          },
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("updates a coworker on happy path", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Old Name",
      status: "on",
      triggerType: "manual",
      prompt: "Old prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "off",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    const result = await coworkerRouterAny.update({
      input: {
        id: "wf-1",
        name: "Renamed Coworker",
        status: "off",
      },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("rejects changing a coworker to the Gmail trigger", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });

    await expect(
      coworkerRouterAny.update({
        input: {
          id: "wf-1",
          triggerType: "gmail.new_email",
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Coworker trigger type is disabled: gmail.new_email",
    });

    expect(context.mocks.updateSetMock).not.toHaveBeenCalled();
  });

  it("preserves existing legacy Gmail trigger when editing other fields", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "gmail.new_email",
      prompt: "Prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "gmail.new_email",
        schedule: null,
      },
    ]);

    const result = await coworkerRouterAny.update({
      input: {
        id: "wf-1",
        name: "Renamed Coworker",
        triggerType: "gmail.new_email",
      },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Renamed Coworker",
        triggerType: "gmail.new_email",
      }),
    );
  });

  it("returns NOT_FOUND when updating a missing coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue(null);

    await expect(
      coworkerRouterAny.update({
        input: {
          id: "wf-missing",
          name: "Name",
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects admin-only Claude model on update for non-admin users", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
      model: DEFAULT_MODEL,
      authSource: "shared",
    });

    await expect(
      coworkerRouterAny.update({
        input: {
          id: "wf-1",
          model: "anthropic/claude-sonnet-4-6",
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Claude Sonnet 4.6 is only available to admins.",
    });
  });

  it("returns INTERNAL_SERVER_ERROR when schedule sync fails during update", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "schedule",
      prompt: "Prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: { type: "daily", time: "09:00", timezone: "UTC" },
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "schedule",
        schedule: { type: "daily", time: "09:00", timezone: "UTC" },
      },
    ]);
    syncCoworkerScheduleJobMock.mockRejectedValue(new Error("scheduler down"));

    await expect(
      coworkerRouterAny.update({
        input: {
          id: "wf-1",
          schedule: { type: "daily", time: "09:00", timezone: "UTC" },
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("returns NOT_FOUND when update returning payload is empty", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([]);

    await expect(
      coworkerRouterAny.update({
        input: { id: "wf-1", name: "Renamed" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not sync scheduler when update changes only non-schedule fields", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    const result = await coworkerRouterAny.update({
      input: { id: "wf-1", name: "Renamed" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(syncCoworkerScheduleJobMock).not.toHaveBeenCalled();
  });

  it("updates allowed integration fields when provided", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "Prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    await coworkerRouterAny.update({
      input: {
        id: "wf-1",
        allowedIntegrations: ["github", "slack"],
        allowedCustomIntegrations: ["custom-1"],
      },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedIntegrations: ["github", "slack"],
        allowedCustomIntegrations: ["custom-1"],
      }),
    );
  });

  it("sets empty coworker name when updating with blank name and blank prompt", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Coworker",
      status: "on",
      triggerType: "manual",
      prompt: "   ",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    await coworkerRouterAny.update({
      input: { id: "wf-1", name: "   " },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ name: "" }));
  });

  it("fills missing metadata on first prompt transition from blank to non-blank", async () => {
    const context = createContext();
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValueOnce({
      name: "Summary sentence",
      description: "Summarizes the workflow.",
      username: "summary-sentence",
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "",
      description: null,
      username: null,
      status: "on",
      triggerType: "manual",
      prompt: "   ",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    await coworkerRouterAny.update({
      input: {
        id: "wf-1",
        prompt: "Summary sentence. another sentence",
      },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Summary sentence. another sentence",
        name: "Summary sentence",
        description: "Summarizes the workflow.",
        username: "summary-sentence",
      }),
    );
  });

  it("preserves explicit name on first prompt transition while filling other metadata", async () => {
    const context = createContext();
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValueOnce({
      description: "Summarizes the workflow.",
      username: "explicit-name",
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "",
      description: null,
      username: null,
      status: "on",
      triggerType: "manual",
      prompt: "   ",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    await coworkerRouterAny.update({
      input: { id: "wf-1", name: "Explicit Name", prompt: "... \n!" },
      context,
    });

    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Explicit Name",
        description: "Summarizes the workflow.",
        username: "explicit-name",
      }),
    );
  });

  it("does not generate metadata after the prompt was already non-empty", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Existing",
      description: "Existing description",
      username: "existing",
      status: "on",
      triggerType: "manual",
      prompt: "Original prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    await coworkerRouterAny.update({
      input: { id: "wf-1", prompt: "Updated prompt" },
      context,
    });

    expect(generateCoworkerMetadataOnFirstPromptFillMock).toHaveBeenCalled();
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        name: expect.any(String),
        description: expect.any(String),
        username: expect.any(String),
      }),
    );
  });

  it("normalizes manual username edits before persisting", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      name: "Existing",
      description: null,
      username: null,
      status: "on",
      triggerType: "manual",
      prompt: "Original prompt",
      promptDo: null,
      promptDont: null,
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: [],
      schedule: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([
      {
        id: "wf-1",
        status: "on",
        triggerType: "manual",
        schedule: null,
      },
    ]);

    await coworkerRouterAny.update({
      input: { id: "wf-1", username: " Team Helper " },
      context,
    });

    expect(normalizeAndEnsureUniqueCoworkerUsernameMock).toHaveBeenCalledWith({
      database: context.db,
      coworkerId: "wf-1",
      username: "Team Helper",
    });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: "team-helper" }),
    );
  });

  it("deletes a manual coworker without touching the scheduler", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValue([{ id: "wf-1" }]);
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Router procedure call, not a Drizzle query
    const result = await coworkerRouterAny.delete({
      input: { id: "wf-1" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(removeCoworkerScheduleJobMock).not.toHaveBeenCalled();
  });

  it("removes a scheduled coworker job before deleting the coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      name: "Scheduled coworker",
      status: "on",
      triggerType: "schedule",
      schedule: { type: "daily", time: "09:00", timezone: "UTC" },
    });
    context.mocks.deleteReturningMock.mockResolvedValue([{ id: "wf-1" }]);

    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Router procedure call, not a Drizzle query
    const result = await coworkerRouterAny.delete({
      input: { id: "wf-1" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(removeCoworkerScheduleJobMock).toHaveBeenCalledWith("wf-1");
  });

  it("returns NOT_FOUND when deleting a missing coworker", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValue([]);

    await expect(
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- Router procedure call, not a Drizzle query
      coworkerRouterAny.delete({
        input: { id: "wf-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates builder conversations with auto-approve disabled", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      name: "Coworker",
      builderConversationId: null,
    });
    context.mocks.insertReturningMock.mockResolvedValue([{ id: "conv-builder-1" }]);

    const result = await coworkerRouterAny.getOrCreateBuilderConversation({
      input: { id: "wf-1" },
      context,
    });

    expect(result).toEqual({ conversationId: "conv-builder-1" });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "coworker",
        autoApprove: false,
      }),
    );
  });

  it("forces existing builder conversations to disable auto-approve", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      name: "Coworker",
      builderConversationId: "conv-builder-1",
    });
    context.db.query.conversation.findFirst.mockResolvedValue({
      id: "conv-builder-1",
      autoApprove: true,
      userId: "user-1",
      workspaceId: "ws-1",
      type: "coworker",
    });

    const result = await coworkerRouterAny.getOrCreateBuilderConversation({
      input: { id: "wf-1" },
      context,
    });

    expect(result).toEqual({ conversationId: "conv-builder-1" });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ autoApprove: false }),
    );
  });

  it("exports a coworker definition with embedded documents", async () => {
    const context = createContext();
    const createdAt = new Date("2026-03-04T12:00:00.000Z");
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      name: "Inbox triage",
      description: "Sort and summarize inbound work.",
      username: "inbox-triage",
      status: "on",
      triggerType: "manual",
      prompt: "Do the work",
      model: DEFAULT_MODEL,
      authSource: "shared",
      promptDo: "Do the work carefully",
      promptDont: "Do not spam",
      autoApprove: true,
      toolAccessMode: "selected",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: ["custom-1"],
      allowedSkillSlugs: ["skill-a"],
      schedule: null,
      builderConversationId: null,
      sharedAt: null,
    });
    context.db.query.coworkerDocument.findMany.mockResolvedValue([
      {
        id: "doc-1",
        coworkerId: "wf-1",
        filename: "brief.txt",
        mimeType: "text/plain",
        description: "Brief",
        storageKey: "s3/doc-1",
        createdAt,
      },
    ]);

    const result = await coworkerRouterAny.exportDefinition({
      input: { id: "wf-1" },
      context,
    });

    expect(downloadFromS3Mock).toHaveBeenCalledWith("s3/doc-1");
    expect(result).toMatchObject({
      version: 1,
      coworker: {
        name: "Inbox triage",
        username: "inbox-triage",
        toolAccessMode: "selected",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: ["custom-1"],
        allowedSkillSlugs: ["skill-a"],
      },
      documents: [
        {
          filename: "brief.txt",
          mimeType: "text/plain",
          description: "Brief",
          contentBase64: Buffer.from("hello world").toString("base64"),
        },
      ],
    });
  });

  it("imports a coworker definition in the off state and uploads documents", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "wf-imported",
        name: "Imported coworker",
        description: "Imported description",
        username: "imported-coworker",
        status: "off",
      },
    ]);

    const result = await coworkerRouterAny.importDefinition({
      input: {
        definitionJson: JSON.stringify({
          version: 1,
          exportedAt: "2026-03-26T10:00:00.000Z",
          coworker: {
            name: "Imported coworker",
            description: "Imported description",
            username: "imported-coworker",
            status: "on",
            triggerType: "schedule",
            prompt: "Run every day",
            model: DEFAULT_MODEL,
            authSource: "shared",
            promptDo: "Do it",
            promptDont: "Do not skip",
            autoApprove: true,
            toolAccessMode: "selected",
            allowedIntegrations: ["slack"],
            allowedCustomIntegrations: ["custom-1"],
            allowedWorkspaceMcpServerIds: [],
            allowedSkillSlugs: ["skill-a"],
            schedule: {
              type: "daily",
              time: "09:00",
              timezone: "UTC",
            },
          },
          documents: [
            {
              filename: "brief.txt",
              mimeType: "text/plain",
              description: "Brief",
              contentBase64: "aGVsbG8=",
            },
          ],
        }),
      },
      context,
    });

    expect(result).toEqual({
      id: "wf-imported",
      name: "Imported coworker",
      description: "Imported description",
      username: "imported-coworker",
      status: "off",
    });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Imported coworker",
        status: "off",
        triggerType: "schedule",
        toolAccessMode: "selected",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: ["custom-1"],
        allowedSkillSlugs: ["skill-a"],
      }),
    );
    expect(uploadCoworkerDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: expect.any(String),
        filename: "brief.txt",
        mimeType: "text/plain",
        contentBase64: "aGVsbG8=",
        description: "Brief",
      }),
    );
    expect(syncCoworkerScheduleJobMock).not.toHaveBeenCalled();
  });

  it("returns INTERNAL_SERVER_ERROR when scheduler cleanup fails during delete", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      name: "Scheduled coworker",
      status: "on",
      triggerType: "schedule",
      schedule: { type: "daily", time: "09:00", timezone: "UTC" },
    });
    context.mocks.deleteReturningMock.mockResolvedValue([{ id: "wf-1" }]);
    removeCoworkerScheduleJobMock.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- Router procedure call, not a Drizzle query
      coworkerRouterAny.delete({
        input: { id: "wf-1" },
        context,
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("forwards trigger payload and user role to triggerCoworkerRun", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({ role: "admin" });

    const result = await coworkerRouterAny.trigger({
      input: { id: "wf-1", payload: { source: "manual" } },
      context,
    });

    expect(result).toEqual({
      coworkerId: "wf-1",
      runId: "run-1",
      generationId: "gen-1",
      conversationId: "conv-1",
    });

    expect(triggerCoworkerRunMock).toHaveBeenCalledWith({
      coworkerId: "wf-1",
      triggerPayload: { source: "manual" },
      userId: "user-1",
      userRole: "admin",
    });
  });

  it("defaults trigger payload to empty object when omitted", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue(null);

    await coworkerRouterAny.trigger({
      input: { id: "wf-1" },
      context,
    });

    expect(triggerCoworkerRunMock).toHaveBeenCalledWith({
      coworkerId: "wf-1",
      triggerPayload: {},
      userId: "user-1",
      userRole: null,
    });
  });

  it("passes remote integration source and actor metadata for admin triggers", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({
      role: "admin",
      email: "admin@example.com",
    });

    await coworkerRouterAny.trigger({
      input: {
        id: "wf-1",
        payload: { source: "manual" },
        remoteIntegrationSource: {
          targetEnv: "prod",
          remoteUserId: "remote-user-1",
        },
      },
      context,
    });

    expect(triggerCoworkerRunMock).toHaveBeenCalledWith({
      coworkerId: "wf-1",
      triggerPayload: { source: "manual" },
      userId: "user-1",
      userRole: "admin",
      remoteIntegrationSource: {
        targetEnv: "prod",
        remoteUserId: "remote-user-1",
        requestedByUserId: "user-1",
        requestedByEmail: "admin@example.com",
      },
    });
  });

  it("passes manual trigger attachments through to triggerCoworkerRun", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({ role: "member" });

    await coworkerRouterAny.trigger({
      input: {
        id: "wf-1",
        payload: { source: "manual_inbox", message: "Check this" },
        fileAttachments: [
          {
            name: "notes.txt",
            mimeType: "text/plain",
            dataUrl: "data:text/plain;base64,bm90ZXM=",
          },
        ],
      },
      context,
    });

    expect(triggerCoworkerRunMock).toHaveBeenCalledWith({
      coworkerId: "wf-1",
      triggerPayload: { source: "manual_inbox", message: "Check this" },
      fileAttachments: [
        {
          name: "notes.txt",
          mimeType: "text/plain",
          dataUrl: "data:text/plain;base64,bm90ZXM=",
        },
      ],
      userId: "user-1",
      userRole: "member",
    });
  });

  it("rejects remote integration triggers for non-admin users", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({
      role: "member",
      email: "member@example.com",
    });

    await expect(
      coworkerRouterAny.trigger({
        input: {
          id: "wf-1",
          remoteIntegrationSource: {
            targetEnv: "staging",
            remoteUserId: "remote-user-1",
          },
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists configured remote integration targets for admins", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({
      role: "admin",
      email: "admin@example.com",
    });

    const result = await coworkerRouterAny.listRemoteIntegrationTargets({
      input: {},
      context,
    });

    expect(result).toEqual({ targets: ["staging", "prod"] });
  });

  it("searches remote integration users for admins", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({
      role: "admin",
      email: "admin@example.com",
    });

    const result = await coworkerRouterAny.searchRemoteIntegrationUsers({
      input: { targetEnv: "prod", query: "client" },
      context,
    });

    expect(searchRemoteIntegrationUsersMock).toHaveBeenCalledWith({
      targetEnv: "prod",
      query: "client",
      limit: undefined,
    });
    expect(result).toEqual({
      users: [
        {
          id: "remote-user-1",
          email: "client@example.com",
          name: "Client User",
          enabledIntegrationTypes: ["google_gmail", "hubspot"],
        },
      ],
    });
  });

  it("applies coworker builder edits with user role context", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({ role: "admin" });

    const result = await coworkerRouterAny.edit({
      input: {
        coworkerId: "wf-1",
        baseUpdatedAt: "2026-03-03T12:00:00.000Z",
        changes: { prompt: "new prompt" },
      },
      context,
    });

    expect(result).toEqual({
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
    expect(applyCoworkerEditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userRole: "admin",
        coworkerId: "wf-1",
      }),
    );
  });

  it("returns minimal coworker impersonation target metadata for app admins", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({ role: "admin" });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-2",
      name: "Inbox Triage",
      username: "inbox-triage",
      ownerId: "user-2",
      owner: {
        id: "user-2",
        name: "Other User",
        email: "other@example.com",
        image: "https://example.com/avatar.png",
      },
    });

    const result = await coworkerRouterAny.getImpersonationTarget({
      input: { coworkerId: "wf-2" },
      context,
    });

    expect(result).toEqual({
      resourceType: "coworker",
      resourceId: "wf-2",
      resourceLabel: "@inbox-triage",
      owner: {
        id: "user-2",
        name: "Other User",
        email: "other@example.com",
        image: "https://example.com/avatar.png",
      },
    });
  });

  it("returns NOT_FOUND when getting a missing run", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findFirst.mockResolvedValue(null);

    await expect(
      coworkerRouterAny.getRun({
        input: { id: "run-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND when run exists but coworker is not accessible", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findFirst.mockResolvedValue({
      id: "run-1",
      coworkerId: "wf-1",
      status: "success",
      triggerPayload: {},
      generationId: null,
      startedAt: new Date("2026-02-12T00:00:00.000Z"),
      finishedAt: null,
      errorMessage: null,
    });
    context.db.query.coworker.findFirst.mockResolvedValue(null);

    await expect(
      coworkerRouterAny.getRun({
        input: { id: "run-1" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gets run details with ordered events and conversation id", async () => {
    const context = createContext();
    const createdAt = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.coworkerRun.findFirst.mockResolvedValue({
      id: "run-1",
      coworkerId: "wf-1",
      status: "success",
      triggerPayload: { source: "schedule" },
      generationId: "gen-1",
      startedAt: createdAt,
      finishedAt: createdAt,
      errorMessage: null,
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      name: "Inbox Triage",
      username: "inbox-triage",
      ownerId: "user-1",
    });
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-1",
        type: "started",
        payload: { ok: true },
        createdAt,
      },
    ]);
    context.db.query.generation.findFirst.mockResolvedValue({
      conversationId: "conv-1",
    });

    const result = await coworkerRouterAny.getRun({
      input: { id: "run-1" },
      context,
    });
    const eventArgs = context.db.query.coworkerRunEvent.findMany.mock.calls[0]?.[0];
    const eventsOrderBy = eventArgs.orderBy(
      { createdAt: "created-col" },
      { asc: (value: unknown) => `a:${value}` },
    );

    expect(result).toEqual({
      id: "run-1",
      coworkerId: "wf-1",
      coworkerName: "Inbox Triage",
      coworkerUsername: "inbox-triage",
      status: "success",
      triggerPayload: { source: "schedule" },
      generationId: "gen-1",
      conversationId: "conv-1",
      startedAt: createdAt,
      finishedAt: createdAt,
      errorMessage: null,
      debugInfo: null,
      events: [
        {
          id: "evt-1",
          type: "started",
          payload: { ok: true },
          createdAt,
        },
      ],
    });
    expect(reconcileStaleCoworkerRunsForCoworkerMock).toHaveBeenCalledWith("wf-1");
    expect(eventsOrderBy).toEqual(["a:created-col"]);
  });

  it("allows an existing admin impersonator to fetch minimal run impersonation target metadata", async () => {
    const context = createContext();
    (context.session as { impersonatedBy: string | null }).impersonatedBy = "admin-user";
    context.db.query.user.findFirst
      .mockResolvedValueOnce({ role: "member" })
      .mockResolvedValueOnce({ role: "admin" });
    context.db.query.coworkerRun.findFirst.mockResolvedValue({
      id: "run-2",
      coworkerId: "wf-2",
      ownerId: "user-2",
      owner: {
        id: "user-2",
        name: "Other User",
        email: "other@example.com",
        image: null,
      },
      coworker: {
        id: "wf-2",
        name: "Inbox Triage",
        username: null,
      },
    });

    const result = await coworkerRouterAny.getRunImpersonationTarget({
      input: { runId: "run-2", coworkerId: "wf-2" },
      context,
    });

    expect(result).toEqual({
      resourceType: "coworker_run",
      resourceId: "run-2",
      resourceLabel: "Inbox Triage",
      owner: {
        id: "user-2",
        name: "Other User",
        email: "other@example.com",
        image: null,
      },
    });
  });

  it("sets null conversation id when run has no generation", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findFirst.mockResolvedValue({
      id: "run-2",
      coworkerId: "wf-1",
      status: "success",
      triggerPayload: {},
      generationId: null,
      startedAt: new Date("2026-02-12T00:00:00.000Z"),
      finishedAt: null,
      errorMessage: null,
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      name: "Inbox Triage",
      username: null,
      ownerId: "user-1",
    });
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([]);

    const result = (await coworkerRouterAny.getRun({
      input: { id: "run-2" },
      context,
    })) as { conversationId: string | null };

    expect(result.conversationId).toBeNull();
    expect(result).toMatchObject({
      coworkerName: "Inbox Triage",
      coworkerUsername: null,
    });
    expect(context.db.query.generation.findFirst).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when listing runs for missing coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue(null);

    await expect(
      coworkerRouterAny.listRuns({
        input: { coworkerId: "wf-missing", limit: 10 },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists coworker runs with public fields", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
    });
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "success",
        startedAt: now,
        finishedAt: now,
        errorMessage: null,
      },
    ]);

    const result = await coworkerRouterAny.listRuns({
      input: { coworkerId: "wf-1", limit: 10 },
      context,
    });
    const listRunsArgs = context.db.query.coworkerRun.findMany.mock.calls[0]?.[0];
    const listRunsOrderBy = listRunsArgs.orderBy(
      { startedAt: "started-col" },
      { desc: (value: unknown) => `d:${value}` },
    );

    expect(result).toEqual([
      {
        id: "run-1",
        status: "success",
        startedAt: now,
        finishedAt: now,
        errorMessage: null,
      },
    ]);
    expect(reconcileStaleCoworkerRunsForCoworkerMock).toHaveBeenCalledWith("wf-1");
    expect(listRunsOrderBy).toEqual(["d:started-col"]);
  });

  it("lists workspace runs with cursor pagination", async () => {
    const context = createContext();
    const newestRunAt = new Date("2026-04-13T10:00:00.000Z");
    const olderRunAt = new Date("2026-04-13T09:00:00.000Z");
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "success",
        startedAt: newestRunAt,
        finishedAt: newestRunAt,
        errorMessage: null,
        coworker: {
          id: "wf-1",
          name: "Inbox Triage",
        },
        generation: {
          conversationId: "conv-1",
        },
      },
      {
        id: "run-2",
        status: "error",
        startedAt: olderRunAt,
        finishedAt: olderRunAt,
        errorMessage: "boom",
        coworker: {
          id: "wf-2",
          name: "Follow Up",
        },
        generation: {
          conversationId: "conv-2",
        },
      },
    ]);

    const result = (await coworkerRouterAny.listWorkspaceRuns({
      input: { limit: 1 },
      context,
    })) as {
      runs: Array<{
        id: string;
        coworkerName: string;
        conversationId: string | null;
      }>;
      nextCursor?: string;
    };
    const listRunsArgs = context.db.query.coworkerRun.findMany.mock.calls[0]?.[0];

    expect(result.runs).toEqual([
      {
        id: "run-1",
        status: "success",
        startedAt: newestRunAt,
        finishedAt: newestRunAt,
        errorMessage: null,
        conversationId: "conv-1",
        coworkerId: "wf-1",
        coworkerName: "Inbox Triage",
      },
    ]);
    expect(result.nextCursor).toBeTruthy();
    expect(JSON.parse(result.nextCursor!)).toEqual({
      startedAt: newestRunAt.toISOString(),
      runId: "run-1",
    });
    expect(reconcileStaleCoworkerRunsForCoworkersMock).toHaveBeenCalledWith(["wf-1"]);
    expect(listRunsArgs.orderBy).toHaveLength(2);
  });

  it("lists workspace runs with status and coworker filters", async () => {
    const context = createContext();

    await coworkerRouterAny.listWorkspaceRuns({
      input: { status: "error", coworkerId: "wf-1", limit: 25 },
      context,
    });

    const listRunsArgs = context.db.query.coworkerRun.findMany.mock.calls[0]?.[0];
    const conditionParts = collectSqlConditionParts(listRunsArgs.where);

    expect(listRunsArgs.limit).toBe(26);
    expect(conditionParts.columns).toContain("status");
    expect(conditionParts.columns).toContain("coworker_id");
    expect(conditionParts.params).toContain("error");
    expect(conditionParts.params).toContain("wf-1");
  });
});

function collectSqlConditionParts(value: unknown): { columns: string[]; params: unknown[] } {
  const columns: string[] = [];
  const params: unknown[] = [];
  const seen = new Set<unknown>();

  function visit(node: unknown) {
    if (!node || typeof node !== "object" || seen.has(node)) {
      return;
    }
    seen.add(node);

    const record = node as Record<string, unknown>;
    if (typeof record.name === "string" && typeof record.columnType === "string") {
      columns.push(record.name);
    }
    if ("encoder" in record && "value" in record) {
      params.push(record.value);
    }

    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          visit(item);
        }
      } else {
        visit(child);
      }
    }
  }

  visit(value);
  return { columns, params };
}
