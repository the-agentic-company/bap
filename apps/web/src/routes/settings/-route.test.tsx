// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

void jestDomVitest;

const mocks = vi.hoisted(() => ({
  pathname: "/settings",
  useIsAdmin: vi.fn<(...args: unknown[]) => unknown>(),
}));

// Replace the TanStack location hook (the migrated layout derives the active tab from the
// router location instead of the old next/navigation usePathname). Outlet renders nothing
// here; we only assert tab visibility.
vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useLocation: ({ select }: { select: (loc: { pathname: string }) => unknown }) =>
      select({ pathname: mocks.pathname }),
    Outlet: () => null,
  };
});

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => mocks.useIsAdmin(),
}));

// The guard module imports server-only auth (which reads server env); stub it so the
// layout component can be imported in the jsdom client environment.
vi.mock("@/lib/route-guards", () => ({
  requireSession: vi.fn<(...args: unknown[]) => unknown>(),
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
