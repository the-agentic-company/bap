// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoworkerInfoPage } from "./coworker-info-page";

void jestDomVitest;

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

type MockCoworkerListItem = {
  id: string;
  name: string;
  description: string;
  username: string;
  folderId: string | null;
  recentRuns: unknown[];
  status: "on" | "off";
  updatedAt: Date;
};

type MockCoworkerData = {
  id: string;
  name: string;
  description: string;
  username: string;
  folderId: string | null;
};

const mocks = vi.hoisted<{
  searchStr: string;
  navigate: ReturnType<typeof vi.fn<VitestProcedure>>;
  coworkerListData: MockCoworkerListItem[];
  coworkerData: MockCoworkerData;
}>(() => ({
  searchStr: "",
  navigate: vi.fn<VitestProcedure>(),
  coworkerListData: [
    {
      id: "coworker-1",
      name: "Folder Coworker",
      description: "A coworker inside a folder",
      username: "folder-coworker",
      folderId: "folder-123",
      recentRuns: [],
      status: "on",
      updatedAt: new Date(),
    },
  ],
  coworkerData: {
    id: "coworker-1",
    name: "Folder Coworker",
    description: "A coworker inside a folder",
    username: "folder-coworker",
    folderId: "folder-123",
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { searchStr: string } }) => string;
  }) => select({ location: { searchStr: mocks.searchStr } }),
}));

vi.mock("gt-react", () => ({
  T: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("@/components/chat/chat-area", () => ({
  ChatArea: () => <div data-testid="chat-area" />,
}));

vi.mock("@/components/chat/agentic-app-selection", () => ({
  findLatestAgenticAppFile: () => null,
}));

vi.mock("@/components/chat/persisted-message-mapper", () => ({
  mapPersistedMessagesToChatMessages: () => [],
}));

vi.mock("@/components/chat/chat-share-controls", () => ({
  ChatShareControls: () => <div data-testid="share-controls" />,
}));

vi.mock("@/components/coworker-avatar", () => ({
  CoworkerAvatar: ({ username }: { username?: string | null }) => <div>{username ?? "avatar"}</div>,
}));

vi.mock("@/components/coworkers/remote-run-source-banner", () => ({
  extractRemoteRunSourceDetails: () => null,
  RemoteRunSourceBanner: () => null,
}));

vi.mock("@/components/ui/dual-panel-workspace", () => ({
  DualPanelWorkspace: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div>
      <div>{left}</div>
      <div>{right}</div>
    </div>
  ),
}));

vi.mock("@/orpc/hooks/conversation", () => ({
  useConversation: () => ({ data: { messages: [] } }),
  useDownloadSandboxFile: () => ({ mutateAsync: vi.fn<VitestProcedure>(), isPending: false }),
}));

vi.mock("@/orpc/hooks/coworkers", () => ({
  useCoworkerList: () => ({ data: mocks.coworkerListData, isLoading: false }),
  useCoworkerRuns: () => ({ data: [], isLoading: false }),
  useCoworkerRun: () => ({ data: undefined, isLoading: false }),
  useCoworker: () => ({ data: mocks.coworkerData }),
  useTriggerCoworker: () => ({ isPending: false, mutateAsync: vi.fn<VitestProcedure>() }),
}));

vi.mock("../-lib/app-link", () => ({
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

describe("CoworkerInfoPage back link", () => {
  beforeEach(() => {
    mocks.searchStr = "";
    mocks.coworkerListData = [
      {
        id: "coworker-1",
        name: "Folder Coworker",
        description: "A coworker inside a folder",
        username: "folder-coworker",
        folderId: "folder-123",
        recentRuns: [],
        status: "on",
        updatedAt: new Date(),
      },
    ];
    mocks.coworkerData = {
      id: "coworker-1",
      name: "Folder Coworker",
      description: "A coworker inside a folder",
      username: "folder-coworker",
      folderId: "folder-123",
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("links back to the coworker's folder when a folderId exists", () => {
    render(<CoworkerInfoPage coworkerSlug="folder-coworker" />);

    for (const link of screen.getAllByLabelText("Back to coworkers")) {
      expect(link).toHaveAttribute("href", "/agents/folders/folder-123");
    }
  });

  it("links back to the coworkers root when the coworker is not in a folder", () => {
    mocks.coworkerListData = [
      {
        id: "coworker-1",
        name: "Root Coworker",
        description: "A coworker at the root",
        username: "root-coworker",
        folderId: null,
        recentRuns: [],
        status: "on",
        updatedAt: new Date(),
      },
    ];
    mocks.coworkerData = {
      id: "coworker-1",
      name: "Root Coworker",
      description: "A coworker at the root",
      username: "root-coworker",
      folderId: null,
    };

    render(<CoworkerInfoPage coworkerSlug="root-coworker" />);

    for (const link of screen.getAllByLabelText("Back to coworkers")) {
      expect(link).toHaveAttribute("href", "/agents");
    }
  });
});
