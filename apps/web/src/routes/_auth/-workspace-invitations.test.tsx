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
          organizationName: string;
          inviterEmail: string;
        } | null;
        error?: { message?: string } | null;
      }>
    >(),
  acceptInvitation:
    vi.fn<(input: { invitationId: string }) => Promise<{ error?: { message?: string } | null }>>(),
  rejectInvitation:
    vi.fn<(input: { invitationId: string }) => Promise<{ error?: { message?: string } | null }>>(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: mocks.getSession,
    organization: {
      getInvitation: mocks.getInvitation,
      acceptInvitation: mocks.acceptInvitation,
      rejectInvitation: mocks.rejectInvitation,
    },
  },
}));

import { WorkspaceInvitationView } from "./workspace-invitations.$invitationId";

function renderView() {
  render(<WorkspaceInvitationView invitationId="inv-1" navigate={mocks.navigate} />);
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
        organizationName: "Acme",
        inviterEmail: "owner@example.com",
      },
    });
    mocks.acceptInvitation.mockResolvedValue({});
    mocks.rejectInvitation.mockResolvedValue({});
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
  });

  it("asks unauthenticated recipients to sign in with a return URL", async () => {
    mocks.getSession.mockResolvedValue({ data: null });

    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(mocks.getInvitation).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/login?callbackUrl=%2Fworkspace-invitations%2Finv-1",
    );
  });
});
