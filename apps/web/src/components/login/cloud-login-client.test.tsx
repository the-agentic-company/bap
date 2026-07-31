// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

void jestDomVitest;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<VitestProcedure>(),
  signInMagicLink: vi.fn<VitestProcedure>(),
  signInEmail: vi.fn<VitestProcedure>(),
  signInSocial: vi.fn<VitestProcedure>(),
  getLastUsedLoginMethod: vi.fn<VitestProcedure>(),
  fetchMock: vi.fn<VitestProcedure>(),
  verifyTotp: vi.fn<VitestProcedure>(),
  verifyBackupCode: vi.fn<VitestProcedure>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      magicLink: mocks.signInMagicLink,
      email: mocks.signInEmail,
      social: mocks.signInSocial,
    },
    getLastUsedLoginMethod: mocks.getLastUsedLoginMethod,
    twoFactor: {
      verifyTotp: mocks.verifyTotp,
      verifyBackupCode: mocks.verifyBackupCode,
    },
  },
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({
      children,
      variants: _v,
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      ...props
    }: React.ComponentProps<"div"> & Record<string, unknown>) => <div {...props}>{children}</div>,
  },
}));

import { CloudLoginClient } from "./cloud-login-client";

const approvedEmail = "pilot@heybap.com";

function queuePasswordAvailability(hasPassword: boolean): void {
  mocks.fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ approved: true, hasPassword }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }),
  );
}

function startPasswordLogin(): void {
  render(<CloudLoginClient callbackUrl="/chat" />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: approvedEmail },
  });
  fireEvent.click(screen.getByRole("button", { name: "Password" }));
}

describe("CloudLoginClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLastUsedLoginMethod.mockReturnValue(null);
    mocks.signInMagicLink.mockResolvedValue({});
    mocks.signInEmail.mockResolvedValue({});
    mocks.signInSocial.mockResolvedValue({});
    mocks.verifyTotp.mockResolvedValue({ data: { token: "session" } });
    mocks.verifyBackupCode.mockResolvedValue({ data: { token: "session" } });
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ approved: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", mocks.fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts on the standard login copy by default", () => {
    render(<CloudLoginClient callbackUrl="/chat" />);

    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(
      screen.getByText("Bap is invite-only. Use an approved email to sign in."),
    ).toBeInTheDocument();
  });

  it("shows the getting started copy when requested", () => {
    render(<CloudLoginClient callbackUrl="/chat" initialScreen="getting-started" />);

    expect(screen.getByRole("heading", { name: "Getting started" })).toBeInTheDocument();
    expect(screen.getByText("Use an approved email to create an account.")).toBeInTheDocument();
  });

  it("prefills the email from an invitation link", () => {
    render(
      <CloudLoginClient
        callbackUrl="/workspace-invitations/inv-1"
        initialEmail=" Recipient@Example.com "
        initialScreen="getting-started"
      />,
    );

    expect(screen.getByLabelText("Email")).toHaveValue("recipient@example.com");
  });

  it("signs in with password when the approved email already has one", async () => {
    queuePasswordAvailability(true);
    startPasswordLogin();

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalledWith("/api/auth/check-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "pilot@heybap.com",
        }),
      });
      expect(screen.getByRole("button", { name: "Forgot password?" })).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), {
      target: { value: "hunter2hunter2" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

    await waitFor(() => {
      expect(mocks.signInEmail).toHaveBeenCalledWith({
        email: "pilot@heybap.com",
        password: "hunter2hunter2",
        callbackURL: "/chat",
      });
    });
    expect(mocks.navigate).toHaveBeenCalledWith({ href: "/chat" });
  });

  it("shows sign up copy and creates a password when none exists yet", async () => {
    queuePasswordAvailability(false);
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    startPasswordLogin();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sign up" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Create password" }));

    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/check-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "pilot@heybap.com",
        }),
      });
      expect(mocks.fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/password/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "pilot@heybap.com",
          callbackUrl: "/chat",
        }),
      });
    });

    expect(screen.getByRole("heading", { name: "Create your password" })).toBeInTheDocument();
    expect(screen.getByText("Password setup link sent")).toBeInTheDocument();
  });

  it("verifies the authenticator code before completing password sign-in", async () => {
    queuePasswordAvailability(true);
    mocks.signInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true, twoFactorMethods: ["totp"] },
    });

    startPasswordLogin();
    await screen.findByPlaceholderText("Enter your password");
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), {
      target: { value: "hunter2hunter2" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

    expect(
      await screen.findByRole("heading", { name: "Two-factor authentication" }),
    ).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Authenticator code"), {
      target: { value: "123456" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Verify" }).closest("form")!);

    await waitFor(() => {
      expect(mocks.verifyTotp).toHaveBeenCalledWith({
        code: "123456",
        trustDevice: false,
      });
      expect(mocks.navigate).toHaveBeenCalledWith({ href: "/chat" });
    });
  });

  it("sends a magic link", async () => {
    render(<CloudLoginClient callbackUrl="/chat" />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "pilot@heybap.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Magic link" }));

    await waitFor(() => {
      expect(mocks.signInMagicLink).toHaveBeenCalledWith({
        email: "pilot@heybap.com",
        callbackURL: "/chat",
        newUserCallbackURL: "/chat",
        errorCallbackURL: "/login?error=magic-link",
      });
    });

    expect(screen.getByRole("heading", { name: "Check your inbox" })).toBeInTheDocument();
  });
});
