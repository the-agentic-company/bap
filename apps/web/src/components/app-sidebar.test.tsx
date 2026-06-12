// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import { AppSidebar } from "./app-sidebar";

void jestDomVitest;

const mocks = vi.hoisted(() => ({
  pathname: "/inbox",
  navigate: vi.fn<VitestProcedure>(),
  getSession: vi.fn<VitestProcedure>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: mocks.pathname } }),
}));

vi.mock("@/components/app-link", () => ({
  AppLink: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

const INITIAL_ADMIN_PRINCIPAL = {
  userId: "user-1",
  activeWorkspaceId: "workspace-1",
  email: "admin@example.com",
  image: "/avatar.png",
  name: "Admin User",
  role: "admin",
} as const;

describe("AppSidebar", () => {
  beforeEach(() => {
    installLocalStorageStub();
    mocks.pathname = "/inbox";
    mocks.navigate.mockReset();
    mocks.getSession.mockReset();
    window.localStorage.clear();
    mockAdminSession();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows user navigation in user view", async () => {
    window.localStorage.setItem("cmdclaw.sidebarMode", "user");

    render(<AppSidebar />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "User view" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agents" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Coworkers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Templates" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Chat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Toolbox" })).not.toBeInTheDocument();
  });

  it("shows the full app navigation in admin view", async () => {
    render(<AppSidebar />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Admin view" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Templates" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Toolbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bug report" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admin" })).toBeInTheDocument();
  });

  it("renders admin navigation and avatar from the initial principal before client session resolves", () => {
    mocks.getSession.mockReturnValue(new Promise(() => undefined));

    render(<AppSidebar initialPrincipal={INITIAL_ADMIN_PRINCIPAL} />);

    expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Admin view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTitle("admin@example.com")).toBeInTheDocument();
    expect(document.querySelector('img[src="/avatar.png"]')).toBeInTheDocument();
  });

  it("routes between sidebar views from the toggle", async () => {
    render(<AppSidebar />);

    fireEvent.click(await screen.findByRole("button", { name: "User view" }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/inbox" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "User view" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Admin view" }));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Admin view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps admin route navigation on admin routes", async () => {
    mocks.pathname = "/admin";

    render(<AppSidebar />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Admin view" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    expect(screen.getByRole("link", { name: "Workspaces" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
  });
});
