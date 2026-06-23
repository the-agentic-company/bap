// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./app-sidebar";

void jestDomVitest;

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const mocks = vi.hoisted(() => ({
  billingOverview: {
    data: {
      owner: { ownerId: "ws-1" },
      workspaces: [
        {
          id: "ws-1",
          name: "Alpha",
          imageUrl: "/api/workspaces/ws-1/image?v=1",
          active: true,
        },
        {
          id: "ws-2",
          name: "Beta",
          imageUrl: null,
          active: false,
        },
      ],
    },
    isLoading: false,
  },
  getSession: vi.fn<VitestProcedure>(),
  switchWorkspace: vi.fn<VitestProcedure>(),
}));

vi.mock("@/components/app-image", () => ({
  AppImage: ({
    alt,
    src,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string }) => (
    <img alt={alt} src={src} {...props} />
  ),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: mocks.getSession,
    signOut: vi.fn<VitestProcedure>(),
    admin: {
      stopImpersonating: vi.fn<VitestProcedure>(),
    },
  },
}));

vi.mock("@/lib/edition", () => ({
  clientEditionCapabilities: {
    hasBilling: true,
    hasInstanceAdmin: true,
    hasSupportAdmin: true,
  },
}));

vi.mock("@/orpc/hooks/billing", () => ({
  useBillingOverview: () => mocks.billingOverview,
  useSwitchWorkspace: () => ({
    isPending: false,
    mutateAsync: mocks.switchWorkspace,
  }),
}));

function installLocalStorageStub() {
  const store = new Map<string, string>();

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
}

function mockAdminSession() {
  mocks.getSession.mockResolvedValue({
    data: {
      session: {},
      user: {
        email: "admin@example.com",
        role: "admin",
      },
    },
  });
}

function renderWithRouter() {
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <AppSidebar />,
  });
  const agentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/agents",
    component: () => <div>Agents page</div>,
  });
  const adminLandingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin",
    component: () => <AppSidebar />,
  });
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/internal",
    component: () => <AppSidebar />,
  });
  const adminWorkspacesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/internal/workspaces",
    component: () => <AppSidebar />,
  });
  const adminMcpRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/internal/mcp",
    component: () => <AppSidebar />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      agentsRoute,
      adminLandingRoute,
      adminRoute,
      adminWorkspacesRoute,
      adminMcpRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(<RouterProvider router={router} />);

  return router;
}

function renderWithRouterAt(pathname: string) {
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    component: () => <AppSidebar />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });

  render(<RouterProvider router={router} />);

  return router;
}

describe("AppSidebar navigation", () => {
  beforeEach(() => {
    installLocalStorageStub();
    window.localStorage.clear();
    mocks.getSession.mockReset();
    mocks.switchWorkspace.mockReset();
    mocks.switchWorkspace.mockResolvedValue({ success: true });
    mockAdminSession();
  });

  afterEach(() => {
    cleanup();
  });

  it("navigates when a sidebar link is clicked", async () => {
    const router = renderWithRouter();

    fireEvent.click(await screen.findByRole("link", { name: "Agents" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/agents");
    });
  });

  it("opens the empty admin landing page from the admin sidebar action", async () => {
    const router = renderWithRouter();

    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/admin");
    });
  });

  it("opens internal tools from the account menu", async () => {
    const router = renderWithRouter();

    expect(screen.queryByRole("button", { name: "Internal" })).not.toBeInTheDocument();

    fireEvent.pointerDown(await screen.findByTitle("admin@example.com"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Internal" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/internal");
    });
  });

  it("renders the dedicated admin sidebar on admin pages", async () => {
    renderWithRouterAt("/admin/workspaces");

    const userManagementLink = await screen.findByRole("link", { name: "User Management" });
    const overviewLink = await screen.findByRole("link", { name: "Overview" });
    const auditLink = await screen.findByRole("link", { name: "Audit" });
    const workspacesLink = await screen.findByRole("link", { name: "Workspaces" });
    const subscriptionsLink = await screen.findByRole("link", { name: "AI Subscriptions" });
    const usageLink = await screen.findByRole("link", { name: "Usage" });

    expect(userManagementLink).not.toHaveClass("bg-sidebar-primary");
    expect(overviewLink).toBeInTheDocument();
    expect(auditLink).toBeInTheDocument();
    expect(workspacesLink).toHaveClass("bg-sidebar-primary");
    expect(subscriptionsLink).toBeInTheDocument();
    expect(usageLink).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "History" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "MCP" })).not.toBeInTheDocument();
  });

  it("does not keep the admin user item selected on nested admin pages", async () => {
    renderWithRouterAt("/internal/workspaces");

    const userLink = await screen.findByRole("link", { name: "User" });
    const workspacesLink = await screen.findByRole("link", { name: "Workspaces" });

    expect(userLink).not.toHaveClass("bg-sidebar-primary");
    expect(userLink).not.toHaveClass("text-sidebar-primary-foreground");
    expect(workspacesLink).toHaveClass("bg-sidebar-primary");
    expect(workspacesLink).toHaveClass("text-sidebar-primary-foreground");
  });

  it("renders the selected MCP logo with the active text color", async () => {
    renderWithRouterAt("/internal/mcp");

    const mcpLink = await screen.findByRole("link", { name: "MCP" });
    const mcpIcon = mcpLink.querySelector("span");

    expect(mcpLink).toHaveClass("bg-sidebar-primary");
    expect(mcpLink).toHaveClass("text-sidebar-primary-foreground");
    expect(mcpIcon).toHaveClass("bg-current");
    expect(mcpIcon).toHaveStyle({
      mask: "url('/integrations/mcp.svg') center / contain no-repeat",
    });
  });

  it("renders the active workspace identity at the top of the sidebar", async () => {
    renderWithRouterAt("/inbox");

    const switcher = await screen.findByRole("button", { name: "Switch workspace" });
    const image = switcher.querySelector("img");

    expect(switcher).toHaveAttribute("title", "Alpha");
    expect(image).toHaveAttribute("src", "/api/workspaces/ws-1/image?v=1");
  });

  it("switches workspaces from the sidebar switcher and keeps the current route", async () => {
    const router = renderWithRouterAt("/inbox?view=unread#top");

    fireEvent.pointerDown(await screen.findByRole("button", { name: "Switch workspace" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Beta/ }));

    await waitFor(() => {
      expect(mocks.switchWorkspace).toHaveBeenCalledWith("ws-2");
      expect(router.state.location.pathname).toBe("/inbox");
      expect(router.state.location.search).toEqual({ view: "unread" });
      expect(router.state.location.hash).toBe("top");
    });
  });
});
