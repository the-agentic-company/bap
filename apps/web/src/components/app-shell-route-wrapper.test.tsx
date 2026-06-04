// @vitest-environment jsdom

import type React from "react";
import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import { AppShellRouteWrapper } from "./app-shell-route-wrapper";

void jestDomVitest;

type MockCurrentUserState = {
  data: { onboardedAt: Date | null } | undefined;
  isLoading: boolean;
  isFetching: boolean;
};

const mocks = vi.hoisted(() => ({
  pathname: "/chat",
  replace: vi.fn<VitestProcedure>(),
  currentUser: {
    data: { onboardedAt: null },
    isLoading: false,
    isFetching: false,
  } as MockCurrentUserState,
}));

vi.mock("@/components/next-navigation-compat", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/orpc/hooks/user", () => ({
  useCurrentUser: () => mocks.currentUser,
}));

describe("AppShellRouteWrapper", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = "/chat";
    mocks.currentUser = {
      data: { onboardedAt: null },
      isLoading: false,
      isFetching: false,
    };
  });

  it("does not redirect while onboarding enforcement is disabled", async () => {
    mocks.currentUser = {
      data: { onboardedAt: null },
      isLoading: false,
      isFetching: true,
    };

    const { rerender } = render(
      <AppShellRouteWrapper initialHasSession>
        <div>child</div>
      </AppShellRouteWrapper>,
    );

    expect(mocks.replace).not.toHaveBeenCalled();

    mocks.currentUser = {
      data: { onboardedAt: new Date("2026-03-16T12:00:00.000Z") },
      isLoading: false,
      isFetching: false,
    };

    rerender(
      <AppShellRouteWrapper initialHasSession>
        <div>child</div>
      </AppShellRouteWrapper>,
    );

    await waitFor(() => {
      expect(mocks.replace).not.toHaveBeenCalled();
    });
  });

  it("renders the child content for an incomplete user", () => {
    render(
      <AppShellRouteWrapper initialHasSession>
        <div>child</div>
      </AppShellRouteWrapper>,
    );

    expect(screen.getByText("child")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
