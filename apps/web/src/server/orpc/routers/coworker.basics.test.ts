import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  coworkerRouterAny,
  createContext,
  reconcileStaleCoworkerRunsForCoworkerMock,
  reconcileStaleCoworkerRunsForCoworkersMock,
  resetCoworkerRouterTestHarness,
  syncCoworkerScheduleJobMock,
} from "./coworker.test-harness";

describe("coworkerRouter", () => {
  beforeEach(resetCoworkerRouterTestHarness);
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
});
