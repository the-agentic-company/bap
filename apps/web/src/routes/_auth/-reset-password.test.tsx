// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

void jestDomVitest;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<(path: string) => void>(),
  resetPassword: vi.fn<(input: { token: string; newPassword: string }) => Promise<object>>(),
  signInEmail: vi.fn<
    (input: { email: string; password: string; callbackURL: string }) => Promise<object>
  >(),
}));

// Replace Better Auth's client with deterministic stubs; the view drives it directly.
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    resetPassword: mocks.resetPassword,
    signIn: {
      email: mocks.signInEmail,
    },
  },
}));

import { ResetPasswordView } from "./reset-password";

// The view takes search params and a navigate callback as props (the route wires the real
// TanStack `useSearch`/`useNavigate`), so tests can render it without a router harness.
function renderView(search: {
  token?: string;
  error?: string;
  email?: string;
  callbackUrl?: string;
}) {
  render(<ResetPasswordView search={search} navigate={mocks.navigate} />);
}

describe("/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetPassword.mockResolvedValue({});
    mocks.signInEmail.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it("resets the password and redirects to the callbackUrl", async () => {
    renderView({ token: "token-1", callbackUrl: "/chat", email: "pilot@cmdclaw.ai" });

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Set password" }).closest("form")!);

    await waitFor(() => {
      expect(mocks.resetPassword).toHaveBeenCalledWith({
        token: "token-1",
        newPassword: "new-password-123",
      });
    });
    expect(mocks.signInEmail).toHaveBeenCalledWith({
      email: "pilot@cmdclaw.ai",
      password: "new-password-123",
      callbackURL: "/chat",
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/chat");
  });

  it("still redirects when older reset links do not include an email", async () => {
    renderView({ token: "token-1", callbackUrl: "/chat" });

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Set password" }).closest("form")!);

    await waitFor(() => {
      expect(mocks.resetPassword).toHaveBeenCalledWith({
        token: "token-1",
        newPassword: "new-password-123",
      });
    });
    expect(mocks.signInEmail).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/chat");
  });

  it("shows the invalid token state", () => {
    renderView({ error: "INVALID_TOKEN" });

    expect(screen.getByRole("heading", { name: "Invalid password link" })).toBeInTheDocument();
    expect(
      screen.getByText("This password link is invalid or has already been used."),
    ).toBeInTheDocument();
  });

  it("shows the expired token state", () => {
    renderView({ error: "EXPIRED_TOKEN" });

    expect(screen.getByRole("heading", { name: "Expired password link" })).toBeInTheDocument();
    expect(
      screen.getAllByText("This password link expired. Request a new one from the login page."),
    ).toHaveLength(2);
  });
});
