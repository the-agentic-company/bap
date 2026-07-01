import { createFileRoute } from "@tanstack/react-router";
import { sitemapHandler } from "./-seo/sitemap-handler";

/**
 * `/sitemap.xml`. The `[.]` in the file name escapes the literal dot so the public URL keeps its
 * `.xml` suffix. Thin TanStack Start adapter; the `<urlset>` build (home + hub + every vertical,
 * with hreflang alternates) lives in the framework-neutral handler. Public, no auth.
 */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) => sitemapHandler(request),
    },
  },
});
