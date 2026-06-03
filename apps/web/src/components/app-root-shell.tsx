import type React from "react";
import { AutumnProvider } from "autumn-js/react";
import { AppShellRouteWrapper } from "@/components/app-shell-route-wrapper";
import { DesktopNotificationPermissionGate } from "@/components/desktop-notification-permission-gate";
import { PostHogClientProvider } from "@/components/posthog-provider";
import { Toaster } from "@/components/ui/sonner";
import { env } from "@/env";
import { ORPCProvider } from "@/orpc/provider";

const isSelfHostedEdition = env.VITE_CMDCLAW_EDITION === "selfhost";

function BillingProviderWrapper({ children }: { children: React.ReactNode }) {
  if (isSelfHostedEdition) {
    return children;
  }

  return <AutumnProvider betterAuthUrl={env.VITE_APP_URL ?? ""}>{children}</AutumnProvider>;
}

export function AppRootShell({
  children,
  hasSession,
}: {
  children: React.ReactNode;
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
