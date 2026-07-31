import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  coworkerRouterAny,
  createContext,
  resetCoworkerRouterTestHarness,
} from "./coworker.test-harness";

describe("coworker schedule registration", () => {
  beforeEach(resetCoworkerRouterTestHarness);

  it("automatically registers a member who edits a schedule", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({
      role: "member",
      name: "Member One",
      image: "member-one.png",
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-scheduled",
      ownerId: "user-2",
      createdByUserId: "user-2",
      workspaceId: "ws-1",
      visibility: "workspace",
      sharedAt: new Date("2026-07-15T12:00:00.000Z"),
      configurationRevision: 2,
      name: "Scheduled Coworker",
      description: null,
      username: "scheduled-coworker",
      status: "on",
      triggerType: "schedule",
      prompt: "Run the report",
      model: DEFAULT_MODEL,
      authSource: null,
      autoApprove: true,
      toolAccessMode: "all",
      allowedIntegrations: [],
      allowedCustomIntegrations: [],
      allowedWorkspaceMcpServerIds: [],
      allowedSkillSlugs: [],
      requiresUserInput: false,
      userInputPrompt: null,
      schedule: { type: "daily", time: "09:00", timezone: "UTC" },
      folderId: null,
    });
    context.mocks.updateReturningMock.mockResolvedValue([{ id: "wf-scheduled" }]);
    context.mocks.insertOnConflictReturningMock.mockResolvedValue([{ id: "registration-1" }]);

    const result = await coworkerRouterAny.update({
      input: {
        id: "wf-scheduled",
        schedule: { type: "daily", time: "10:00", timezone: "UTC" },
        expectedRevision: 2,
      },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: "wf-scheduled",
        workspaceId: "ws-1",
        userId: "user-1",
        status: "active",
      }),
    );
    expect(context.mocks.insertOnConflictDoUpdateMock).toHaveBeenCalled();
  });
});
