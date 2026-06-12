// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

void jestDomVitest;

const mocks = vi.hoisted(() => ({
  env: {
    VITE_APP_URL: undefined as string | undefined,
    VITE_APP_EDITION: "cloud" as string | undefined,
  },
  autumnProvider: vi.fn<
    ({
      backendUrl,
      children,
      useBetterAuth,
    }: {
      backendUrl?: string;
      children: ReactNode;
      useBetterAuth?: boolean;
    }) => ReactNode
  >(({ children }) => <div data-testid="autumn-provider">{children}</div>),
}));

vi.mock("@/env", () => ({
  env: mocks.env,
}));

vi.mock("autumn-js/react", () => ({
  AutumnProvider: mocks.autumnProvider,
}));

vi.mock("@/components/app-shell-route-wrapper", () => ({
  AppShellRouteWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/posthog-provider", () => ({
  PostHogClientProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/session-principal-cache-guard", () => ({
  SessionPrincipalCacheGuard: () => null,
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: () => null,
}));

vi.mock("@/orpc/provider", () => ({
  ORPCProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/zero/provider", () => ({
  CmdClawZeroProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.env.VITE_APP_URL = undefined;
  mocks.env.VITE_APP_EDITION = "cloud";
});

describe("AppRootShell", () => {
  it("falls back to the current origin for Autumn Better Auth requests", async () => {
    const { AppRootShell } = await import("./app-root-shell");

    render(
      <AppRootShell hasSession={false}>
        <span>child content</span>
      </AppRootShell>,
    );

    await waitFor(() => expect(mocks.autumnProvider).toHaveBeenCalled());

    expect(mocks.autumnProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({
        backendUrl: window.location.origin,
        useBetterAuth: true,
      }),
      undefined,
    );
    expect(screen.getByTestId("autumn-provider")).toHaveTextContent("child content");
  });

  it("uses the configured public app URL when present", async () => {
    mocks.env.VITE_APP_URL = "https://app.cmdclaw.com";
    const { getAutumnBetterAuthUrl } = await import("./app-root-shell");

    expect(getAutumnBetterAuthUrl()).toBe("https://app.cmdclaw.com");
  });
});
