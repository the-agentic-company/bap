import { useEffect, useState, type ReactNode } from "react";
import type { SessionPrincipal } from "@/lib/route-guards";
import { AppShellRouteWrapper } from "@/components/app-shell-route-wrapper";
import { PostHogClientProvider } from "@/components/posthog-provider";
import { SessionPrincipalCacheGuard } from "@/components/session-principal-cache-guard";
import { Toaster } from "@/components/ui/sonner";
import { env } from "@/env";
import { ORPCProvider } from "@/orpc/provider";
import { CmdClawZeroProvider } from "@/zero/provider";

const isSelfHostedEdition = env.VITE_APP_EDITION === "selfhost";

type AutumnProviderComponent = (typeof import("autumn-js/react"))["AutumnProvider"];

let autumnProviderPromise: Promise<AutumnProviderComponent> | undefined;

function loadAutumnProvider(): Promise<AutumnProviderComponent> {
  autumnProviderPromise ??= import("autumn-js/react").then((module) => module.AutumnProvider);
  return autumnProviderPromise;
}

export function getAutumnBetterAuthUrl() {
  return env.VITE_APP_URL ?? (typeof window === "undefined" ? "" : window.location.origin);
}

function BillingProviderWrapper({ children }: { children: ReactNode }) {
  const [AutumnProvider, setAutumnProvider] = useState<AutumnProviderComponent | null>(null);

  useEffect(() => {
    if (isSelfHostedEdition) {
      return;
    }

    let cancelled = false;

    loadAutumnProvider()
      .then((Provider) => {
        if (!cancelled) {
          setAutumnProvider(() => Provider);
        }
      })
      .catch((error: unknown) => {
        console.error("[Billing] Failed to load Autumn provider", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (isSelfHostedEdition) {
    return children;
  }

  if (!AutumnProvider) {
    return children;
  }

  return (
    <AutumnProvider backendUrl={getAutumnBetterAuthUrl()} useBetterAuth>
      {children}
    </AutumnProvider>
  );
}

export function AppRootShell({
  children,
  hasSession,
  initialPrincipal = null,
}: {
  children: ReactNode;
  hasSession: boolean;
  initialPrincipal?: SessionPrincipal | null;
}) {
  return (
    <PostHogClientProvider>
      <ORPCProvider syncSessionUser={false}>
        <CmdClawZeroProvider hasSession={hasSession} principal={initialPrincipal}>
          <BillingProviderWrapper>
            <SessionPrincipalCacheGuard />
            <AppShellRouteWrapper
              initialHasSession={hasSession}
              initialPrincipal={initialPrincipal}
            >
              {children}
            </AppShellRouteWrapper>
            <Toaster />
          </BillingProviderWrapper>
        </CmdClawZeroProvider>
      </ORPCProvider>
    </PostHogClientProvider>
  );
}
