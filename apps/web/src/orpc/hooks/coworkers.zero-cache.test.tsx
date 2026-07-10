// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCoworkerFolderList, useCoworkerRuns } from "./coworkers";

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
