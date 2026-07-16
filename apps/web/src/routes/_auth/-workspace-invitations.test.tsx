// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

void jestDomVitest;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<(path: string) => void>(),
  getSession: vi.fn<() => Promise<{ data: { user: { id: string } } | null }>>(),
  getInvitation:
    vi.fn<
      (input: { query: { id: string } }) => Promise<{
        data?: {
          id: string;
          email: string;
          role: string;
          organizationId?: string | null;
          organizationName: string;
          inviterEmail: string;
        } | null;
        error?: { message?: string } | null;
      }>
    >(),
  acceptInvitation:
    vi.fn<
      (input: { invitationId: string }) => Promise<{
        data?: { organizationId?: string } | null;
        error?: { message?: string } | null;
      }>
    >(),
  rejectInvitation:
    vi.fn<(input: { invitationId: string }) => Promise<{ error?: { message?: string } | null }>>(),
  setActive:
    vi.fn<
      (input: { organizationId: string }) => Promise<{ error?: { message?: string } | null }>
    >(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: mocks.getSession,
    organization: {
      getInvitation: mocks.getInvitation,
      acceptInvitation: mocks.acceptInvitation,
      rejectInvitation: mocks.rejectInvitation,
      setActive: mocks.setActive,
    },
  },
}));

import { WorkspaceInvitationView } from "./workspace-invitations.$invitationId";

function renderView(invitedEmail?: string) {
  render(
    <WorkspaceInvitationView
      invitationId="inv-1"
      invitedEmail={invitedEmail}
      navigate={mocks.navigate}
    />,
  );
}

describe("/workspace-invitations/$invitationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.getInvitation.mockResolvedValue({
      data: {
        id: "inv-1",
        email: "recipient@example.com",
        role: "member",
        organizationId: "ws-1",
        organizationName: "Acme",
        inviterEmail: "owner@example.com",
      },
    });
    mocks.acceptInvitation.mockResolvedValue({ data: { organizationId: "ws-1" } });
    mocks.rejectInvitation.mockResolvedValue({});
    mocks.setActive.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the native Better Auth invitation and accepts it", async () => {
    renderView();

    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(mocks.getInvitation).toHaveBeenCalledWith({ query: { id: "inv-1" } });

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => {
      expect(mocks.acceptInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
    });
    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: "ws-1" });
    expect(mocks.navigate).toHaveBeenCalledWith("/chat");
    expect(await screen.findByRole("heading", { name: "Workspace joined" })).toBeInTheDocument();
  });

  it("rejects the native Better Auth invitation without granting membership", async () => {
    renderView();

    expect(await screen.findByText("Acme")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(mocks.rejectInvitation).toHaveBeenCalledWith({ invitationId: "inv-1" });
    });
    expect(await screen.findByRole("heading", { name: "Invitation rejected" })).toBeInTheDocument();
    expect(mocks.setActive).not.toHaveBeenCalled();
  });

  it("asks unauthenticated recipients to sign in with a return URL", async () => {
    mocks.getSession.mockResolvedValue({ data: null });

    renderView("recipient@example.com");

    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(mocks.getInvitation).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/login?callbackUrl=%2Fworkspace-invitations%2Finv-1&mode=getting-started&email=recipient%40example.com",
    );
  });

  it("shows an activation error when accepting cannot switch workspaces", async () => {
    mocks.setActive.mockResolvedValueOnce({ error: { message: "Cannot switch workspace" } });

    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));

    expect(await screen.findByText("Cannot switch workspace")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalledWith("/chat");
  });
});
