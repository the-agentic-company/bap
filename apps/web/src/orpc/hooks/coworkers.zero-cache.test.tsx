// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CoworkerListData,
  useCoworkerFolderList,
  useCoworkerList,
  useCoworkerRuns,
} from "./coworkers";

type QueryDetails = { type: "unknown" | "complete" | "error"; error?: Error };

const mocks = vi.hoisted(() => ({
  runtime: {
    error: null as Error | null,
    isReady: true,
    isResolvingWorkspace: false,
    userId: "user-1" as string | null,
    workspaceId: "workspace-1",
  },
  zeroResult: [[], { type: "unknown" } satisfies QueryDetails] as [unknown[], QueryDetails],
  listRuns: vi.fn<() => Promise<unknown[]>>(),
}));

vi.mock("@rocicorp/zero/react", () => ({
  useQuery: () => mocks.zeroResult,
}));

vi.mock("@/zero/provider", () => ({
  useBapZeroRuntime: () => mocks.runtime,
}));

vi.mock("@/zero/queries", () => ({
  zeroQueries: {
    coworkerInventory: {
      coworkers: () => ({ table: "coworker" }),
      folders: () => ({ table: "coworkerFolder" }),
      runsByCoworker: () => ({ table: "coworkerRun" }),
    },
  },
}));

vi.mock("@/zero/coworker-data", () => ({
  mapZeroCoworkerFolders: (folders: unknown[]) => folders,
  mapZeroCoworkerList: (coworkers: unknown[]) => coworkers,
  mapZeroCoworkerRun: (run: unknown) => run,
}));

vi.mock("../client", () => ({
  client: {
    coworker: {
      listRuns: mocks.listRuns,
    },
  },
}));

function setRuntimeIdentity(userId: string, workspaceId: string) {
  mocks.runtime.userId = userId;
  mocks.runtime.workspaceId = workspaceId;
}

function coworkerRow(
  id: string,
  name: string,
  updatedAt: Date,
  overrides: Partial<CoworkerListData[number]> = {},
): CoworkerListData[number] {
  return {
    id,
    name,
    ownerId: "user-1",
    createdByUserId: "user-1",
    createdByNameSnapshot: null,
    createdByAvatarSnapshot: null,
    description: null,
    username: null,
    folderId: null,
    status: "on",
    disabledReason: null,
    disabledAt: null,
    autoApprove: true,
    model: "openai/gpt-5.5",
    authSource: null,
    triggerType: "manual",
    integrations: [],
    toolAccessMode: "all",
    allowedIntegrations: [],
    allowedCustomIntegrations: [],
    allowedWorkspaceMcpServerIds: [],
    allowedSkillSlugs: [],
    schedule: null,
    requiresUserInput: false,
    userInputPrompt: null,
    isPinned: false,
    isHidden: false,
    preferencePosition: null,
    visibility: "private",
    automationOwnerUserId: null,
    automationOwnerConsentedAt: null,
    configurationRevision: 0,
    sharedAt: null,
    updatedAt,
    lastRunStatus: "",
    lastRunAt: new Date(0),
    recentRuns: [],
    ...overrides,
  };
}

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("coworker Zero inventory hooks", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.runtime.error = null;
    mocks.runtime.isReady = true;
    mocks.runtime.isResolvingWorkspace = false;
    setRuntimeIdentity("user-1", "workspace-1");
    mocks.zeroResult = [[], { type: "unknown" }];
    mocks.listRuns.mockResolvedValue([]);
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps folder inventory visible from memory while Zero revalidates", async () => {
    const folder = {
      id: "folder-1",
      name: "Analysis",
      updatedAt: new Date("2026-06-18T10:00:00.000Z"),
    };
    mocks.zeroResult = [[folder], { type: "complete" }];
    const { result, rerender } = renderHook(() => useCoworkerFolderList());

    expect(result.current.data).toEqual([folder]);
    expect(result.current.isLoading).toBe(false);

    mocks.zeroResult = [[], { type: "unknown" }];
    rerender();

    expect(result.current.data).toEqual([folder]);
    expect(result.current.isLoading).toBe(false);
  });

  it("uses initial folder inventory while Zero starts", () => {
    setRuntimeIdentity("user-2", "workspace-2");
    const folder = {
      id: "folder-2",
      workspaceId: "workspace-2",
      ownerId: "user-2",
      parentId: null,
      name: "Cached folder",
      visibility: "private" as const,
      position: 0,
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
      updatedAt: new Date("2026-06-18T10:00:00.000Z"),
    };
    mocks.zeroResult = [[], { type: "unknown" }];

    const { result } = renderHook(() => useCoworkerFolderList({ initialData: [folder] }));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]?.name).toBe("Cached folder");
    expect(result.current.isLoading).toBe(false);
  });

  it("keeps fresher initial coworkers while a partial Zero snapshot revalidates", () => {
    setRuntimeIdentity("user-2", "workspace-2");
    const staleExistingCoworker = coworkerRow(
      "coworker-1",
      "Stale existing coworker",
      new Date("2026-06-18T09:00:00.000Z"),
    );
    const freshExistingCoworker = coworkerRow(
      "coworker-1",
      "Fresh existing coworker",
      new Date("2026-06-18T10:00:00.000Z"),
    );
    const newlyCreatedCoworker = coworkerRow(
      "coworker-2",
      "New coworker",
      new Date("2026-06-18T10:01:00.000Z"),
    );
    mocks.zeroResult = [[staleExistingCoworker], { type: "unknown" }];

    const { result } = renderHook(() =>
      useCoworkerList({ initialData: [freshExistingCoworker, newlyCreatedCoworker] }),
    );

    expect(result.current.data.map((coworker) => coworker.id)).toEqual([
      "coworker-1",
      "coworker-2",
    ]);
    expect(result.current.data[0]?.name).toBe("Fresh existing coworker");
    expect(result.current.isFetching).toBe(true);
  });

  it("keeps the completed Zero snapshot authoritative during later revalidation", () => {
    setRuntimeIdentity("user-3", "workspace-3");
    const existingCoworker = coworkerRow(
      "coworker-1",
      "Existing coworker",
      new Date("2026-06-18T10:00:00.000Z"),
    );
    const removedCoworker = coworkerRow(
      "coworker-2",
      "Removed coworker",
      new Date("2026-06-18T09:00:00.000Z"),
    );
    mocks.zeroResult = [[existingCoworker], { type: "complete" }];

    const { result, rerender, unmount } = renderHook(() =>
      useCoworkerList({ initialData: [existingCoworker, removedCoworker] }),
    );

    expect(result.current.data.map((coworker) => coworker.id)).toEqual(["coworker-1"]);
    expect(result.current.isFetching).toBe(false);

    mocks.zeroResult = [[existingCoworker], { type: "unknown" }];
    rerender();

    expect(result.current.data.map((coworker) => coworker.id)).toEqual(["coworker-1"]);
    expect(result.current.isFetching).toBe(true);

    unmount();
    const newlyCreatedCoworker = coworkerRow(
      "coworker-3",
      "New coworker",
      new Date("2026-06-18T11:00:00.000Z"),
    );
    const remounted = renderHook(() =>
      useCoworkerList({ initialData: [existingCoworker, newlyCreatedCoworker] }),
    );

    expect(remounted.result.current.data.map((coworker) => coworker.id)).toEqual([
      "coworker-1",
      "coworker-3",
    ]);
  });

  it("retains a partial Zero snapshot through an empty revalidation", () => {
    setRuntimeIdentity("user-4", "workspace-4");
    const existingCoworker = coworkerRow(
      "coworker-1",
      "Existing coworker",
      new Date("2026-06-18T10:00:00.000Z"),
    );
    mocks.zeroResult = [[existingCoworker], { type: "unknown" }];

    const { result, rerender } = renderHook(() => useCoworkerList());
    expect(result.current.data.map((coworker) => coworker.id)).toEqual(["coworker-1"]);

    mocks.zeroResult = [[], { type: "unknown" }];
    rerender();

    expect(result.current.data.map((coworker) => coworker.id)).toEqual(["coworker-1"]);
    expect(result.current.isFetching).toBe(true);
  });

  it("uses Zero as the sole coworker runs read path", async () => {
    const startedAt = new Date("2026-06-27T04:23:28.807Z");
    mocks.zeroResult = [
      [
        {
          id: "run-1",
          coworkerId: "coworker-1",
          status: "error",
          failureKind: "runner_declared_failure",
          generationId: "generation-1",
          conversationId: "conversation-1",
          startedAt,
          finishedAt: null,
          errorMessage: null,
          source: "manual",
        },
      ],
      { type: "complete" },
    ];
    mocks.listRuns.mockResolvedValue([
      {
        id: "fallback-run",
        coworkerId: "coworker-1",
        status: "completed",
        failureKind: null,
        generationId: "fallback-generation",
        conversationId: "fallback-conversation",
        startedAt,
        finishedAt: null,
        errorMessage: null,
        source: "manual",
      },
    ]);

    const { result } = renderHook(() => useCoworkerRuns("coworker-1"), {
      wrapper: createQueryWrapper(),
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]?.id).toBe("run-1");
    expect(mocks.listRuns).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});
