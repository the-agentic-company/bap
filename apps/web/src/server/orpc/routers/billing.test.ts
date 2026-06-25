import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

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

var attachPlanToOwnerMock: ReturnType<typeof vi.fn>;
var createManualTopUpMock: ReturnType<typeof vi.fn>;
var createWorkspaceForUserMock: ReturnType<typeof vi.fn>;
var ensureWorkspaceForUserMock: ReturnType<typeof vi.fn>;
var getAdminBillingOverviewForUserMock: ReturnType<typeof vi.fn>;
var getBillingOverviewForUserMock: ReturnType<typeof vi.fn>;
var getExistingBillingOwnerForUserMock: ReturnType<typeof vi.fn>;
var getWorkspaceMembershipForUserMock: ReturnType<typeof vi.fn>;
var openBillingPortalForOwnerMock: ReturnType<typeof vi.fn>;
var cancelPlanForOwnerMock: ReturnType<typeof vi.fn>;
var removeWorkspaceImageMock: ReturnType<typeof vi.fn>;
var setActiveWorkspaceMock: ReturnType<typeof vi.fn>;
var updateWorkspaceImageMock: ReturnType<typeof vi.fn>;

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("@bap/core/server/billing/service", () => ({
  addWorkspaceMembers: vi.fn<VitestProcedure>(),
  attachPlanToOwner: (() => {
    attachPlanToOwnerMock = vi.fn<VitestProcedure>();
    return attachPlanToOwnerMock;
  })(),
  cancelPlanForOwner: (() => {
    cancelPlanForOwnerMock = vi.fn<VitestProcedure>();
    return cancelPlanForOwnerMock;
  })(),
  createManualTopUp: (() => {
    createManualTopUpMock = vi.fn<VitestProcedure>();
    return createManualTopUpMock;
  })(),
  createWorkspaceForUser: (() => {
    createWorkspaceForUserMock = vi.fn<VitestProcedure>();
    return createWorkspaceForUserMock;
  })(),
  getAdminBillingOverviewForUser: (() => {
    getAdminBillingOverviewForUserMock = vi.fn<VitestProcedure>();
    return getAdminBillingOverviewForUserMock;
  })(),
  ensureWorkspaceForUser: (() => {
    ensureWorkspaceForUserMock = vi.fn<VitestProcedure>();
    return ensureWorkspaceForUserMock;
  })(),
  getBillingOverviewForUser: (() => {
    getBillingOverviewForUserMock = vi.fn<VitestProcedure>();
    return getBillingOverviewForUserMock;
  })(),
  getExistingBillingOwnerForUser: (() => {
    getExistingBillingOwnerForUserMock = vi.fn<VitestProcedure>();
    return getExistingBillingOwnerForUserMock;
  })(),
  getWorkspaceMembershipForUser: (() => {
    getWorkspaceMembershipForUserMock = vi.fn<VitestProcedure>();
    return getWorkspaceMembershipForUserMock;
  })(),
  openBillingPortalForOwner: (() => {
    openBillingPortalForOwnerMock = vi.fn<VitestProcedure>();
    return openBillingPortalForOwnerMock;
  })(),
  setActiveWorkspace: (() => {
    setActiveWorkspaceMock = vi.fn<VitestProcedure>();
    return setActiveWorkspaceMock;
  })(),
}));

vi.mock("@bap/core/server/billing/workspace-image", () => ({
  removeWorkspaceImage: (() => {
    removeWorkspaceImageMock = vi.fn<VitestProcedure>();
    return removeWorkspaceImageMock;
  })(),
  updateWorkspaceImage: (() => {
    updateWorkspaceImageMock = vi.fn<VitestProcedure>();
    return updateWorkspaceImageMock;
  })(),
}));

import { billingRouter } from "./billing";

const billingRouterAny = billingRouter as unknown as Record<
  string,
  (args: unknown) => Promise<unknown>
>;

function createContext(role = "admin") {
  return {
    user: {
      id: "user-1",
      email: "user@example.com",
      name: "Test User",
    },
    db: {
      query: {
        user: {
          findFirst: vi.fn<VitestProcedure>().mockResolvedValue({
            role,
            activeWorkspaceId: "ws-1",
          }),
        },
        workspace: {
          findFirst: vi.fn<VitestProcedure>().mockResolvedValue({
            id: "ws-1",
            autumnCustomerId: "cus-ws-1",
            billingPlanId: "free",
          }),
        },
      },
    },
  };
}

describe("billingRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureWorkspaceForUserMock.mockResolvedValue({
      id: "ws-1",
      name: "Alpha",
      billingPlanId: "free",
      autumnCustomerId: null,
    });
    getWorkspaceMembershipForUserMock.mockResolvedValue({
      role: "owner",
      workspaceId: "ws-1",
      userId: "user-1",
    });
    attachPlanToOwnerMock.mockResolvedValue({
      checkout_url: "https://checkout.example.com",
      customer_id: "cus-ws-1",
    });
    openBillingPortalForOwnerMock.mockResolvedValue({
      url: "https://portal.example.com",
    });
    createManualTopUpMock.mockResolvedValue({
      id: "topup-1",
      creditsGranted: 2500,
      expiresAt: new Date("2027-03-09T00:00:00.000Z"),
    });
    cancelPlanForOwnerMock.mockResolvedValue({ success: true });
    updateWorkspaceImageMock.mockResolvedValue({
      id: "ws-1",
      imageUrl: "/api/workspaces/ws-1/image?v=1",
    });
    removeWorkspaceImageMock.mockResolvedValue({
      id: "ws-1",
      imageUrl: null,
    });
    getBillingOverviewForUserMock.mockResolvedValue({
      owner: { ownerType: "workspace", ownerId: "ws-1", planId: "free" },
      plan: { id: "free" },
      workspaces: [],
    });
    getAdminBillingOverviewForUserMock.mockResolvedValue({
      targetUser: {
        id: "user-2",
        name: "Target User",
        email: "target@example.com",
      },
      activeWorkspace: {
        id: "ws-target",
        name: "Target Workspace",
        slug: "target-workspace",
      },
      plan: { id: "pro", name: "Pro" },
      feature: { balance: 900 },
      recentTopUps: [],
    });
    getExistingBillingOwnerForUserMock.mockResolvedValue({
      targetUser: {
        id: "user-2",
        name: "Target User",
        email: "target@example.com",
      },
      activeWorkspace: {
        id: "ws-target",
        name: "Target Workspace",
        slug: "target-workspace",
      },
      owner: {
        ownerType: "workspace",
        ownerId: "ws-target",
        autumnCustomerId: "cus-target",
        planId: "pro",
      },
    });
    createWorkspaceForUserMock.mockResolvedValue({
      id: "ws-created",
      name: "Created Workspace",
      billingPlanId: "free",
    });
    setActiveWorkspaceMock.mockResolvedValue(undefined);
  });

  it("filters billing overview to the selected hosted MCP workspaces", async () => {
    getBillingOverviewForUserMock.mockResolvedValueOnce({
      owner: { ownerType: "workspace", ownerId: "ws-2", planId: "free" },
      plan: { id: "free" },
      workspaces: [
        { id: "ws-1", name: "One", active: false },
        { id: "ws-2", name: "Two", active: true },
        { id: "ws-3", name: "Three", active: false },
      ],
    });

    const result = (await billingRouterAny.overview({
      context: {
        ...createContext(),
        workspaceId: "ws-3",
        hostedMcp: {
          audience: "bap",
          resource: "http://127.0.0.1:3010/bap",
          allowedWorkspaceIds: ["ws-1", "ws-3"],
          allowAllWorkspaces: false,
        },
      },
    })) as {
      owner: { ownerId: string };
      workspaces: Array<{ id: string; active: boolean }>;
    };

    expect(result.owner.ownerId).toBe("ws-3");
    expect(result.workspaces).toEqual([
      { id: "ws-1", name: "One", active: false },
      { id: "ws-3", name: "Three", active: true },
    ]);
  });

  it("blocks workspace creation when hosted MCP is limited to selected workspaces", async () => {
    await expect(
      billingRouterAny.createWorkspace({
        input: { name: "Created Workspace" },
        context: {
          ...createContext(),
          hostedMcp: {
            audience: "bap",
            resource: "http://127.0.0.1:3010/bap",
            allowedWorkspaceIds: ["ws-1"],
            allowAllWorkspaces: false,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This action requires MCP authorization for all workspaces.",
    });

    expect(createWorkspaceForUserMock).not.toHaveBeenCalled();
  });

  it("switches workspace when the hosted MCP authorization covers it", async () => {
    const result = (await billingRouterAny.switchWorkspace({
      input: { workspaceId: "ws-2" },
      context: {
        ...createContext(),
        hostedMcp: {
          audience: "bap",
          resource: "http://127.0.0.1:3010/bap",
          allowedWorkspaceIds: ["ws-1", "ws-2"],
          allowAllWorkspaces: false,
        },
      },
    })) as { success: boolean };

    expect(setActiveWorkspaceMock).toHaveBeenCalledWith("user-1", "ws-2");
    expect(result).toEqual({ success: true });
  });

  it("blocks workspace switching outside the selected hosted MCP scope", async () => {
    await expect(
      billingRouterAny.switchWorkspace({
        input: { workspaceId: "ws-3" },
        context: {
          ...createContext(),
          hostedMcp: {
            audience: "bap",
            resource: "http://127.0.0.1:3010/bap",
            allowedWorkspaceIds: ["ws-1", "ws-2"],
            allowAllWorkspaces: false,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This MCP authorization does not cover the requested workspace.",
    });

    expect(setActiveWorkspaceMock).not.toHaveBeenCalled();
  });

  it("normalizes personal ownerType input to workspace billing", async () => {
    const result = (await billingRouterAny.attachPlan({
      input: {
        ownerType: "user",
        planId: "pro",
      },
      context: createContext(),
    })) as { checkoutUrl: string | null; customerId: string; planId: string };

    expect(ensureWorkspaceForUserMock).toHaveBeenCalledWith("user-1", "ws-1");
    expect(attachPlanToOwnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({
          ownerType: "workspace",
          ownerId: "ws-1",
        }),
        planId: "pro",
      }),
    );
    expect(result.planId).toBe("pro");
  });

  it("attaches workspace plans using the ensured workspace owner", async () => {
    const result = (await billingRouterAny.attachPlan({
      input: {
        ownerType: "workspace",
        planId: "pro",
      },
      context: createContext(),
    })) as { checkoutUrl: string | null; customerId: string; planId: string };

    expect(ensureWorkspaceForUserMock).toHaveBeenCalledWith("user-1", "ws-1");
    expect(attachPlanToOwnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({
          ownerType: "workspace",
          ownerId: "ws-1",
        }),
        planId: "pro",
      }),
    );
    expect(result).toEqual({
      checkoutUrl: "https://checkout.example.com",
      customerId: "cus-ws-1",
      planId: "pro",
    });
  });

  it("opens the billing portal for the ensured workspace", async () => {
    const result = (await billingRouterAny.openPortal({
      input: {
        ownerType: "workspace",
      },
      context: createContext(),
    })) as { url: string };

    expect(openBillingPortalForOwnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: "workspace",
        ownerId: "ws-1",
      }),
      undefined,
    );
    expect(result.url).toBe("https://portal.example.com");
  });

  it("returns an admin overview for a target user", async () => {
    const result = (await billingRouterAny.adminUserOverview({
      input: {
        targetUserId: "user-2",
      },
      context: createContext(),
    })) as {
      targetUser: { id: string };
      activeWorkspace: { id: string } | null;
    };

    expect(getAdminBillingOverviewForUserMock).toHaveBeenCalledWith("user-2");
    expect(result.targetUser.id).toBe("user-2");
    expect(result.activeWorkspace?.id).toBe("ws-target");
  });

  it("blocks admin overview for non-admin users", async () => {
    await expect(
      billingRouterAny.adminUserOverview({
        input: {
          targetUserId: "user-2",
        },
        context: createContext("member"),
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Admin role required",
    });
  });

  it("creates admin top-ups on the selected user's active workspace", async () => {
    const result = (await billingRouterAny.adminManualTopUp({
      input: {
        targetUserId: "user-2",
        usdAmount: 25,
      },
      context: createContext(),
    })) as { id: string; creditsGranted: number };

    expect(getExistingBillingOwnerForUserMock).toHaveBeenCalledWith("user-2");
    expect(createManualTopUpMock).toHaveBeenCalledWith({
      owner: expect.objectContaining({
        ownerType: "workspace",
        ownerId: "ws-target",
      }),
      grantedByUserId: "user-1",
      usdAmount: 25,
    });
    expect(result).toEqual({
      id: "topup-1",
      creditsGranted: 2500,
      expiresAt: new Date("2027-03-09T00:00:00.000Z"),
    });
  });

  it("rejects admin top-ups when the target user has no active workspace", async () => {
    getExistingBillingOwnerForUserMock.mockResolvedValueOnce({
      targetUser: {
        id: "user-2",
        name: "Target User",
        email: "target@example.com",
      },
      activeWorkspace: null,
      owner: null,
    });

    await expect(
      billingRouterAny.adminManualTopUp({
        input: {
          targetUserId: "user-2",
          usdAmount: 25,
        },
        context: createContext(),
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Selected user does not have an active workspace",
    });
  });

  it("updates workspace images for workspace members", async () => {
    getWorkspaceMembershipForUserMock.mockResolvedValueOnce({
      role: "member",
      workspaceId: "ws-1",
      userId: "user-1",
    });

    const result = (await billingRouterAny.updateImage({
      input: {
        workspaceId: "ws-1",
        mimeType: "image/png",
        contentBase64: "cG5n",
      },
      context: createContext(),
    })) as { imageUrl: string | null };

    expect(getWorkspaceMembershipForUserMock).toHaveBeenCalledWith("user-1", "ws-1");
    expect(updateWorkspaceImageMock).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      mimeType: "image/png",
      contentBase64: "cG5n",
    });
    expect(result.imageUrl).toBe("/api/workspaces/ws-1/image?v=1");
  });

  it("blocks workspace image updates for non-members", async () => {
    getWorkspaceMembershipForUserMock.mockResolvedValueOnce(null);

    await expect(
      billingRouterAny.updateImage({
        input: {
          workspaceId: "ws-1",
          mimeType: "image/png",
          contentBase64: "cG5n",
        },
        context: createContext(),
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Workspace not found",
    });
    expect(updateWorkspaceImageMock).not.toHaveBeenCalled();
  });

  it("removes workspace images for workspace members", async () => {
    getWorkspaceMembershipForUserMock.mockResolvedValueOnce({
      role: "member",
      workspaceId: "ws-1",
      userId: "user-1",
    });

    const result = (await billingRouterAny.removeImage({
      input: {
        workspaceId: "ws-1",
      },
      context: createContext(),
    })) as { imageUrl: string | null };

    expect(getWorkspaceMembershipForUserMock).toHaveBeenCalledWith("user-1", "ws-1");
    expect(removeWorkspaceImageMock).toHaveBeenCalledWith("ws-1");
    expect(result.imageUrl).toBeNull();
  });
});
