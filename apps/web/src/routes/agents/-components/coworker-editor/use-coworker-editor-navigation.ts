import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import type { CoworkerTab, RemoteIntegrationTargetEnv, RemoteIntegrationUserOption } from "./types";

type CoworkerRunStartResult = {
  runId?: string | null;
} | null;

type UseCoworkerEditorNavigationInput = {
  coworkerId?: string;
  coworkerRouteSlug?: string;
  embedded: boolean;
  isMobile: boolean;
  isNestedRunsRoute: boolean;
  isRunsRoute: boolean;
  routeBaseTab: CoworkerTab | null;
  remoteTargetEnv: RemoteIntegrationTargetEnv | null;
  selectedRemoteUser: RemoteIntegrationUserOption | null;
  setActiveTab: Dispatch<SetStateAction<CoworkerTab>>;
  setSelectedRunId: Dispatch<SetStateAction<string | null>>;
  runCoworker: (options?: {
    remoteIntegrationSource?: {
      targetEnv: RemoteIntegrationTargetEnv;
      remoteUserId: string;
    };
  }) => Promise<CoworkerRunStartResult>;
};

export function useCoworkerEditorNavigation({
  coworkerId,
  coworkerRouteSlug,
  embedded,
  isMobile,
  isNestedRunsRoute,
  isRunsRoute,
  routeBaseTab,
  remoteTargetEnv,
  selectedRemoteUser,
  setActiveTab,
  setSelectedRunId,
  runCoworker,
}: UseCoworkerEditorNavigationInput) {
  const t = useGT();
  const navigate = useNavigate();

  const navigateToCoworkerRun = useCallback(
    (runId: string, options?: { replace?: boolean }) => {
      if (!coworkerId) {
        void navigate({ to: "/agents", replace: options?.replace });
        return;
      }

      void navigate({
        to: "/agents/info/$slug",
        params: { slug: coworkerRouteSlug ?? coworkerId },
        search: { run: runId },
        replace: options?.replace,
      });
    },
    [coworkerId, coworkerRouteSlug, navigate],
  );

  const navigateToCoworkerEditor = useCallback(
    (tab?: Exclude<CoworkerTab, "runs"> | null, options?: { replace?: boolean }) => {
      if (!coworkerId) {
        void navigate({ to: "/agents", replace: options?.replace });
        return;
      }

      if (embedded) {
        void navigate({
          to: "/agents",
          search: {
            agent: coworkerId,
            tab: tab && tab !== "instruction" ? tab : undefined,
          },
          replace: options?.replace,
        });
        return;
      }

      if (!tab || tab === "instruction") {
        if (isNestedRunsRoute) {
          void navigate({
            to: "/agents/edit/$id",
            params: { id: coworkerRouteSlug ?? coworkerId },
            replace: options?.replace,
          });
          return;
        }

        void navigate({ to: ".", search: {}, replace: options?.replace });
        return;
      }

      if (isNestedRunsRoute) {
        void navigate({
          to: "/agents/edit/$id",
          params: { id: coworkerRouteSlug ?? coworkerId },
          search: { tab },
          replace: options?.replace,
        });
        return;
      }

      void navigate({ to: ".", search: { tab }, replace: options?.replace });
    },
    [coworkerId, coworkerRouteSlug, embedded, isNestedRunsRoute, navigate],
  );

  const navigateToCoworkerPanel = useCallback(
    (options?: { runId?: string | null; replace?: boolean }) => {
      if (!coworkerId) {
        void navigate({ to: "/agents", replace: options?.replace });
        return;
      }

      if (embedded) {
        void navigate({
          to: "/agents",
          search: { agent: coworkerId, tab: "runs", run: options?.runId ?? undefined },
          replace: options?.replace,
        });
        return;
      }

      if (options?.runId) {
        if (isNestedRunsRoute) {
          void navigate({
            to: "/agents/edit/$id",
            params: { id: coworkerRouteSlug ?? coworkerId },
            search: { tab: "runs", run: options.runId },
            replace: options.replace,
          });
          return;
        }

        void navigate({
          to: ".",
          search: { tab: "runs", run: options.runId },
          replace: options.replace,
        });
        return;
      }

      if (isNestedRunsRoute) {
        void navigate({
          to: "/agents/edit/$id",
          params: { id: coworkerRouteSlug ?? coworkerId },
          search: { tab: "runs" },
          replace: options?.replace,
        });
        return;
      }

      void navigate({ to: ".", search: { tab: "runs" }, replace: options?.replace });
    },
    [coworkerId, coworkerRouteSlug, embedded, isNestedRunsRoute, navigate],
  );

  const handleRunClick = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();

      const result = await runCoworker();
      if (!result?.runId) {
        return;
      }

      setSelectedRunId(result.runId);
      if (embedded) {
        return;
      }
      navigateToCoworkerRun(result.runId, { replace: true });
    },
    [embedded, navigateToCoworkerRun, runCoworker, setSelectedRunId],
  );

  const handleRemoteRunClick = useCallback(async () => {
    if (!remoteTargetEnv || !selectedRemoteUser) {
      toast.error(t("Select a remote environment and a remote user first."));
      return;
    }

    const result = await runCoworker({
      remoteIntegrationSource: {
        targetEnv: remoteTargetEnv,
        remoteUserId: selectedRemoteUser.id,
      },
    });
    if (!result?.runId) {
      return;
    }

    setSelectedRunId(result.runId);
    if (embedded) {
      return;
    }
    navigateToCoworkerRun(result.runId, { replace: true });
  }, [
    embedded,
    navigateToCoworkerRun,
    remoteTargetEnv,
    runCoworker,
    selectedRemoteUser,
    setSelectedRunId,
    t,
  ]);

  const handleTabChange = useCallback(
    (key: string) => {
      const nextTab = (key === "runs" ? "instruction" : key) as CoworkerTab;
      setActiveTab(nextTab);
      setSelectedRunId(null);

      if (!coworkerId || embedded) {
        return;
      }

      if (isMobile) {
        if (isRunsRoute || routeBaseTab !== nextTab) {
          navigateToCoworkerEditor(nextTab, { replace: true });
        }
        return;
      }

      if (isRunsRoute || routeBaseTab !== nextTab) {
        navigateToCoworkerEditor(nextTab, { replace: true });
      }
    },
    [
      coworkerId,
      embedded,
      isMobile,
      isRunsRoute,
      navigateToCoworkerEditor,
      routeBaseTab,
      setActiveTab,
      setSelectedRunId,
    ],
  );

  const handleSelectRun = useCallback(
    (runId: string) => {
      setActiveTab("instruction");
      setSelectedRunId(runId);
      if (embedded) {
        return;
      }
      navigateToCoworkerRun(runId);
    },
    [embedded, navigateToCoworkerRun, setActiveTab, setSelectedRunId],
  );

  const handleBackToRuns = useCallback(() => {
    setActiveTab("runs");
    setSelectedRunId(null);
    if (embedded) {
      return;
    }
    navigateToCoworkerPanel({ replace: true });
  }, [embedded, navigateToCoworkerPanel, setActiveTab, setSelectedRunId]);

  return {
    handleRunClick,
    handleRemoteRunClick,
    handleTabChange,
    handleSelectRun,
    handleBackToRuns,
  };
}
