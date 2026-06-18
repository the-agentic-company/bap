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
  useRouterState,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCallback, useRef, useState } from "react";
import { useCoworkerEditorNavigation } from "./use-coworker-editor-navigation";
import type { CoworkerTab } from "./types";

void jestDomVitest;

let nextMountId = 0;

function EditorShellHarness() {
  const { pathname, search } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      search: state.location.search as { tab?: string; run?: string },
    }),
  });
  const mountId = useRef(++nextMountId);
  const routeBaseTab =
    search.tab === "runs" ||
    search.tab === "docs" ||
    search.tab === "instruction" ||
    search.tab === "toolbox" ||
    search.tab === "admin" ||
    search.tab === "chat"
      ? search.tab
      : null;
  const isNestedRunsRoute = pathname.startsWith("/agents/edit/slug-1/runs");
  const isRunsRoute = routeBaseTab === "runs" || isNestedRunsRoute;
  const [activeTab, setActiveTab] = useState<CoworkerTab>(routeBaseTab ?? "instruction");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(search.run ?? null);
  const { handleTabChange } = useCoworkerEditorNavigation({
    coworkerId: "coworker-1",
    coworkerRouteSlug: "slug-1",
    embedded: false,
    isMobile: false,
    isNestedRunsRoute,
    isRunsRoute,
    routeBaseTab,
    remoteTargetEnv: null,
    selectedRemoteUser: null,
    setActiveTab,
    setSelectedRunId,
    runCoworker: vi.fn<() => Promise<{ runId: string }>>(async () => ({ runId: "run-1" })),
  });
  const handleRunsClick = useCallback(() => {
    handleTabChange("runs");
  }, [handleTabChange]);
  const handleDocsClick = useCallback(() => {
    handleTabChange("docs");
  }, [handleTabChange]);

  return (
    <section aria-label="editor shell" data-mount-id={mountId.current}>
      <p>active:{activeTab}</p>
      <p>selected-run:{selectedRunId ?? "none"}</p>
      <button type="button" onClick={handleRunsClick}>
        Runs
      </button>
      <button type="button" onClick={handleDocsClick}>
        Docs
      </button>
    </section>
  );
}

function renderEditorRouter(initialEntry: string) {
  nextMountId = 0;

  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const editorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/agents/edit/$id",
    validateSearch: (search: Record<string, unknown>): { tab?: string; run?: string } => ({
      tab: typeof search.tab === "string" ? search.tab : undefined,
      run: typeof search.run === "string" ? search.run : undefined,
    }),
    component: EditorShellHarness,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([editorRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });

  render(<RouterProvider router={router} />);

  return router;
}

describe("useCoworkerEditorNavigation with router", () => {
  afterEach(() => {
    cleanup();
  });

  it("preserves the mounted editor shell when moving from Runs to Docs by search params", async () => {
    const router = renderEditorRouter("/agents/edit/slug-1?tab=runs");
    const shell = await screen.findByLabelText("editor shell");
    const initialMountId = shell.getAttribute("data-mount-id");

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));

    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: "docs" });
    });
    expect(screen.getByLabelText("editor shell")).toHaveAttribute("data-mount-id", initialMountId);
  });
});
