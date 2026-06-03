import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useMemo } from "react";
import { AnimatedTabs, AnimatedTab } from "@/components/ui/tabs";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { clientEditionCapabilities } from "@/lib/edition";
import { requireSession } from "@/lib/route-guards";

/**
 * Pathless layout route for the `/settings/**` shell.
 *
 * Replaces the old Next `settings/layout.tsx`. Shell selection is route nesting: every
 * settings page renders inside this tabbed layout via `<Outlet />`. The active tab is
 * derived from the TanStack router location instead of the old `next/navigation`
 * `usePathname` global switch.
 *
 * Access is protected: `beforeLoad` runs the shared session guard, redirecting
 * unauthenticated users to `/login` (or worktree auto-login) and returning them to the
 * originally requested settings path after sign-in.
 */
export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => requireSession(location.href),
  component: SettingsLayout,
});

function getActiveKey(pathname: string) {
  if (pathname.startsWith("/settings/workspace")) {
    return "workspace";
  }
  if (pathname.startsWith("/settings/usage")) {
    return "usage";
  }
  if (pathname.startsWith("/settings/billing")) {
    return "billing";
  }
  if (pathname.startsWith("/settings/subscriptions")) {
    return "subscriptions";
  }
  return "general";
}

function SettingsLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeKey = getActiveKey(pathname);
  const { isAdmin } = useIsAdmin();
  const settingsTabs = useMemo(
    () => [
      { key: "general", label: "General", href: "/settings" },
      { key: "workspace", label: "Workspace", href: "/settings/workspace" },
      ...(clientEditionCapabilities.hasBilling && isAdmin
        ? [
            { key: "usage", label: "Usage", href: "/settings/usage" },
            { key: "billing", label: "Billing", href: "/settings/billing" },
          ]
        : []),
      { key: "subscriptions", label: "Connected AI Account", href: "/settings/subscriptions" },
    ],
    [isAdmin],
  );

  return (
    <div className="bg-background min-h-full">
      <main className="mx-auto w-full max-w-4xl px-4 pt-8 pb-10 md:px-6 md:pt-10">
        <div className="-mx-4 mb-6 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:overflow-x-visible md:px-0 [&::-webkit-scrollbar]:hidden">
          <AnimatedTabs activeKey={activeKey}>
            {settingsTabs.map((tab) => (
              <AnimatedTab key={tab.key} value={tab.key} href={tab.href}>
                {tab.label}
              </AnimatedTab>
            ))}
          </AnimatedTabs>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
