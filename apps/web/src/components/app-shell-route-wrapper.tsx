"use client";

import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { usePathname, useRouter } from "@/components/next-navigation-compat";
import { AppShell, type SidebarVisibility } from "@/components/app-shell";
import { useCurrentUser } from "@/orpc/hooks";

type AppShellRouteWrapperProps = {
  children: React.ReactNode;
  initialHasSession: boolean;
};

function getSidebarVisibility(pathname: string | null): SidebarVisibility | null {
  if (!pathname) {
    return null;
  }

  if (
    pathname === "/" ||
    pathname === "/template" ||
    pathname === "/templates" ||
    pathname.startsWith("/template/")
  ) {
    return "authenticated";
  }

  if (
    pathname.startsWith("/chat") ||
    pathname.startsWith("/agents") ||
    pathname.startsWith("/inbox") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/integrations") ||
    pathname.startsWith("/skills") ||
    pathname.startsWith("/toolbox") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/instance") ||
    pathname.startsWith("/search") ||
    pathname.startsWith("/bug-report")
  ) {
    return "always";
  }

  return null;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: user, isLoading: userLoading, isFetching: userFetching } = useCurrentUser();
  const shouldWaitForFreshUser = Boolean(user && !user.onboardedAt && userFetching);
  const shouldEnforceOnboarding = false;

  useEffect(() => {
    // Temporarily disable the onboarding redirect while iterating on the post-connection flow.
    if (shouldEnforceOnboarding && !userLoading && !userFetching && user && !user.onboardedAt) {
      router.replace("/onboarding/subscriptions");
    }
  }, [shouldEnforceOnboarding, userFetching, userLoading, user, router]);

  if (
    shouldEnforceOnboarding &&
    (userLoading || shouldWaitForFreshUser || (user && !user.onboardedAt))
  ) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }

  return children;
}

export function AppShellRouteWrapper({ children, initialHasSession }: AppShellRouteWrapperProps) {
  const pathname = usePathname();
  const sidebarVisibility = getSidebarVisibility(pathname);

  if (!sidebarVisibility) {
    return children;
  }

  // "always" visibility means the user is on an authenticated route —
  // enforce onboarding completion before rendering
  if (sidebarVisibility === "always") {
    return (
      <AppShell sidebarVisibility={sidebarVisibility} initialHasSession={initialHasSession}>
        <OnboardingGuard>{children}</OnboardingGuard>
      </AppShell>
    );
  }

  return (
    <AppShell sidebarVisibility={sidebarVisibility} initialHasSession={initialHasSession}>
      {children}
    </AppShell>
  );
}
