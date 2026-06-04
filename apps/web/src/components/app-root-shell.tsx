import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AppShellRouteWrapper } from "@/components/app-shell-route-wrapper";
import { DesktopNotificationPermissionGate } from "@/components/desktop-notification-permission-gate";
import { PostHogClientProvider } from "@/components/posthog-provider";
import { Toaster } from "@/components/ui/sonner";
import { env } from "@/env";
import { ORPCProvider } from "@/orpc/provider";

const isSelfHostedEdition = env.NEXT_PUBLIC_CMDCLAW_EDITION === "selfhost";

type AutumnProviderComponent = ComponentType<{
  betterAuthUrl: string;
  children: ReactNode;
}>;

let autumnProviderPromise: Promise<AutumnProviderComponent> | undefined;

function loadAutumnProvider(): Promise<AutumnProviderComponent> {
  autumnProviderPromise ??= import("autumn-js/react").then((module) => module.AutumnProvider);
  return autumnProviderPromise;
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

  return <AutumnProvider betterAuthUrl={env.NEXT_PUBLIC_APP_URL ?? ""}>{children}</AutumnProvider>;
}

export function AppRootShell({
  children,
  hasSession,
}: {
  children: ReactNode;
  hasSession: boolean;
}) {
  return (
    <PostHogClientProvider>
      <ORPCProvider>
        <BillingProviderWrapper>
          <DesktopNotificationPermissionGate enabled={hasSession} />
          <AppShellRouteWrapper initialHasSession={hasSession}>{children}</AppShellRouteWrapper>
          <Toaster />
        </BillingProviderWrapper>
      </ORPCProvider>
    </PostHogClientProvider>
  );
}
