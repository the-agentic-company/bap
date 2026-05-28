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
const emitPreGenerationCoworkerRunFailureSloEventMock = vi.fn();

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

vi.mock("./slo-journey", () => ({
  emitPreGenerationCoworkerRunFailureSloEvent: emitPreGenerationCoworkerRunFailureSloEventMock,
}));

let triggerCoworkerRun: typeof import("./coworker-service").triggerCoworkerRun;
let startPendingCoworkerRun: typeof import("./coworker-service").startPendingCoworkerRun;

describe("triggerCoworkerRun", () => {
  beforeAll(async () => {
    ({ triggerCoworkerRun, startPendingCoworkerRun } = await import("./coworker-service"));
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
      requiresUserInput: false,
      userInputPrompt: null,
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
    emitPreGenerationCoworkerRunFailureSloEventMock.mockResolvedValue(true);

    let insertedUserMessageCount = 0;
    insertValuesMock.mockImplementation((values: unknown) => {
      const record = values as Record<string, unknown>;
      if (record.type === "coworker" && "title" in record) {
        return {
          returning: vi.fn().mockResolvedValue([
            {
              id: "conv-pending",
              ...record,
            },
          ]),
        };
      }
      if ("role" in record && "conversationId" in record) {
        insertedUserMessageCount += 1;
        return {
          returning: vi.fn().mockResolvedValue([
            { id: `msg-user-${insertedUserMessageCount}`, ...record },
          ]),
        };
      }
      if ("coworkerId" in record && "status" in record) {
        return {
          returning: vi.fn().mockResolvedValue([
            {
              id: record.status === "needs_user_input" ? "run-pending" : "run-1",
              coworkerId: "wf-1",
              startedAt: new Date("2026-02-12T12:00:00.000Z"),
              ...record,
            },
          ]),
        };
      }

      return {
        returning: vi.fn().mockResolvedValue([{ id: "inserted-1", ...record }]),
      };
    });

    updateWhereMock.mockImplementation(() => ({
      returning: vi.fn().mockResolvedValue([
        {
          id: "run-pending",
          coworkerId: "wf-1",
          ownerId: "user-1",
          workspaceId: "ws-1",
          status: "running",
          startedAt: new Date("2026-02-12T12:00:00.000Z"),
        },
      ]),
    }));

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

  it("includes saved coworker instructions in the generation user prompt", async () => {
    await triggerCoworkerRun({
      coworkerId: "wf-1",
      triggerPayload: { source: "manual", reason: "live click" },
      userId: "user-1",
      userRole: "admin",
    });

    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("## Coworker Instructions\nDo the coworker"),
      }),
    );
    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("## Do\nDo this"),
      }),
    );
    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("## Don't\nDo not do that"),
      }),
    );
    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('"reason": "live click"'),
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

  it("creates a Pending Start when a coworker requires user input and no trusted input is supplied", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      status: "on",
      triggerType: "schedule",
      autoApprove: true,
      toolAccessMode: "all",
      allowedIntegrations: [],
      allowedCustomIntegrations: [],
      allowedExecutorSourceIds: [],
      allowedSkillSlugs: [],
      model: "anthropic/claude-sonnet-4-6",
      prompt: "Draft an email",
      promptDo: null,
      promptDont: null,
      requiresUserInput: true,
      userInputPrompt: "Which recipient should receive the draft?",
    });

    const result = await triggerCoworkerRun({
      coworkerId: "wf-1",
      triggerPayload: {
        source: "schedule",
        scheduledFor: "2026-02-12T12:00:00.000Z",
        userInput: "external value must not be trusted",
      },
      userId: "user-1",
    });

    expect(result).toEqual({
      coworkerId: "wf-1",
      runId: "run-pending",
      generationId: null,
      conversationId: "conv-pending",
    });
    expect(startCoworkerGenerationMock).not.toHaveBeenCalled();

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Which recipient should receive the draft?",
        type: "coworker",
      }),
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "needs_user_input",
        triggerPayload: expect.objectContaining({
          source: "schedule",
          userInputPrompt: "Which recipient should receive the draft?",
          trigger: expect.objectContaining({
            userInput: "external value must not be trusted",
          }),
        }),
      }),
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "Which recipient should receive the draft?",
      }),
    );

    const pendingRunCall = insertValuesMock.mock.calls.find(
      (call) => (call[0] as { status?: string }).status === "needs_user_input",
    );
    expect(
      ((pendingRunCall?.[0] as { triggerPayload?: Record<string, unknown> }).triggerPayload ?? {})
        .userInput,
    ).toBeUndefined();
  });

  it("starts immediately with trusted user input and stores it separately from the raw trigger", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      status: "on",
      triggerType: "manual",
      autoApprove: true,
      toolAccessMode: "all",
      allowedIntegrations: [],
      allowedCustomIntegrations: [],
      allowedExecutorSourceIds: [],
      allowedSkillSlugs: [],
      model: "anthropic/claude-sonnet-4-6",
      prompt: "Draft an email",
      promptDo: null,
      promptDont: null,
      requiresUserInput: true,
      userInputPrompt: "Which recipient should receive the draft?",
    });

    await triggerCoworkerRun({
      coworkerId: "wf-1",
      triggerPayload: {
        source: "manual_inbox",
        userInput: "raw payload value",
      },
      trustedUserInput: "alice@example.com",
      userId: "user-1",
    });

    const runCall = insertValuesMock.mock.calls.find(
      (call) => (call[0] as { status?: string }).status === "running",
    );
    expect(runCall?.[0]).toEqual(
      expect.objectContaining({
        triggerPayload: expect.objectContaining({
          source: "manual_inbox",
          trigger: expect.objectContaining({
            userInput: "raw payload value",
          }),
          userInputPrompt: "Which recipient should receive the draft?",
          userInput: "alice@example.com",
        }),
      }),
    );
    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("## Coworker Instructions\nDraft an email"),
      }),
    );
    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("## User Input\nalice@example.com"),
      }),
    );
  });

  it("starts a pending run from a file-only reply and preserves trigger plus reply attachments", async () => {
    coworkerRunFindFirstMock.mockResolvedValue({
      id: "run-pending",
      coworkerId: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      status: "needs_user_input",
      conversationId: "conv-pending",
      triggerPayload: {
        source: "email_forwarded",
        trigger: { source: "email_forwarded", subject: "Review this PDF" },
        userInputPrompt: "What should I do with the file?",
        triggerFileAttachments: [
          {
            name: "forwarded.pdf",
            mimeType: "application/pdf",
            dataUrl: "data:application/pdf;base64,Zm9yd2FyZGVk",
          },
        ],
      },
      coworker: {
        id: "wf-1",
        ownerId: "user-1",
        workspaceId: "ws-1",
        status: "off",
        triggerType: "email_forwarded",
        autoApprove: true,
        toolAccessMode: "all",
        allowedIntegrations: [],
        allowedCustomIntegrations: [],
        allowedExecutorSourceIds: [],
        allowedSkillSlugs: [],
        model: "anthropic/claude-sonnet-4-6",
        prompt: "Review files",
        promptDo: null,
        promptDont: null,
        requiresUserInput: true,
        userInputPrompt: "What should I do with the file?",
      },
    });

    const result = await startPendingCoworkerRun({
      conversationId: "conv-pending",
      userId: "user-1",
      userInput: "",
      fileAttachments: [
        {
          name: "answer.txt",
          mimeType: "text/plain",
          dataUrl: "data:text/plain;base64,YW5zd2Vy",
        },
      ],
    });

    expect(result).toEqual({
      coworkerId: "wf-1",
      runId: "run-pending",
      generationId: "gen-1",
      conversationId: "conv-1",
    });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        triggerPayload: expect.objectContaining({
          trigger: { source: "email_forwarded", subject: "Review this PDF" },
          userInputPrompt: "What should I do with the file?",
        }),
      }),
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-pending",
        role: "user",
        content: "",
      }),
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-pending",
        role: "user",
        content: expect.stringContaining("## Coworker Instructions\nReview files"),
      }),
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('"userInputPrompt": "What should I do with the file?"'),
      }),
    );
    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-pending",
        existingUserMessageId: "msg-user-2",
        content: expect.stringContaining("## Coworker Instructions\nReview files"),
        fileAttachments: [
          {
            name: "forwarded.pdf",
            mimeType: "application/pdf",
            dataUrl: "data:application/pdf;base64,Zm9yd2FyZGVk",
          },
          {
            name: "answer.txt",
            mimeType: "text/plain",
            dataUrl: "data:text/plain;base64,YW5zd2Vy",
          },
        ],
      }),
    );
  });

  it("rejects a pending start reply when another reply has already claimed the run", async () => {
    coworkerRunFindFirstMock.mockResolvedValue({
      id: "run-pending",
      coworkerId: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      status: "needs_user_input",
      conversationId: "conv-pending",
      triggerPayload: {
        source: "schedule",
        trigger: { source: "schedule" },
        userInputPrompt: "Which recipient?",
      },
      coworker: {
        id: "wf-1",
        ownerId: "user-1",
        workspaceId: "ws-1",
        status: "on",
        triggerType: "schedule",
        autoApprove: true,
        toolAccessMode: "all",
        allowedIntegrations: [],
        allowedCustomIntegrations: [],
        allowedExecutorSourceIds: [],
        allowedSkillSlugs: [],
        model: "anthropic/claude-sonnet-4-6",
        prompt: "Draft an email",
        promptDo: null,
        promptDont: null,
        requiresUserInput: true,
        userInputPrompt: "Which recipient?",
      },
    });
    updateWhereMock.mockReturnValueOnce({
      returning: vi.fn().mockResolvedValue([]),
    });

    await expect(
      startPendingCoworkerRun({
        conversationId: "conv-pending",
        userId: "user-1",
        userInput: "alice@example.com",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This coworker has already started.",
    });

    expect(startCoworkerGenerationMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
      }),
    );
  });

  it("sanitizes NUL bytes from coworker trigger payloads before DB writes and generation prompts", async () => {
    await triggerCoworkerRun({
      coworkerId: "wf-1",
      triggerPayload: { source: "manual", message: "before\u0000after" },
      userId: "user-1",
      userRole: "admin",
    });

    const triggerEventCall = insertValuesMock.mock.calls.find(
      (call) =>
        call[0] &&
        typeof call[0] === "object" &&
        "type" in (call[0] as Record<string, unknown>) &&
        (call[0] as Record<string, unknown>).type === "trigger",
    );

    expect(JSON.stringify(triggerEventCall?.[0])).not.toContain("\\u0000");
    expect(JSON.stringify(triggerEventCall?.[0])).toContain("before�after");
    expect(startCoworkerGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("before�after"),
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
    expect(emitPreGenerationCoworkerRunFailureSloEventMock).toHaveBeenCalledWith({
      coworkerRunId: "run-1",
      coworkerId: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      syntheticKind: undefined,
      normalizedErrorCode: "start_generation_failed",
    });
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
