// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCoworkerEditorNavigation } from "./use-coworker-editor-navigation";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<(options: unknown) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

function renderNavigationHook(
  overrides: Partial<Parameters<typeof useCoworkerEditorNavigation>[0]> = {},
) {
  const input = {
    coworkerId: "coworker-1",
    coworkerRouteSlug: "slug-1",
    embedded: false,
    isMobile: false,
    isNestedRunsRoute: false,
    isRunsRoute: false,
    routeBaseTab: "instruction",
    remoteTargetEnv: null,
    selectedRemoteUser: null,
    setActiveTab: vi.fn<(tab: unknown) => void>(),
    setSelectedRunId: vi.fn<(runId: unknown) => void>(),
    runCoworker: vi.fn<() => Promise<{ runId: string }>>(async () => ({ runId: "run-1" })),
    ...overrides,
  } satisfies Parameters<typeof useCoworkerEditorNavigation>[0];

  return {
    input,
    hook: renderHook(() => useCoworkerEditorNavigation(input)),
  };
}

describe("useCoworkerEditorNavigation", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
  });

  it("updates the runs tab through relative search navigation", () => {
    const { hook } = renderNavigationHook();

    act(() => {
      hook.result.current.handleTabChange("runs");
    });

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: ".",
      search: { tab: "runs" },
      replace: true,
    });
  });

  it("updates non-runs tabs through relative search navigation", () => {
    const { hook } = renderNavigationHook({ routeBaseTab: "instruction" });

    act(() => {
      hook.result.current.handleTabChange("docs");
    });

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: ".",
      search: { tab: "docs" },
      replace: true,
    });
  });

  it("leaves nested runs routes through the editor route", () => {
    const { hook } = renderNavigationHook({
      isNestedRunsRoute: true,
      isRunsRoute: true,
      routeBaseTab: null,
    });

    act(() => {
      hook.result.current.handleTabChange("docs");
    });

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/agents/edit/$id",
      params: { id: "slug-1" },
      search: { tab: "docs" },
      replace: true,
    });
  });

  it("leaves search-param runs tabs through relative search navigation", () => {
    const { hook } = renderNavigationHook({ isRunsRoute: true, routeBaseTab: "runs" });

    act(() => {
      hook.result.current.handleTabChange("docs");
    });

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: ".",
      search: { tab: "docs" },
      replace: true,
    });
  });

  it("navigates selected runs through editor search params", () => {
    const { hook } = renderNavigationHook();

    act(() => {
      hook.result.current.handleSelectRun("run-2");
    });

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: ".",
      search: { tab: "runs", run: "run-2" },
    });
  });
});
