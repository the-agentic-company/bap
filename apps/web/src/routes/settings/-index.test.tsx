// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

void jestDomVitest;

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<VitestProcedure>(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
}));

vi.mock("gt-react", () => ({
  T: ({ children }: { children: React.ReactNode }) => children,
  useGT: () => (value: string) => value,
}));

vi.mock("@/components/general-translation-provider", () => ({
  useAppLocale: () => ({
    locale: "en",
    locales: ["en"],
    setLocale: vi.fn<VitestProcedure>(),
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: mocks.getSession,
  },
}));

vi.mock("@/orpc/hooks/billing", () => ({
  useBillingOverview: () => ({ data: undefined }),
}));

vi.mock("@/orpc/hooks/user", () => ({
  useCurrentUser: () => ({ data: undefined }),
  useRemoveUserImage: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
  useSetUserTimezone: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
  useUpdateUserImage: () => ({ mutateAsync: vi.fn<VitestProcedure>() }),
}));

import { Route } from "./index";

describe("/settings general page", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the account-loading error when the refreshed session has no user", async () => {
    mocks.getSession.mockResolvedValue({ data: null });
    const SettingsPage = Route.options.component as React.ComponentType;

    render(<SettingsPage />);

    expect(
      await screen.findByText("Unable to load your account. Please try again."),
    ).toBeInTheDocument();
  });
});
