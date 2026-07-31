import type { ReactNode } from "react";
import type { SessionPrincipal } from "@/lib/route-guards";
import { AppRootShell } from "@/components/app-root-shell";
import { SessionActivityTracker } from "@/components/session-activity-tracker";

export function AuthenticatedAppRootShell({
  children,
  initialPrincipal = null,
}: {
  children: ReactNode;
  initialPrincipal?: SessionPrincipal | null;
}) {
  return (
    <AppRootShell hasSession initialPrincipal={initialPrincipal}>
      <SessionActivityTracker />
      {children}
    </AppRootShell>
  );
}
