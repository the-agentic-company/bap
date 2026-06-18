import { createFileRoute } from "@tanstack/react-router";
import { HomeLanding } from "@/components/landing/home-landing";
import { env } from "@/env";
import { fetchLandingData } from "./-landing-data";

/**
 * Landing page (`/`). Migrated from the previous `src/app/page.tsx` server component.
 *
 * - Nests under the public `_public` shell (no auth guard); the page renders for both
 *   anonymous and authenticated visitors, with `HomeLanding` switching its UI via
 *   `initialHasSession` exactly as the old page did.
 * - The `loader` runs the `fetchLandingData` server function, which resolves the session,
 *   preserves the worktree auto-login redirect for unauthenticated local-dev requests, and
 *   loads the featured template catalog (replaces the old server-component body).
 * - `head` reproduces the old page metadata (title, description, canonical, OpenGraph,
 *   Twitter card), edition-aware via the client-exposed `VITE_*` env names.
 */

const isSelfHostedEdition = env.VITE_APP_EDITION === "selfhost";
const siteUrl = env.VITE_APP_URL ?? "https://heybap.com";
const logoUrl = `${siteUrl.replace(/\/$/, "")}/logo.png`;

const title = isSelfHostedEdition ? "Bap Self-hosted" : "Bap";
const description = isSelfHostedEdition
  ? "Your self-hosted Bap deployment"
  : "Turn plain-English tasks into AI coworkers that run across your tools. Handle one-off work instantly or automate recurring workflows for your team.";

export const Route = createFileRoute("/_public/")({
  loader: () => fetchLandingData(),
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: siteUrl },
      { property: "og:site_name", content: "Bap" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: logoUrl },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: logoUrl },
    ],
    links: [{ rel: "canonical", href: siteUrl }],
  }),
  component: HomeRoute,
});

function HomeRoute() {
  const { initialHasSession, initialFirstName, featuredTemplates } = Route.useLoaderData();

  return (
    <HomeLanding
      initialHasSession={initialHasSession}
      initialFirstName={initialFirstName}
      featuredTemplates={featuredTemplates}
    />
  );
}
