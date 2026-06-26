import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

var getWorkspaceMembershipForUserMock: ReturnType<typeof vi.fn>;
var syncCoworkerScheduleJobMock: ReturnType<typeof vi.fn>;

vi.mock("@bap/core/server/billing/service", () => ({
  getWorkspaceMembershipForUser: (() => {
    getWorkspaceMembershipForUserMock = vi.fn<VitestProcedure>();
    return getWorkspaceMembershipForUserMock;
  })(),
}));

vi.mock("@bap/core/server/services/coworker-scheduler", () => ({
  syncCoworkerScheduleJob: (() => {
    syncCoworkerScheduleJobMock = vi.fn<VitestProcedure>();
    return syncCoworkerScheduleJobMock;
  })(),
}));

import { moveCoworkerToWorkspace } from "./coworker-workspace-move";

type MoveContext = Parameters<typeof moveCoworkerToWorkspace>[0]["context"];

function createContext() {
  const returningMock = vi.fn<VitestProcedure>().mockResolvedValue([
    {
      id: "cw-1",
      workspaceId: "ws-2",
      triggerType: "manual",
    },
  ]);

  const whereMock = vi.fn<VitestProcedure>().mockReturnValue({
    returning: returningMock,
  });

  const setMock = vi.fn<VitestProcedure>().mockReturnValue({
    where: whereMock,
  });

  const updateMock = vi.fn<VitestProcedure>().mockReturnValue({
    set: setMock,
  });

  return {
    user: { id: "user-1" },
    hostedMcp: {
      token: "token-1",
      userId: "user-1",
      workspaceId: "ws-1",
      audience: "bap" as const,
      resource: "http://127.0.0.1:3010/bap",
      allowedWorkspaceIds: ["ws-1", "ws-2"],
      allowAllWorkspaces: false,
      scopes: ["bap"],
      clientId: "client-1",
      grantId: "grant-1",
      expiresAt: 2_000_000_000,
      issuedAt: 1_999_999_000,
    },
    db: {
      query: {
        coworker: {
          findFirst: vi.fn<VitestProcedure>().mockResolvedValue({
            id: "cw-1",
            ownerId: "user-1",
            workspaceId: "ws-1",
            triggerType: "manual",
          }),
        },
        workspace: {
          findFirst: vi.fn<VitestProcedure>().mockResolvedValue({
            id: "ws-2",
          }),
        },
      },
      update: updateMock,
    } as unknown as MoveContext["db"],
    mocks: {
      updateMock,
      setMock,
      whereMock,
      returningMock,
    },
  } as unknown as MoveContext & {
    mocks: {
      updateMock: typeof updateMock;
      setMock: typeof setMock;
      whereMock: typeof whereMock;
      returningMock: typeof returningMock;
    };
  };
}

describe("moveCoworkerToWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves a coworker when both source and target workspaces are authorized", async () => {
    const context = createContext();
    getWorkspaceMembershipForUserMock.mockResolvedValue({ role: "admin" });
    syncCoworkerScheduleJobMock.mockResolvedValue(undefined);

    const result = await moveCoworkerToWorkspace({
      context,
      coworkerId: "cw-1",
      targetWorkspaceId: "ws-2",
    });

    expect(getWorkspaceMembershipForUserMock).toHaveBeenCalledWith("user-1", "ws-1");
    expect(getWorkspaceMembershipForUserMock).toHaveBeenCalledWith("user-1", "ws-2");
    expect(result).toEqual({
      id: "cw-1",
      workspaceId: "ws-2",
      sourceWorkspaceId: "ws-1",
      targetWorkspaceId: "ws-2",
      triggerType: "manual",
    });
  });

  it("blocks moves to a workspace outside the hosted MCP scope", async () => {
    const context = createContext();

    await expect(
      moveCoworkerToWorkspace({
        context,
        coworkerId: "cw-1",
        targetWorkspaceId: "ws-3",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This MCP authorization does not cover the target workspace.",
    });

    expect(getWorkspaceMembershipForUserMock).not.toHaveBeenCalled();
    expect(context.mocks.updateMock).not.toHaveBeenCalled();
  });
});
