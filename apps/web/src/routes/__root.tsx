import type { ReactNode } from "react";
import type { TanStackDevtoolsReactPlugin } from "@tanstack/react-devtools";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { RouterAppContext } from "@/router";
import { AppRootShell } from "@/components/app-root-shell";
import { RootErrorBoundary } from "@/components/root-error-boundary";
import { RootNotFound } from "@/components/root-not-found";
import { SessionPrincipalCacheGuard } from "@/components/session-principal-cache-guard";
import { env } from "@/env";
import { fetchSessionContext } from "@/lib/route-guards";
// Local font assets (replaces next/font Geist / Geist_Mono). These set the
// "Geist" / "Geist Mono" font-family names that the Tailwind font tokens resolve to
// via the --font-geist-sans / --font-geist-mono CSS variables in globals.css.
// oxlint-disable no-unassigned-import
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
// Global app styles. Moved from src/app/globals.css to a framework-neutral location.
import "@/styles/globals.css";
// oxlint-enable no-unassigned-import

// Client-exposed edition flag mirrors the server CMDCLAW_EDITION so head metadata and
// the body data-edition attribute resolve identically on the server and the client.
const edition = env.VITE_CMDCLAW_EDITION ?? "cloud";
const isSelfHost = edition === "selfhost";
const TANSTACK_DEVTOOLS_CONFIG = { position: "bottom-right" } as const;
const TANSTACK_DEVTOOLS_PLUGINS: Array<TanStackDevtoolsReactPlugin> = [
  {
    name: "TanStack Router",
    render: <TanStackRouterDevtoolsPanel />,
  },
];

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        title: isSelfHost ? "CmdClaw Self-hosted" : "CmdClaw",
      },
      {
        name: "description",
        content: isSelfHost ? "Your self-hosted CmdClaw deployment" : "Your AI Assistant",
      },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  errorComponent: ({ error }) => (
    <RootDocument>
      <RootErrorBoundary error={error} />
    </RootDocument>
  ),
  notFoundComponent: () => (
    <RootDocument>
      <RootNotFound />
    </RootDocument>
  ),
  loader: async () => {
    const context = await fetchSessionContext();
    return { hasSession: Boolean(context.principal) };
  },
  component: RootComponent,
});

function RootComponent() {
  const { hasSession } = Route.useLoaderData();

  return (
    <RootDocument>
      <AppRootShell hasSession={hasSession}>
        <Outlet />
      </AppRootShell>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      {/* TanStack Start owns the full document; a real <head> element is required here.
          The Next-specific no-head-element rule is a false positive for TanStack Start and
          is dropped when Next lint integration is removed in a later phase. */}
      {/* oxlint-disable-next-line nextjs/no-head-element */}
      <head>
        <HeadContent />
      </head>
      <body className="antialiased" data-edition={edition}>
        <SessionPrincipalCacheGuard />
        {children}
        {import.meta.env.DEV ? (
          <TanStackDevtools config={TANSTACK_DEVTOOLS_CONFIG} plugins={TANSTACK_DEVTOOLS_PLUGINS} />
        ) : null}
        <Scripts />
      </body>
    </html>
  );
}
