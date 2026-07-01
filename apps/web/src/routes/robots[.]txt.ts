import { createFileRoute } from "@tanstack/react-router";
import { robotsHandler } from "./-seo/robots-handler";

/**
 * `/robots.txt`. The `[.]` in the file name escapes the literal dot so the public URL keeps its
 * `.txt` suffix. Thin TanStack Start adapter; the allow-all body + request-derived `Sitemap:`
 * line live in the framework-neutral handler. Public, no auth.
 */
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => robotsHandler(request),
    },
  },
});
