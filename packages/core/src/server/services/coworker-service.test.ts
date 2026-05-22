import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.DATABASE_URL = "postgres://localhost/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.SANDBOX_DEFAULT = "docker";
process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CMDCLAW_SERVER_SECRET = "1".repeat(64);
process.env.AWS_ENDPOINT_URL = "https://s3.example.com";
process.env.AWS_ACCESS_KEY_ID = "test-access-key";
process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";

const coworkerFindFirstMock = vi.fn();
const coworkerRunFindManyMock = vi.fn();
const coworkerRunFindFirstMock = vi.fn();
const workspaceExecutorSourceFindManyMock = vi.fn();
const getEnabledIntegrationTypesMock = vi.fn();
const getRemoteIntegrationCredentialsMock = vi.fn();

const insertValuesMock = vi.fn();
const insertMock = vi.fn(() => ({ values: insertValuesMock }));

const updateWhereMock = vi.fn();
const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
const updateMock = vi.fn(() => ({ set: updateSetMock }));

const dbMock = {
  query: {
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    coworkerRun: {
      findMany: coworkerRunFindManyMock,
      findFirst: coworkerRunFindFirstMock,
    },
    workspaceExecutorSource: {
      findMany: workspaceExecutorSourceFindManyMock,
    },
    customIntegrationCredential: {
      findMany: vi.fn(),
    },
  },
  insert: insertMock,
  update: updateMock,
};

const startCoworkerGenerationMock = vi.fn();
const FIXED_NOW_MS = Date.parse("2026-02-12T12:00:00.000Z");

vi.mock("@cmdclaw/db/client", () => ({
  db: dbMock,
}));

vi.mock("./generation-manager", () => ({
  generationManager: {
    startCoworkerGeneration: startCoworkerGenerationMock,
  },
}));

vi.mock("../integrations/cli-env", () => ({
  getEnabledIntegrationTypes: getEnabledIntegrationTypesMock,
}));

vi.mock("../integrations/remote-integrations", async () => {
  const actual = await vi.importActual<
    typeof import("../integrations/remote-integrations")
  >("../integrations/remote-integrations");
  return {
    ...actual,
    getRemoteIntegrationCredentials: getRemoteIntegrationCredentialsMock,
  };
});

let triggerCoworkerRun: typeof import("./coworker-service").triggerCoworkerRun;

describe("triggerCoworkerRun", () => {
  beforeAll(async () => {
    ({ triggerCoworkerRun } = await import("./coworker-service"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);

    coworkerFindFirstMock.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      status: "on",
      triggerType: "manual",
      autoApprove: true,
      toolAccessMode: "all",
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: ["custom-crm"],
      allowedExecutorSourceIds: [],
      allowedSkillSlugs: [],
      model: "anthropic/claude-sonnet-4-6",
      prompt: "Do the coworker",
      promptDo: "Do this",
      promptDont: "Do not do that",
    });

    coworkerRunFindManyMock.mockResolvedValue([]);
    coworkerRunFindFirstMock.mockResolvedValue(null);
    workspaceExecutorSourceFindManyMock.mockResolvedValue([]);
    dbMock.query.customIntegrationCredential.findMany.mockResolvedValue([]);
    getEnabledIntegrationTypesMock.mockResolvedValue(["slack"]);
    getRemoteIntegrationCredentialsMock.mockResolvedValue({
      remoteUserId: "remote-user-1",
      remoteUserEmail: "client@example.com",
      remoteUserName: "Client",
      enabledIntegrations: ["google_gmail", "hubspot"],
      tokens: {
        GMAIL_ACCESS_TOKEN: "remote-gmail-token",
        HUBSPOT_ACCESS_TOKEN: "remote-hubspot-token",
      },
    });

    insertValuesMock.mockImplementation((values: unknown) => ({
      returning: vi.fn().mockResolvedValue([
        {
          id: "run-1",
          coworkerId: "wf-1",
          status: "running",
          startedAt: new Date("2026-02-12T12:00:00.000Z"),
          triggerPayload: values,
        },
      ]),
    }));

    updateWhereMock.mockResolvedValue(undefined);

    startCoworkerGenerationMock.mockResolvedValue({
      generationId: "gen-1",
      conversationId: "conv-1",
    });
  });

  it("throws NOT_FOUND when coworker is missing", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);

    await expect(
      triggerCoworkerRun({ coworkerId: "missing", triggerPayload: {} }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("allows manual runs when coworker is turned off", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      triggerType: "manual",
      status: "off",
      autoApprove: true,
      toolAccessMode: "all",
      allowedIntegrations: [],
      allowedCustomIntegrations: [],
      allowedExecutorSourceIds: [],
      allowedSkillSlugs: [],
      model: "anthropic/claude-sonnet-4-6",
      prompt: "",
      promptDo: null,
      promptDont: null,
    });

    await expect(
      triggerCoworkerRun({ coworkerId: "wf-1", triggerPayload: {} }),
    ).resolves.toEqual({
      coworkerId: "wf-1",
      runId: "run-1",
      generationId: "gen-1",
      conversationId: "conv-1",
    });
  });

  it("throws BAD_REQUEST when an automated trigger runs while coworker is turned off", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      triggerType: "schedule",
      status: "off",
      autoApprove: true,
      toolAccessMode: "all",
      allowedIntegrations: [],
      allowedCustomIntegrations: [],
      allowedExecutorSourceIds: [],
      allowedSkillSlugs: [],
      model: "anthropic/claude-sonnet-4-6",
      prompt: "",
      promptDo: null,
      promptDont: null,
    });

    await expect(
      triggerCoworkerRun({
        coworkerId: "wf-1",
        triggerPayload: { source: "schedule" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws BAD_REQUEST when coworker uses disabled Gmail trigger", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      status: "on",
      triggerType: "gmail.new_email",
      autoApprove: true,
      toolAccessMode: "all",
      allowedIntegrations: [],
      allowedCustomIntegrations: [],
      allowedExecutorSourceIds: [],
      allowedSkillSlugs: [],
      model: "anthropic/claude-sonnet-4-6",
      prompt: "",
      promptDo: null,
      promptDont: null,
    });

    await expect(
      triggerCoworkerRun({ coworkerId: "wf-1", triggerPayload: {} }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Coworker trigger type is disabled: gmail.new_email",
    });

    expect(coworkerRunFindFirstMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(startCoworkerGenerationMock).not.toHaveBeenCalled();
  });

  it("blocks non-admin users when an active run exists", async () => {
    coworkerRunFindFirstMock.mockResolvedValue({
      id: "run-active",
      status: "running",
      startedAt: new Date(),
    });

    await expect(
      triggerCoworkerRun({
        coworkerId: "wf-1",
        triggerPayload: { source: "manual" },
        userId: "user-1",
        userRole: "member",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("allows admin users to trigger despite an active run", async () => {
    coworkerRunFindFirstMock.mockResolvedValue({
      id: "run-active",
      status: "running",
      startedAt: new Date(),
    });

    const result = await triggerCoworkerRun({
      coworkerId: "wf-1",
      triggerPayload: { source: "manual" },
      userId: "user-1",
      userRole: "admin",
    });

    expect(result).toEqual({
      coworkerId: "wf-1",
      runId: "run-1",
      generationId: "gen-1",
      conversationId: "conv-1",
    });

    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: "wf-1",
        coworkerRunId: "run-1",
        model: "anthropic/claude-sonnet-4-6",
        userId: "user-1",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-1",
        conversationId: "conv-1",
      }),
    );
  });

  it("uses remote enabled integrations for all-tools manual runs", async () => {
    await triggerCoworkerRun({
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

    expect(getRemoteIntegrationCredentialsMock).toHaveBeenCalledWith({
      targetEnv: "prod",
      remoteUserId: "remote-user-1",
      integrationTypes: ["slack"],
      requestedByUserId: "user-1",
      requestedByEmail: "admin@example.com",
    });

    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedIntegrations: ["google_gmail", "hubspot"],
        remoteIntegrationSource: {
          targetEnv: "prod",
          remoteUserId: "remote-user-1",
          requestedByUserId: "user-1",
          requestedByEmail: "admin@example.com",
          remoteUserEmail: "client@example.com",
        },
      }),
    );
  });

  it("passes forwarded file attachments into the child coworker generation", async () => {
    await triggerCoworkerRun({
      coworkerId: "wf-1",
      triggerPayload: { source: "chat_mention", message: "Transcribe this call" },
      userId: "user-1",
      userRole: "admin",
      fileAttachments: [
        {
          name: "call.m4a",
          mimeType: "audio/mp4",
          dataUrl: "data:audio/mp4;base64,ZmFrZQ==",
        },
      ],
    });

    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileAttachments: [
          {
            name: "call.m4a",
            mimeType: "audio/mp4",
            dataUrl: "data:audio/mp4;base64,ZmFrZQ==",
          },
        ],
      }),
    );
  });

  it("uses the saved coworker model for the run", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      status: "on",
      autoApprove: true,
      allowedIntegrations: ["slack"],
      allowedCustomIntegrations: ["custom-crm"],
      model: "openai/gpt-5.2-codex",
      prompt: "Do the coworker",
      promptDo: "Do this",
      promptDont: "Do not do that",
    });

    await triggerCoworkerRun({
      coworkerId: "wf-1",
      triggerPayload: { source: "manual" },
      userId: "user-1",
      userRole: "admin",
    });

    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5.2-codex",
      }),
    );
  });

  it("marks the run as error and records an error event when generation start fails", async () => {
    startCoworkerGenerationMock.mockRejectedValue(new Error("start failed"));

    await expect(
      triggerCoworkerRun({
        coworkerId: "wf-1",
        triggerPayload: { source: "manual" },
        userId: "user-1",
        userRole: "admin",
      }),
    ).rejects.toThrow("start failed");

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorMessage: "start failed",
      }),
    );

    const errorEventCall = insertValuesMock.mock.calls.find(
      (call) =>
        call[0] &&
        typeof call[0] === "object" &&
        "type" in (call[0] as Record<string, unknown>) &&
        (call[0] as Record<string, unknown>).type === "error",
    );

    expect(errorEventCall?.[0]).toEqual(
      expect.objectContaining({
        coworkerRunId: "run-1",
        type: "error",
        payload: expect.objectContaining({ stage: "start_generation" }),
      }),
    );
  });

  it("reconciles stale orphan and terminal runs before starting a new run", async () => {
    coworkerRunFindManyMock.mockResolvedValue([
      {
        id: "run-orphan",
        status: "running",
        startedAt: new Date(Date.now() - 3 * 60 * 1000),
        finishedAt: null,
        errorMessage: null,
        generation: null,
      },
      {
        id: "run-terminal",
        status: "awaiting_approval",
        startedAt: new Date(Date.now() - 60 * 1000),
        finishedAt: null,
        errorMessage: null,
        generation: {
          id: "gen-terminal",
          conversationId: "conv-terminal",
          status: "completed",
          startedAt: new Date(Date.now() - 120 * 1000),
          completedAt: new Date(Date.now() - 30 * 1000),
          contentParts: [],
          pendingApproval: null,
          pendingAuth: null,
          errorMessage: null,
        },
      },
    ]);

    await triggerCoworkerRun({
      coworkerId: "wf-1",
      triggerPayload: { source: "scheduler" },
      userId: "user-1",
      userRole: "admin",
    });

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorMessage: "Coworker run failed before generation could start.",
      }),
    );

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
      }),
    );
  });
});
