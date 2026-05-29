import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_FORWARDED_TRIGGER_TYPE } from "../../lib/email-forwarding";

const {
  syncCoworkerScheduleJobMock,
  generateCoworkerMetadataOnFirstPromptFillMock,
  logServerEventMock,
} = vi.hoisted(() => ({
  syncCoworkerScheduleJobMock: vi.fn(),
  generateCoworkerMetadataOnFirstPromptFillMock: vi.fn(),
  logServerEventMock: vi.fn(),
}));

vi.mock("./coworker-scheduler", () => ({
  syncCoworkerScheduleJob: syncCoworkerScheduleJobMock,
}));

vi.mock("./coworker-metadata", () => ({
  generateCoworkerMetadataOnFirstPromptFill: generateCoworkerMetadataOnFirstPromptFillMock,
}));

vi.mock("../utils/observability", () => ({
  logServerEvent: logServerEventMock,
  logger: {
    error: (record: Record<string, unknown>) => {
      const { event, source, userId, ...details } = record;
      logServerEventMock("error", event, { userId, ...details }, { source, userId });
    },
  },
}));

import { applyCoworkerEdit, coworkerBuilderEditSchema } from "./coworker-builder-service";

function createDbStub() {
  const findFirst = vi.fn();
  const returning = vi.fn();
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));

  return {
    db: {
      query: {
        coworker: {
          findFirst,
        },
      },
      update,
    },
    mocks: {
      findFirst,
      returning,
      where,
      set,
      update,
    },
  };
}

describe("coworker-builder-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValue({});
  });

  it("returns conflict on stale baseUpdatedAt", async () => {
    const { db, mocks } = createDbStub();
    const oldDate = new Date("2026-03-03T12:00:00.000Z");
    const newDate = new Date("2026-03-03T12:01:00.000Z");

    mocks.findFirst
      .mockResolvedValueOnce({
        id: "wf-1",
        ownerId: "user-1",
        builderConversationId: "conv-1",
        name: "",
        description: null,
        username: null,
        prompt: "old",
        model: "anthropic/claude-sonnet-4-6",
        promptDo: null,
        promptDont: null,
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["github"],
        allowedCustomIntegrations: [],
        autoApprove: true,
        updatedAt: oldDate,
      })
      .mockResolvedValueOnce({
        id: "wf-1",
        prompt: "latest",
        model: "anthropic/claude-sonnet-4-6",
        toolAccessMode: "all",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["github"],
        updatedAt: newDate,
      });
    mocks.returning.mockResolvedValueOnce([]);

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: oldDate.toISOString(),
      changes: { prompt: "new prompt" },
    });

    expect(result.status).toBe("conflict");
    if (result.status !== "conflict") {
      return;
    }
    expect(result.coworker.updatedAt).toBe(newDate.toISOString());
  });

  it("rejects invalid trigger/schedule combinations", async () => {
    const { db, mocks } = createDbStub();
    const updatedAt = new Date("2026-03-03T12:00:00.000Z");
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      autoApprove: true,
      updatedAt,
    });

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: updatedAt.toISOString(),
      changes: { triggerType: "schedule" },
    });

    expect(result.status).toBe("validation_error");
  });

  it("rejects requiring user input without a user input prompt", async () => {
    const { db, mocks } = createDbStub();
    const updatedAt = new Date("2026-03-03T12:00:00.000Z");
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      autoApprove: true,
      requiresUserInput: false,
      userInputPrompt: null,
      updatedAt,
    });

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: updatedAt.toISOString(),
      changes: { requiresUserInput: true, userInputPrompt: "   " },
    });

    expect(result.status).toBe("validation_error");
    if (result.status !== "validation_error") {
      return;
    }
    expect(result.details).toContain("userInputPrompt is required when requiresUserInput is true");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("applies user input settings and reports changed fields", async () => {
    const { db, mocks } = createDbStub();
    const updatedAt = new Date("2026-03-03T12:00:00.000Z");
    const nextUpdatedAt = new Date("2026-03-03T12:01:00.000Z");
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      autoApprove: true,
      requiresUserInput: false,
      userInputPrompt: null,
      updatedAt,
    });
    mocks.returning.mockResolvedValueOnce([
      {
        id: "wf-1",
        prompt: "old",
        model: "anthropic/claude-sonnet-4-6",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["github"],
        requiresUserInput: true,
        userInputPrompt: "Which email address should receive the draft?",
        updatedAt: nextUpdatedAt,
        status: "on",
      },
    ]);
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      toolAccessMode: "all",
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      requiresUserInput: true,
      userInputPrompt: "Which email address should receive the draft?",
      updatedAt: nextUpdatedAt,
      status: "on",
    });

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: updatedAt.toISOString(),
      changes: {
        requiresUserInput: true,
        userInputPrompt: "  Which email address should receive the draft?  ",
      },
    });

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        requiresUserInput: true,
        userInputPrompt: "Which email address should receive the draft?",
      }),
    );
    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.appliedChanges).toEqual(["requiresUserInput", "userInputPrompt"]);
    expect(result.coworker.requiresUserInput).toBe(true);
    expect(result.coworker.userInputPrompt).toBe("Which email address should receive the draft?");
  });

  it("allows clearing integrations for selected tool access", async () => {
    const { db, mocks } = createDbStub();
    const updatedAt = new Date("2026-03-03T12:00:00.000Z");
    const nextUpdatedAt = new Date("2026-03-03T12:01:00.000Z");

    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      autoApprove: true,
      updatedAt,
    });
    mocks.returning.mockResolvedValueOnce([
      {
        id: "wf-1",
        prompt: "old",
        model: "anthropic/claude-sonnet-4-6",
        toolAccessMode: "selected",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: [],
        updatedAt: nextUpdatedAt,
        status: "on",
      },
    ]);
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      toolAccessMode: "selected",
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: [],
      updatedAt: nextUpdatedAt,
      status: "on",
    });

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: updatedAt.toISOString(),
      changes: {
        toolAccessMode: "selected",
        allowedIntegrations: [],
      },
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.coworker.allowedIntegrations).toEqual([]);
  });

  it("rejects new email forwarding trigger edits", () => {
    const result = coworkerBuilderEditSchema.safeParse({
      triggerType: EMAIL_FORWARDED_TRIGGER_TYPE,
    });

    expect(result.success).toBe(false);
  });

  it("rejects new Gmail trigger edits", () => {
    const result = coworkerBuilderEditSchema.safeParse({
      triggerType: "gmail.new_email",
    });

    expect(result.success).toBe(false);
  });

  it("applies prompt changes and reports changed fields", async () => {
    const { db, mocks } = createDbStub();
    const updatedAt = new Date("2026-03-03T12:00:00.000Z");
    const nextUpdatedAt = new Date("2026-03-03T12:01:00.000Z");
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      autoApprove: true,
      updatedAt,
    });
    mocks.returning.mockResolvedValueOnce([
      {
        id: "wf-1",
        prompt: "new prompt",
        model: "anthropic/claude-sonnet-4-6",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["github"],
        updatedAt: nextUpdatedAt,
        status: "on",
      },
    ]);
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      name: "",
      description: null,
      username: null,
      prompt: "new prompt",
      model: "anthropic/claude-sonnet-4-6",
      toolAccessMode: "all",
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      updatedAt: nextUpdatedAt,
      status: "on",
    });

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: updatedAt.toISOString(),
      changes: { prompt: "new prompt" },
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.appliedChanges).toEqual(["prompt"]);
    expect(syncCoworkerScheduleJobMock).not.toHaveBeenCalled();
  });

  it("reports verification failure when the persisted row does not match the edit", async () => {
    const { db, mocks } = createDbStub();
    const updatedAt = new Date("2026-03-03T12:00:00.000Z");
    const nextUpdatedAt = new Date("2026-03-03T12:01:00.000Z");
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      autoApprove: true,
      updatedAt,
    });
    mocks.returning.mockResolvedValueOnce([
      {
        id: "wf-1",
        prompt: "new prompt",
        model: "anthropic/claude-sonnet-4-6",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["github"],
        updatedAt: nextUpdatedAt,
        status: "on",
      },
    ]);
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      toolAccessMode: "all",
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      updatedAt: nextUpdatedAt,
      status: "on",
    });

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: updatedAt.toISOString(),
      changes: { prompt: "new prompt" },
    });

    expect(result.status).toBe("validation_error");
    if (result.status !== "validation_error") {
      return;
    }
    expect(result.message).toBe("Coworker edit verification failed");
    expect(result.details).toEqual(["prompt was not persisted after applying the edit"]);
    expect(logServerEventMock).toHaveBeenCalledWith(
      "error",
      "COWORKER_EDIT_VERIFY_FAILED",
      expect.objectContaining({
        coworkerId: "wf-1",
        changedFields: ["prompt"],
        mismatchedFields: ["prompt"],
      }),
      expect.objectContaining({
        source: "coworker-builder-service",
        userId: "user-1",
      }),
    );
  });

  it("keeps legacy email forwarding coworkers editable", async () => {
    const { db, mocks } = createDbStub();
    const updatedAt = new Date("2026-03-03T12:00:00.000Z");
    const nextUpdatedAt = new Date("2026-03-03T12:01:00.000Z");
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      triggerType: EMAIL_FORWARDED_TRIGGER_TYPE,
      schedule: null,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      autoApprove: true,
      updatedAt,
    });
    mocks.returning.mockResolvedValueOnce([
      {
        id: "wf-1",
        prompt: "new prompt",
        model: "anthropic/claude-sonnet-4-6",
        triggerType: EMAIL_FORWARDED_TRIGGER_TYPE,
        schedule: null,
        allowedIntegrations: ["github"],
        updatedAt: nextUpdatedAt,
        status: "on",
      },
    ]);
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      name: "",
      description: null,
      username: null,
      prompt: "new prompt",
      model: "anthropic/claude-sonnet-4-6",
      toolAccessMode: "all",
      triggerType: EMAIL_FORWARDED_TRIGGER_TYPE,
      schedule: null,
      allowedIntegrations: ["github"],
      updatedAt: nextUpdatedAt,
      status: "on",
    });

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: updatedAt.toISOString(),
      changes: { prompt: "new prompt" },
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.appliedChanges).toEqual(["prompt"]);
  });

  it("keeps legacy Gmail trigger coworkers editable", async () => {
    const { db, mocks } = createDbStub();
    const updatedAt = new Date("2026-03-03T12:00:00.000Z");
    const nextUpdatedAt = new Date("2026-03-03T12:01:00.000Z");
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      triggerType: "gmail.new_email",
      schedule: null,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      autoApprove: true,
      updatedAt,
    });
    mocks.returning.mockResolvedValueOnce([
      {
        id: "wf-1",
        prompt: "new prompt",
        model: "anthropic/claude-sonnet-4-6",
        triggerType: "gmail.new_email",
        schedule: null,
        allowedIntegrations: ["github"],
        updatedAt: nextUpdatedAt,
        status: "on",
      },
    ]);
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      name: "",
      description: null,
      username: null,
      prompt: "new prompt",
      model: "anthropic/claude-sonnet-4-6",
      toolAccessMode: "all",
      triggerType: "gmail.new_email",
      schedule: null,
      allowedIntegrations: ["github"],
      updatedAt: nextUpdatedAt,
      status: "on",
    });

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: updatedAt.toISOString(),
      changes: { prompt: "new prompt" },
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.appliedChanges).toEqual(["prompt"]);
  });

  it("fills missing metadata when builder sets the first prompt", async () => {
    const { db, mocks } = createDbStub();
    const updatedAt = new Date("2026-03-03T12:00:00.000Z");
    const nextUpdatedAt = new Date("2026-03-03T12:01:00.000Z");
    generateCoworkerMetadataOnFirstPromptFillMock.mockResolvedValueOnce({
      name: "Sales Follow Up",
      description: "Follows up with leads after calls.",
      username: "sales-follow-up",
    });
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-1",
      name: "",
      description: null,
      username: null,
      prompt: "   ",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      autoApprove: true,
      updatedAt,
    });
    mocks.returning.mockResolvedValueOnce([
      {
        id: "wf-1",
        prompt: "new prompt",
        model: "anthropic/claude-sonnet-4-6",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["github"],
        updatedAt: nextUpdatedAt,
        status: "on",
      },
    ]);
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      name: "Sales Follow Up",
      description: "Follows up with leads after calls.",
      username: "sales-follow-up",
      prompt: "new prompt",
      model: "anthropic/claude-sonnet-4-6",
      toolAccessMode: "all",
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      updatedAt: nextUpdatedAt,
      status: "on",
    });

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: updatedAt.toISOString(),
      changes: { prompt: "new prompt" },
    });

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "new prompt",
        name: "Sales Follow Up",
        description: "Follows up with leads after calls.",
        username: "sales-follow-up",
      }),
    );
    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.appliedChanges).toEqual(["name", "description", "username", "prompt"]);
  });

  it("applies model changes and reports them", async () => {
    const { db, mocks } = createDbStub();
    const updatedAt = new Date("2026-03-03T12:00:00.000Z");
    const nextUpdatedAt = new Date("2026-03-03T12:01:00.000Z");
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      builderConversationId: "conv-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "anthropic/claude-sonnet-4-6",
      promptDo: null,
      promptDont: null,
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      allowedCustomIntegrations: [],
      autoApprove: true,
      updatedAt,
    });
    mocks.returning.mockResolvedValueOnce([
      {
        id: "wf-1",
        prompt: "old",
        model: "openai/gpt-5.2-codex",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["github"],
        updatedAt: nextUpdatedAt,
        status: "on",
      },
    ]);
    mocks.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      name: "",
      description: null,
      username: null,
      prompt: "old",
      model: "openai/gpt-5.2-codex",
      toolAccessMode: "all",
      triggerType: "manual",
      schedule: null,
      allowedIntegrations: ["github"],
      updatedAt: nextUpdatedAt,
      status: "on",
    });

    const result = await applyCoworkerEdit({
      database: db as never,
      userId: "user-1",
      userRole: "admin",
      coworkerId: "wf-1",
      baseUpdatedAt: updatedAt.toISOString(),
      changes: { model: "openai/gpt-5.2-codex" },
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }
    expect(result.appliedChanges).toEqual(["model"]);
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5.2-codex",
      }),
    );
  });
});
