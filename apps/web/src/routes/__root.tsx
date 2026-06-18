import type { TanStackDevtoolsReactPlugin } from "@tanstack/react-devtools";
import type { ReactNode } from "react";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { RouterAppContext } from "@/router";
import {
  GeneralTranslationProvider,
  getInitialAppLocale,
  localizedText,
} from "@/components/general-translation-provider";
import { RootErrorBoundary } from "@/components/root-error-boundary";
import { RootNotFound } from "@/components/root-not-found";
import { env } from "@/env";
// Local font assets set the "Geist" / "Geist Mono" font-family names that Tailwind resolves
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

// Client-exposed edition flag mirrors the server APP_EDITION (VITE_* is kept
// valid in v1) so head metadata and the body data-edition attribute resolve identically
// on the server and the client.
const edition = env.VITE_APP_EDITION ?? "cloud";
const isSelfHost = edition === "selfhost";
const TANSTACK_DEVTOOLS_CONFIG = { position: "bottom-right" } as const;
const TANSTACK_DEVTOOLS_PLUGINS: Array<TanStackDevtoolsReactPlugin> = [
  {
    name: "TanStack Router",
    render: <TanStackRouterDevtoolsPanel />,
  },
];
const CRITICAL_MOUNT_STYLE = `
:root {
  --border: oklch(0.922 0 0);
}
.dark {
  --border: oklch(1 0 0 / 10%);
}
*,
::before,
::after,
::backdrop,
::file-selector-button {
  border-color: var(--border, oklch(0.922 0 0));
}
`;
const CRITICAL_MOUNT_STYLE_HTML = { __html: CRITICAL_MOUNT_STYLE };

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        title: isSelfHost ? localizedText("Bap Self-hosted", { fr: "Bap auto-hébergé" }) : "Bap",
      },
      {
        name: "description",
        content: isSelfHost
          ? localizedText("Your self-hosted Bap deployment", {
              fr: "Votre déploiement Bap auto-hébergé",
            })
          : localizedText("Your AI Assistant", { fr: "Votre assistant IA" }),
      },
    ],
    links: [
      { rel: "preload", href: "/logo-sidebar.png", as: "image" },
      { rel: "icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  component: RootComponent,
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
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={getInitialAppLocale()}>
      {/* TanStack Start owns the full document; a real <head> element is required here. */}
      <head>
        <style dangerouslySetInnerHTML={CRITICAL_MOUNT_STYLE_HTML} />
        <HeadContent />
      </head>
      <body className="antialiased" data-edition={edition}>
        <GeneralTranslationProvider>{children}</GeneralTranslationProvider>
        <TanStackDevtools config={TANSTACK_DEVTOOLS_CONFIG} plugins={TANSTACK_DEVTOOLS_PLUGINS} />
        <Scripts />
      </body>
    </html>
  );
}
