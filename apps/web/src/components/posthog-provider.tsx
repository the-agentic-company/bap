import { useRouterState } from "@tanstack/react-router";
import type { PostHog } from "posthog-js";
import { PostHogProvider, usePostHog } from "posthog-js/react";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { env } from "@/env";
import { authClient } from "@/lib/auth-client";

const posthogKey = env.VITE_POSTHOG_KEY;
const posthogProxyPath = env.VITE_POSTHOG_HOST;
const isPosthogEnabled = Boolean(posthogKey);
let posthogInitialized = false;
let posthogModulesPromise: Promise<PostHogModules> | undefined;

type PostHogClient = PostHog;

type PostHogModules = {
  client: PostHogClient;
};

function loadPosthogModules(): Promise<PostHogModules> {
  posthogModulesPromise ??= import("posthog-js").then((posthogModule) => ({
    client: posthogModule.default as unknown as PostHogClient,
  }));

  return posthogModulesPromise;
}

function initializePosthog(posthogClient: PostHogClient) {
  if (!isPosthogEnabled || posthogInitialized) {
    return;
  }

  posthogClient.init(posthogKey!, {
    api_host: posthogProxyPath,
    defaults: "2026-01-30",
    capture_pageview: false,
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: true,
    },
    enable_recording_console_log: true,
  });

  posthogInitialized = true;
}

function PostHogPageView() {
  const posthogClient = usePostHog() as PostHogClient | undefined;
  const { pathname, searchStr } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      searchStr: state.location.searchStr,
    }),
  });
  const searchParams = useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);

  useEffect(() => {
    if (!posthogClient) {
      return;
    }
    const search = searchParams?.toString();
    const url = `${window.location.origin}${pathname}${search ? `?${search}` : ""}`;
    posthogClient.capture("$pageview", { $current_url: url });
  }, [posthogClient, pathname, searchParams]);

  return null;
}

function PostHogIdentify() {
  const posthogClient = usePostHog() as PostHogClient | undefined;

  useEffect(() => {
    if (!posthogClient) {
      return;
    }
    let cancelled = false;

    authClient
      .getSession()
      .then((res) => {
        if (cancelled) {
          return;
        }
        const user = res?.data?.user;
        if (!user) {
          posthogClient.reset();
          return;
        }
        const properties: Record<string, string> = {};
        if (user.email) {
          properties.email = user.email;
        }
        if ("name" in user && typeof user.name === "string" && user.name) {
          properties.name = user.name;
        }
        posthogClient.identify(user.id, properties);
      })
      .catch(() => {
        if (!cancelled) {
          posthogClient.reset();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [posthogClient]);

  return null;
}

type PostHogClientProviderProps = {
  children: ReactNode;
};

export function PostHogClientProvider({ children }: PostHogClientProviderProps) {
  const [posthogModules, setPosthogModules] = useState<PostHogModules | null>(null);

  useEffect(() => {
    if (!isPosthogEnabled) {
      return;
    }

    let cancelled = false;

    loadPosthogModules()
      .then((modules) => {
        initializePosthog(modules.client);
        if (!cancelled) {
          setPosthogModules(modules);
        }
      })
      .catch((error: unknown) => {
        console.error("[Analytics] Failed to load PostHog", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isPosthogEnabled) {
    return <>{children}</>;
  }

  if (!posthogModules || !posthogInitialized) {
    return <>{children}</>;
  }

  return (
    <PostHogProvider client={posthogModules.client}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogIdentify />
      {children}
    </PostHogProvider>
  );
}
