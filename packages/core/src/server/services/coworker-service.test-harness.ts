import { vi } from "vitest";

process.env.BETTER_AUTH_SECRET = "test-secret";
process.env.DATABASE_URL = "postgres://localhost/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.SANDBOX_DEFAULT = "docker";
process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.APP_SERVER_SECRET = "1".repeat(64);
process.env.AWS_ENDPOINT_URL = "https://s3.example.com";
process.env.AWS_ACCESS_KEY_ID = "test-access-key";
process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";

export const coworkerFindFirstMock = vi.fn();
export const coworkerRunFindManyMock = vi.fn();
export const coworkerRunFindFirstMock = vi.fn();
export const workspaceMcpServerFindManyMock = vi.fn();
export const workspaceMemberFindFirstMock = vi.fn();
export const getEnabledIntegrationTypesMock = vi.fn();
export const getRemoteIntegrationCredentialsMock = vi.fn();
export const emitPreGenerationCoworkerRunFailureSloEventMock = vi.fn();
export const getPendingInterruptForGenerationMock = vi.fn();
export const cancelInterruptsForGenerationMock = vi.fn();
export const removeCoworkerScheduleJobMock = vi.fn();

export const insertValuesMock = vi.fn();
export const insertMock = vi.fn(() => ({ values: insertValuesMock }));
export const updateWhereMock = vi.fn();
export const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
export const updateMock = vi.fn(() => ({ set: updateSetMock }));

export const dbMock = {
  query: {
    coworker: { findFirst: coworkerFindFirstMock },
    coworkerRun: {
      findMany: coworkerRunFindManyMock,
      findFirst: coworkerRunFindFirstMock,
    },
    workspaceMcpServer: { findMany: workspaceMcpServerFindManyMock },
    customIntegrationCredential: { findMany: vi.fn() },
    workspaceMember: { findFirst: workspaceMemberFindFirstMock },
  },
  insert: insertMock,
  update: updateMock,
};

export const startCoworkerGenerationMock = vi.fn();
const FIXED_NOW_MS = Date.parse("2026-02-12T12:00:00.000Z");

vi.mock("@bap/db/client", () => ({ db: dbMock }));
vi.mock("./generation-manager", () => ({
  generationManager: { startCoworkerGeneration: startCoworkerGenerationMock },
}));
vi.mock("./generation-interrupt-service", () => ({
  generationInterruptService: {
    getPendingInterruptForGeneration: getPendingInterruptForGenerationMock,
    cancelInterruptsForGeneration: cancelInterruptsForGenerationMock,
  },
}));
vi.mock("./coworker-scheduler", () => ({
  removeCoworkerScheduleJob: removeCoworkerScheduleJobMock,
}));
vi.mock("../integrations/cli-env", () => ({
  getEnabledIntegrationTypes: getEnabledIntegrationTypesMock,
}));
vi.mock("../integrations/remote-integrations", async () => {
  const actual = await vi.importActual<typeof import("../integrations/remote-integrations")>(
    "../integrations/remote-integrations",
  );
  return {
    ...actual,
    getRemoteIntegrationCredentials: getRemoteIntegrationCredentialsMock,
  };
});
vi.mock("./slo-journey", () => ({
  emitPreGenerationCoworkerRunFailureSloEvent: emitPreGenerationCoworkerRunFailureSloEventMock,
}));

export function resetCoworkerServiceTestHarness(): void {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
  coworkerFindFirstMock.mockResolvedValue({
    id: "wf-1",
    ownerId: "user-1",
    createdByUserId: "user-1",
    visibility: "private",
    automationOwnerUserId: "user-1",
    automationOwnerConsentedAt: new Date("2026-02-01T00:00:00.000Z"),
    workspaceId: "ws-1",
    status: "on",
    triggerType: "manual",
    autoApprove: true,
    toolAccessMode: "all",
    allowedIntegrations: ["slack"],
    allowedCustomIntegrations: ["custom-crm"],
    allowedWorkspaceMcpServerIds: [],
    allowedSkillSlugs: [],
    model: "anthropic/claude-sonnet-4-6",
    prompt: "Do the coworker",
    requiresUserInput: false,
    userInputPrompt: null,
  });
  workspaceMemberFindFirstMock.mockResolvedValue({ role: "member" });
  coworkerRunFindManyMock.mockResolvedValue([]);
  coworkerRunFindFirstMock.mockResolvedValue(null);
  workspaceMcpServerFindManyMock.mockResolvedValue([]);
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
  getPendingInterruptForGenerationMock.mockResolvedValue(null);
  cancelInterruptsForGenerationMock.mockResolvedValue(undefined);
  removeCoworkerScheduleJobMock.mockResolvedValue(undefined);

  let insertedUserMessageCount = 0;
  insertValuesMock.mockImplementation((values: unknown) => {
    const record = values as Record<string, unknown>;
    if (record.type === "coworker" && "title" in record) {
      return {
        returning: vi.fn().mockResolvedValue([{ id: "conv-pending", ...record }]),
      };
    }
    if ("role" in record && "conversationId" in record) {
      insertedUserMessageCount += 1;
      return {
        returning: vi
          .fn()
          .mockResolvedValue([{ id: `msg-user-${insertedUserMessageCount}`, ...record }]),
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
}
