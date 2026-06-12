import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/cmdclaw";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
process.env.SANDBOX_DEFAULT ??= "docker";
process.env.ENCRYPTION_KEY ??= "0".repeat(64);
process.env.APP_SERVER_SECRET ??= "1".repeat(64);
process.env.AWS_ENDPOINT_URL ??= "http://localhost:9000";
process.env.AWS_ACCESS_KEY_ID ??= "test-access-key";
process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret-key";

var userFindFirstMock: ReturnType<typeof vi.fn>;
var workspaceMemberFindFirstMock: ReturnType<typeof vi.fn>;
var workspaceFindFirstMock: ReturnType<typeof vi.fn>;
var billingTopUpFindManyMock: ReturnType<typeof vi.fn>;
var workspaceInsertReturningMock: ReturnType<typeof vi.fn>;
var billingTopUpInsertReturningMock: ReturnType<typeof vi.fn>;
var workspaceInsertValuesMock: ReturnType<typeof vi.fn>;
var workspaceMemberInsertValuesMock: ReturnType<typeof vi.fn>;
var billingTopUpInsertValuesMock: ReturnType<typeof vi.fn>;
var userUpdateWhereMock: ReturnType<typeof vi.fn>;
var userUpdateSetMock: ReturnType<typeof vi.fn>;
var selectMock: ReturnType<typeof vi.fn>;
var selectFromMock: ReturnType<typeof vi.fn>;
var selectWhereMock: ReturnType<typeof vi.fn>;
var balancesCreateMock: ReturnType<typeof vi.fn>;
var autumnCheckMock: ReturnType<typeof vi.fn>;
var insertMock: ReturnType<typeof vi.fn>;

vi.mock("@cmdclaw/db/client", () => ({
  db: (() => {
    userFindFirstMock = vi.fn();
    billingTopUpFindManyMock = vi.fn();
    workspaceMemberFindFirstMock = vi.fn();
    workspaceFindFirstMock = vi.fn();
    workspaceInsertReturningMock = vi.fn();
    billingTopUpInsertReturningMock = vi.fn();
    workspaceInsertValuesMock = vi.fn(() => ({
      returning: workspaceInsertReturningMock,
    }));
    workspaceMemberInsertValuesMock = vi.fn().mockResolvedValue(undefined);
    billingTopUpInsertValuesMock = vi.fn(() => ({
      returning: billingTopUpInsertReturningMock,
    }));
    userUpdateWhereMock = vi.fn();
    selectWhereMock = vi.fn();
    selectFromMock = vi.fn(() => ({
      where: selectWhereMock,
    }));
    selectMock = vi.fn(() => ({
      from: selectFromMock,
    }));
    userUpdateSetMock = vi.fn(() => ({
      where: userUpdateWhereMock,
    }));
    insertMock = vi.fn();

    return {
      query: {
        user: { findFirst: userFindFirstMock },
        billingTopUp: { findMany: billingTopUpFindManyMock },
        workspaceMember: { findFirst: workspaceMemberFindFirstMock },
        workspace: { findFirst: workspaceFindFirstMock },
      },
      insert: insertMock,
      select: selectMock,
      update: vi.fn(() => ({
        set: userUpdateSetMock,
      })),
    };
  })(),
}));

vi.mock("./autumn", () => ({
  getAutumnClient: (() => {
    balancesCreateMock = vi.fn();
    autumnCheckMock = vi.fn();
    return vi.fn(() => ({
      balances: { create: balancesCreateMock },
      check: autumnCheckMock,
      customers: {
        get: vi.fn().mockRejectedValue(new Error("missing")),
        create: vi.fn().mockResolvedValue({}),
      },
    }));
  })(),
}));

const {
  createManualTopUp,
  createWorkspaceForUser,
  getAdminBillingOverviewForUser,
  getExistingBillingOwnerForUser,
  resolveBillingOwnerForUser,
} = await import("./service");

describe("billing service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReturnValue({ values: billingTopUpInsertValuesMock });
    balancesCreateMock.mockResolvedValue({ data: { message: "ok" }, error: null });
    autumnCheckMock.mockResolvedValue({
      data: {
        balance: 900,
        breakdown: [{ interval: "one_off", balance: 400 }],
      },
      error: null,
    });
    billingTopUpFindManyMock.mockResolvedValue([
      {
        id: "topup-1",
        usdAmount: 25,
        creditsGranted: 2500,
        createdAt: new Date("2026-03-10T10:00:00.000Z"),
        expiresAt: new Date("2027-03-10T10:00:00.000Z"),
      },
    ]);
    selectWhereMock.mockResolvedValue([{ creditsCharged: 0 }]);
    workspaceInsertReturningMock.mockResolvedValue([
      {
        id: "ws-created",
        name: "Alice's workspace",
        slug: "alice-workspace-1234",
        billingPlanId: "free",
        autumnCustomerId: null,
      },
    ]);
    billingTopUpInsertReturningMock.mockResolvedValue([
      {
        id: "topup-1",
        creditsGranted: 2500,
        expiresAt: new Date("2027-03-09T00:00:00.000Z"),
      },
    ]);
    userUpdateWhereMock.mockResolvedValue(undefined);
  });

  it("resolves workspace billing for any active workspace plan", async () => {
    userFindFirstMock.mockResolvedValue({
      id: "user-1",
      activeWorkspaceId: "ws-1",
    });
    workspaceMemberFindFirstMock.mockResolvedValue({
      workspace: {
        id: "ws-1",
        name: "Alpha",
        billingPlanId: "pro",
        autumnCustomerId: "cus-ws-1",
      },
    });

    const owner = await resolveBillingOwnerForUser("user-1");

    expect(owner).toEqual({
      ownerType: "workspace",
      ownerId: "ws-1",
      autumnCustomerId: "cus-ws-1",
      planId: "pro",
    });
  });

  it("auto-creates a free workspace when the user has none", async () => {
    insertMock
      .mockReturnValueOnce({ values: workspaceInsertValuesMock })
      .mockReturnValueOnce({ values: workspaceMemberInsertValuesMock });
    userFindFirstMock
      .mockResolvedValueOnce({
        id: "user-1",
        activeWorkspaceId: null,
      })
      .mockResolvedValueOnce({
        id: "user-1",
        name: "Alice",
      });
    workspaceMemberFindFirstMock.mockResolvedValue(null);
    workspaceFindFirstMock.mockResolvedValue(null);

    const owner = await resolveBillingOwnerForUser("user-1");

    expect(workspaceInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByUserId: "user-1",
        billingPlanId: "free",
      }),
    );
    expect(workspaceMemberInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-created",
        userId: "user-1",
        role: "owner",
      }),
    );
    expect(owner).toEqual({
      ownerType: "workspace",
      ownerId: "ws-created",
      autumnCustomerId: "ws-created",
      planId: "free",
    });
  });

  it("returns no existing billing owner when the target user has no active workspace", async () => {
    userFindFirstMock.mockResolvedValue({
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
      activeWorkspaceId: null,
    });

    const result = await getExistingBillingOwnerForUser("user-1");

    expect(result).toEqual({
      targetUser: {
        id: "user-1",
        name: "Alice",
        email: "alice@example.com",
      },
      activeWorkspace: null,
      owner: null,
    });
    expect(workspaceMemberFindFirstMock).not.toHaveBeenCalled();
  });

  it("loads an admin billing overview without creating a workspace", async () => {
    userFindFirstMock.mockResolvedValue({
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
      activeWorkspaceId: "ws-1",
    });
    workspaceMemberFindFirstMock.mockResolvedValue({
      workspace: {
        id: "ws-1",
        name: "Alpha",
        slug: "alpha",
        billingPlanId: "pro",
        autumnCustomerId: "cus-ws-1",
      },
    });

    const result = await getAdminBillingOverviewForUser("user-1");

    expect(result.targetUser).toEqual({
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
    });
    expect(result.activeWorkspace).toEqual({
      id: "ws-1",
      name: "Alpha",
      slug: "alpha",
    });
    expect(result.plan?.id).toBe("pro");
    expect(result.feature).toEqual({
      balance: 900,
      breakdown: [{ interval: "one_off", balance: 400 }],
    });
    expect(result.recentTopUps).toHaveLength(1);
    expect(workspaceInsertValuesMock).not.toHaveBeenCalled();
    expect(workspaceMemberInsertValuesMock).not.toHaveBeenCalled();
  });

  it("falls back to stored top-up balance when Autumn omits numeric balances", async () => {
    autumnCheckMock.mockResolvedValueOnce({
      data: {
        allowed: false,
        code: "feature_found",
        customer_id: "cus-ws-1",
        feature_id: "llm_credits",
        required_balance: 0,
      },
      error: null,
    });
    userFindFirstMock.mockResolvedValue({
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
      activeWorkspaceId: "ws-1",
    });
    workspaceMemberFindFirstMock.mockResolvedValue({
      workspace: {
        id: "ws-1",
        name: "Alpha",
        slug: "alpha",
        billingPlanId: "free",
        autumnCustomerId: "cus-ws-1",
      },
    });
    billingTopUpFindManyMock
      .mockResolvedValueOnce([
        {
          id: "topup-1",
          usdAmount: 25,
          creditsGranted: 2500,
          createdAt: new Date("2026-03-10T10:00:00.000Z"),
          expiresAt: new Date("2027-03-10T10:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          creditsGranted: 2500,
        },
      ]);
    selectWhereMock.mockResolvedValueOnce([{ creditsCharged: 1200 }]);

    const result = await getAdminBillingOverviewForUser("user-1");

    expect(result.feature).toEqual({
      allowed: false,
      code: "feature_found",
      customer_id: "cus-ws-1",
      feature_id: "llm_credits",
      required_balance: 0,
      balance: 1300,
      breakdown: [{ interval: "one_off", balance: 1300 }],
    });
  });

  it("creates new workspaces on the free plan", async () => {
    insertMock
      .mockReturnValueOnce({ values: workspaceInsertValuesMock })
      .mockReturnValueOnce({ values: workspaceMemberInsertValuesMock });
    workspaceFindFirstMock.mockResolvedValue(null);

    await createWorkspaceForUser("user-1", "Alpha");

    expect(workspaceInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Alpha",
        billingPlanId: "free",
      }),
    );
  });

  it("grants top-up credits to the workspace owner only", async () => {
    const result = await createManualTopUp({
      owner: {
        ownerType: "workspace",
        ownerId: "ws-1",
        autumnCustomerId: "cus-ws-1",
        planId: "free",
      },
      grantedByUserId: "admin-1",
      usdAmount: 25,
    });

    expect(balancesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "cus-ws-1",
        feature_id: "llm_credits",
        granted_balance: 2500,
      }),
    );
    expect(billingTopUpInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: "workspace",
        userId: null,
        workspaceId: "ws-1",
        usdAmount: 25,
        creditsGranted: 2500,
      }),
    );
    expect(result.creditsGranted).toBe(2500);
  });
});
