import { Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { usePathname, useSearchParams } from "@/components/next-navigation-compat";
import { env } from "@/env";
import { authClient } from "@/lib/auth-client";

const posthogKey = env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogProxyPath = env.NEXT_PUBLIC_POSTHOG_HOST;
const isPosthogEnabled = Boolean(posthogKey);
let posthogInitialized = false;
let posthogModulesPromise: Promise<PostHogModules> | undefined;

type PostHogClient = {
  init: (
    key: string,
    options: {
      api_host: string | undefined;
      defaults: string;
      capture_pageview: boolean;
      capture_exceptions: {
        capture_unhandled_errors: boolean;
        capture_unhandled_rejections: boolean;
        capture_console_errors: boolean;
      };
      enable_recording_console_log: boolean;
    },
  ) => void;
  capture: (eventName: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, string>) => void;
  reset: () => void;
};

type PostHogReactModule = {
  PostHogProvider: ComponentType<{ client: PostHogClient; children: ReactNode }>;
  usePostHog: () => PostHogClient | undefined;
};

type PostHogModules = {
  client: PostHogClient;
  react: PostHogReactModule;
};

function loadPosthogModules(): Promise<PostHogModules> {
  posthogModulesPromise ??= Promise.all([import("posthog-js"), import("posthog-js/react")]).then(
    ([posthogModule, posthogReactModule]) => ({
      client: posthogModule.default as unknown as PostHogClient,
      react: posthogReactModule as unknown as PostHogReactModule,
    }),
  );

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

function PostHogPageView({ posthogReact }: { posthogReact: PostHogReactModule }) {
  // oxlint-disable-next-line react-compiler/react-compiler
  const posthogClient = posthogReact.usePostHog();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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

function PostHogIdentify({ posthogReact }: { posthogReact: PostHogReactModule }) {
  // oxlint-disable-next-line react-compiler/react-compiler
  const posthogClient = posthogReact.usePostHog();

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

  const PostHogProvider = posthogModules.react.PostHogProvider;

  return (
    <PostHogProvider client={posthogModules.client}>
      <Suspense fallback={null}>
        <PostHogPageView posthogReact={posthogModules.react} />
      </Suspense>
      <PostHogIdentify posthogReact={posthogModules.react} />
      {children}
    </PostHogProvider>
  );
}
