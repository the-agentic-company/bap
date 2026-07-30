// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

void jestDomVitest;

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<VitestProcedure>(),
  mutateAsync: vi.fn<VitestProcedure>(),
  requiresTwoFactor: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/orpc/hooks/billing", () => ({
  useBillingOverview: () => ({
    data: {
      owner: { ownerId: "workspace-1" },
      workspaces: [
        {
          id: "workspace-1",
          name: "Acme Operations",
          requiresTwoFactor: mocks.requiresTwoFactor,
        },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock("@/orpc/hooks/workspace", () => ({
  useSetWorkspaceTwoFactorRequirement: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
  useWorkspaceMembers: () => ({
    data: {
      membershipRole: "admin",
      members: [
        {
          userId: "user-1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          role: "admin",
          twoFactorEnabled: true,
        },
        {
          userId: "user-2",
          name: "Grace Hopper",
          email: "grace@example.com",
          role: "member",
          twoFactorEnabled: false,
        },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn<VitestProcedure>(),
    success: vi.fn<VitestProcedure>(),
  },
}));

import { AdminWorkspaceSettingsPage } from "./settings";

describe("AdminWorkspaceSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requiresTwoFactor = false;
    mocks.mutateAsync.mockResolvedValue({
      id: "workspace-1",
      requiresTwoFactor: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the active Workspace policy and member readiness", () => {
    render(<AdminWorkspaceSettingsPage />);

    expect(screen.getByText("Acme Operations")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workspace security" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 members enrolled")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Enrolled")).toBeInTheDocument();
    expect(screen.getByText("Not enrolled")).toBeInTheDocument();
  });

  it("enforces MFA and routes an unenrolled admin through setup", async () => {
    render(<AdminWorkspaceSettingsPage />);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Require authenticator app MFA for this Workspace",
      }),
    );

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        required: true,
      });
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: "/two-factor/setup?callbackUrl=%2Fadmin%2Fsettings",
      });
    });
  });

  it("asks for confirmation before making enforced MFA optional", async () => {
    mocks.requiresTwoFactor = true;
    render(<AdminWorkspaceSettingsPage />);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Require authenticator app MFA for this Workspace",
      }),
    );

    expect(screen.getByText("Make MFA optional?")).toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Make optional" }));

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        required: false,
      });
    });
  });
});
