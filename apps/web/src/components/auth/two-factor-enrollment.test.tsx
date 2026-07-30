// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

void jestDomVitest;

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const mocks = vi.hoisted(() => ({
  disable: vi.fn<VitestProcedure>(),
  enable: vi.fn<VitestProcedure>(),
  fetch: vi.fn<VitestProcedure>(),
  toastSuccess: vi.fn<VitestProcedure>(),
  verifyTotp: vi.fn<VitestProcedure>(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    twoFactor: {
      disable: mocks.disable,
      enable: mocks.enable,
      verifyTotp: mocks.verifyTotp,
    },
  },
}));

vi.mock("react-qr-code", () => ({
  default: () => <div data-testid="qr-code" />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
  },
}));

import { TwoFactorEnrollment } from "./two-factor-enrollment";

type EnrollmentProps = {
  initiallyEnabled: boolean;
  email: string;
  passwordSetupCallbackUrl: string;
};

const PasswordAwareEnrollment = TwoFactorEnrollment as ComponentType<EnrollmentProps>;

describe("TwoFactorEnrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks a passwordless user to create a password instead of entering one", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ approved: true, hasPassword: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    render(
      <PasswordAwareEnrollment
        initiallyEnabled={false}
        email="pilot@heybap.com"
        passwordSetupCallbackUrl="/two-factor/setup?callbackUrl=%2Fchat"
      />,
    );

    expect(
      await screen.findByText("Set up a password before enabling two-factor authentication."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set up password" }));

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenNthCalledWith(2, "/api/auth/password/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "pilot@heybap.com",
          callbackUrl: "/two-factor/setup?callbackUrl=%2Fchat",
        }),
      });
    });

    expect(await screen.findByText("Password setup link sent")).toBeInTheDocument();
  });

  it("requests the current password when the user already has one", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ approved: true, hasPassword: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(
      <PasswordAwareEnrollment
        initiallyEnabled={false}
        email="pilot@heybap.com"
        passwordSetupCallbackUrl="/settings"
      />,
    );

    expect(await screen.findByLabelText("Current password")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up password" })).not.toBeInTheDocument();
  });
});
