// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingIntegrationsPage from "./page";

void jestDomVitest;

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  completeOnboardingMutateAsync: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    type = "button",
    onClick,
    disabled,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt?: string }) => <div aria-label={alt} />,
}));

vi.mock("@/orpc/hooks", () => ({
  useIntegrationList: () => ({
    data: [],
    isLoading: false,
    refetch: vi.fn(),
  }),
  useGetAuthUrl: () => ({
    mutateAsync: vi.fn(),
  }),
  useCompleteOnboarding: () => ({
    mutateAsync: mocks.completeOnboardingMutateAsync,
    isPending: false,
  }),
  useLinkLinkedIn: () => ({
    mutateAsync: vi.fn(),
  }),
}));

describe("OnboardingIntegrationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completeOnboardingMutateAsync.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("redirects to coworkers after continuing onboarding", async () => {
    render(<OnboardingIntegrationsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(mocks.completeOnboardingMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mocks.routerPush).toHaveBeenCalledWith("/agents");
  }, 15_000);

  it("redirects to coworkers after skipping onboarding", async () => {
    render(<OnboardingIntegrationsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => {
      expect(mocks.completeOnboardingMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mocks.routerPush).toHaveBeenCalledWith("/agents");
  }, 15_000);
});
