// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedMagicLinkPageState } from "@/server/lib/magic-link-request-state";
import { SignInTokenView } from "./sign-in.$token";

// The view renders TanStack <Link> (invalid state), which needs router context. Mount it
// through a minimal memory router whose root renders the view, so links resolve their href
// without the real (generated) route tree. The DB-backed loader is covered by the
// magic-link state module's own tests; here we drive the view with explicit state/search.
async function renderView(
  state: ResolvedMagicLinkPageState,
  query: { error?: string; resent?: string } = {},
) {
  const rootRoute = createRootRoute({
    component: () => <SignInTokenView token="abc123" state={state} query={query} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.status).toBe("idle"));
}

describe("/sign-in/$token page", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the valid token state with a continue button", async () => {
    await renderView({
      status: "pending",
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
    });

    expect(screen.getByRole("heading", { name: "Confirm sign-in" })).not.toBeNull();
    expect(screen.getByText("pilot@cmdclaw.ai")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeNull();
  });

  it("shows the expired token state with resend", async () => {
    await renderView({
      status: "expired",
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
    });

    expect(screen.getByRole("heading", { name: "Link expired" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Resend link" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("shows the already used state with resend", async () => {
    await renderView({
      status: "consumed",
      email: "pilot@cmdclaw.ai",
      callbackUrl: "/chat",
      newUserCallbackUrl: "/chat",
      errorCallbackUrl: "/login?error=magic-link",
    });

    expect(screen.getByRole("heading", { name: "Link already used" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Resend link" })).not.toBeNull();
  });

  it("shows the invalid link state with a login link", async () => {
    await renderView({
      status: "invalid",
      email: null,
      callbackUrl: null,
      newUserCallbackUrl: null,
      errorCallbackUrl: null,
    });

    expect(screen.getByRole("heading", { name: "Invalid link" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Back to login" }).getAttribute("href")).toBe("/login");
  });

  it("shows a resend confirmation banner", async () => {
    await renderView(
      {
        status: "consumed",
        email: "pilot@cmdclaw.ai",
        callbackUrl: "/chat",
        newUserCallbackUrl: "/chat",
        errorCallbackUrl: "/login?error=magic-link",
      },
      { resent: "1" },
    );

    expect(screen.getByText("We sent a new sign-in link to pilot@cmdclaw.ai.")).not.toBeNull();
  });

  it("shows an invite-only error when the email is not approved", async () => {
    await renderView(
      {
        status: "pending",
        email: "pilot@cmdclaw.ai",
        callbackUrl: "/chat",
        newUserCallbackUrl: "/chat",
        errorCallbackUrl: "/login?error=magic-link",
      },
      { error: "invite_only" },
    );

    expect(
      screen.getByText("This app is invite-only. That email address is not approved yet."),
    ).not.toBeNull();
  });
});
