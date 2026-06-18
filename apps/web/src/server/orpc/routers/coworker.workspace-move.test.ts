import { beforeEach, describe, expect, it } from "vitest";
import {
  coworkerRouterAny,
  createContext,
  getWorkspaceMembershipForUserMock,
  resetCoworkerRouterTestHarness,
  syncCoworkerScheduleJobMock,
} from "./coworker.test-harness";

describe("coworkerRouter.moveWorkspace", () => {
  beforeEach(resetCoworkerRouterTestHarness);

  it("moves an owned coworker to another member workspace and resets workspace-scoped state", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      triggerType: "manual",
    });
    context.mocks.updateReturningMock.mockResolvedValueOnce([
      {
        id: "wf-1",
        ownerId: "user-1",
        workspaceId: "ws-2",
        triggerType: "manual",
      },
    ]);

    const result = await coworkerRouterAny.moveWorkspace({
      input: { coworkerId: "wf-1", targetWorkspaceId: "ws-2" },
      context,
    });

    expect(getWorkspaceMembershipForUserMock).toHaveBeenCalledWith("user-1", "ws-1");
    expect(getWorkspaceMembershipForUserMock).toHaveBeenCalledWith("user-1", "ws-2");
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith({
      workspaceId: "ws-2",
      folderId: null,
      sharedAt: null,
      allowedWorkspaceMcpServerIds: [],
      builderConversationId: null,
    });
    expect(result).toEqual({
      id: "wf-1",
      workspaceId: "ws-2",
      sourceWorkspaceId: "ws-1",
      targetWorkspaceId: "ws-2",
      triggerType: "manual",
    });
    expect(syncCoworkerScheduleJobMock).not.toHaveBeenCalled();
  });

  it("rejects non-owners without moving the coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-2",
      workspaceId: "ws-1",
      triggerType: "manual",
    });

    await expect(
      coworkerRouterAny.moveWorkspace({
        input: { coworkerId: "wf-1", targetWorkspaceId: "ws-2" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(context.mocks.transactionMock).not.toHaveBeenCalled();
  });

  it("rejects moving to the same workspace", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      triggerType: "manual",
    });

    await expect(
      coworkerRouterAny.moveWorkspace({
        input: { coworkerId: "wf-1", targetWorkspaceId: "ws-1" },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(context.mocks.transactionMock).not.toHaveBeenCalled();
  });

  it("rejects target workspaces the owner cannot access", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      triggerType: "manual",
    });
    getWorkspaceMembershipForUserMock
      .mockResolvedValueOnce({ id: "source-membership", role: "owner" })
      .mockResolvedValueOnce(null);

    await expect(
      coworkerRouterAny.moveWorkspace({
        input: { coworkerId: "wf-1", targetWorkspaceId: "ws-2" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(context.mocks.transactionMock).not.toHaveBeenCalled();
  });

  it("refreshes the scheduled job after moving a scheduled coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValueOnce({
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-1",
      triggerType: "schedule",
    });
    const movedCoworker = {
      id: "wf-1",
      ownerId: "user-1",
      workspaceId: "ws-2",
      triggerType: "schedule",
      status: "on",
      schedule: { type: "daily", time: "09:00" },
    };
    context.mocks.updateReturningMock.mockResolvedValueOnce([movedCoworker]);

    await coworkerRouterAny.moveWorkspace({
      input: { coworkerId: "wf-1", targetWorkspaceId: "ws-2" },
      context,
    });

    expect(syncCoworkerScheduleJobMock).toHaveBeenCalledWith(movedCoworker);
  });
});
