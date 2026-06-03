// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

void jestDomVitest;

const mocks = vi.hoisted(() => ({
  pathname: "/chat",
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useLocation: (options?: { select?: (location: { pathname: string }) => unknown }) => {
      const location = { pathname: mocks.pathname };
      return options?.select ? options.select(location) : location;
    },
  };
});

vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
}));

vi.mock("@/components/mobile-bottom-bar", () => ({
  MobileBottomBar: () => <div data-testid="mobile-bottom-bar" />,
}));

vi.mock("@/components/selfhost-control-plane-gate", () => ({
  SelfhostControlPlaneGate: () => null,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: vi.fn(),
  },
}));

describe("AppShell", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.pathname = "/chat";
  });

  it("keeps chat routes inside a single internal viewport", () => {
    render(
      <AppShell sidebarVisibility="always">
        <div data-testid="child" />
      </AppShell>,
    );

    const content = screen.getByTestId("child").parentElement;

    expect(content).toHaveClass("app-shell-scroll-container");
    expect(content).toHaveClass("overflow-hidden");
    expect(content).toHaveClass("pb-0");
    expect(content).not.toHaveClass("overflow-auto");
  });

  it("preserves page scrolling for non-chat routes", () => {
    mocks.pathname = "/settings";

    render(
      <AppShell sidebarVisibility="always">
        <div data-testid="child" />
      </AppShell>,
    );

    const content = screen.getByTestId("child").parentElement;

    expect(content).toHaveClass("overflow-auto");
    expect(content).toHaveClass("pb-16");
    expect(content).not.toHaveClass("overflow-hidden");
  });
});
