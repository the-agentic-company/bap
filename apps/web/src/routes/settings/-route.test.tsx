// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

void jestDomVitest;

const mocks = vi.hoisted(() => ({
  pathname: "/settings",
  useIsAdmin: vi.fn<VitestProcedure>(),
}));

// Replace the TanStack location hook. Outlet renders nothing here; we only assert tab visibility.
vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => (options: Record<string, unknown>) => ({
      options,
      useRouteContext: () => ({ sessionContext: { principal: null } }),
    }),
    useLocation: ({ select }: { select: (loc: { pathname: string }) => unknown }) =>
      select({ pathname: mocks.pathname }),
    Outlet: () => null,
  };
});

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => mocks.useIsAdmin(),
}));

vi.mock("@/components/authenticated-app-root-shell", () => ({
  AuthenticatedAppRootShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The guard module imports server-only auth (which reads server env); stub it so the
// layout component can be imported in the jsdom client environment.
vi.mock("@/lib/route-guards", () => ({
  requireSession: vi.fn<VitestProcedure>(),
}));

// Force billing capability on so the admin/non-admin tab gating is the only variable.
vi.mock("@/lib/edition", () => ({
  clientEditionCapabilities: { edition: "cloud", hasBilling: true },
}));

vi.mock("@/components/ui/tabs", () => ({
  AnimatedTabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AnimatedTab: ({ children, href }: { children: React.ReactNode; href: string; value: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { Route } from "./route";

function renderLayout() {
  const SettingsLayout = Route.options.component!;
  render(<SettingsLayout />);
}

describe("/settings layout", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = "/settings";
    mocks.useIsAdmin.mockReturnValue({ isAdmin: false, isLoading: false });
  });

  it("hides billing and usage tabs for non-admin users", () => {
    renderLayout();

    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Connected AI Account")).toBeInTheDocument();
    expect(screen.queryByText("Usage")).not.toBeInTheDocument();
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
  });

  it("shows billing and usage tabs for admin users", () => {
    mocks.useIsAdmin.mockReturnValue({ isAdmin: true, isLoading: false });

    renderLayout();

    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
  });
});
