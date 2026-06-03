import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { listTemplateCatalogEntries } from "@/server/services/template-catalog";
import { TemplatesPageClient } from "./-templates/templates-page-client";

/**
 * Search schema for the template browser.
 *
 * `preview` is the modal preview template ID (behavior-affecting: it drives the desktop
 * preview modal and, on mobile, a redirect to the `/template/$id` detail route). It mirrors
 * the old `?preview=` query string so existing links keep working.
 */
interface TemplatesSearch {
  preview?: string;
}

/**
 * Server function that loads the template catalog for SSR bootstrap. The old Next page was a
 * server component that awaited `listTemplateCatalogEntries()` directly; in TanStack Start
 * this small SSR-critical list is loaded through the route loader (the page itself stays a
 * client component, and ongoing product data continues to use oRPC + React Query elsewhere).
 */
const loadTemplateCatalog = createServerFn({ method: "GET" }).handler(() =>
  listTemplateCatalogEntries(),
);

export const Route = createFileRoute("/_marketing/templates")({
  validateSearch: (search: Record<string, unknown>): TemplatesSearch => ({
    preview: typeof search.preview === "string" ? search.preview : undefined,
  }),
  loader: () => loadTemplateCatalog(),
  head: () => ({
    meta: [
      { title: "Templates · CmdClaw" },
      { name: "description", content: "Browse CmdClaw coworker templates." },
    ],
  }),
  component: TemplatesPage,
});

function TemplatesPage() {
  const templates = Route.useLoaderData();
  const { preview } = Route.useSearch();

  return <TemplatesPageClient templates={templates} previewId={preview ?? null} />;
}
