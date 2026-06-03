// Production Node host for the TanStack Start build output.
//
// `bun run build` (vite build) emits a web-fetch request handler at
// dist/server/server.js (default export `{ fetch }`) plus static client assets in
// dist/client. This wrapper serves that handler over HTTP using srvx, which honors the
// `PORT` / `HOST` environment variables Render provides (defaults: port 3000, all
// interfaces). Render's start command runs `node server-node.mjs`.
//
// Observability is initialized here at process startup (production only) so the web
// service keeps exporting logs/metrics/traces, matching the old Next.js instrumentation
// behavior. Dev gating is preserved: this host only runs for the production build.

import { serve } from "srvx";
import { serveStatic } from "srvx/static";
import { fileURLToPath } from "node:url";

if (process.env.NODE_ENV === "production") {
  try {
    const { initializeObservabilityRuntime } =
      await import("@cmdclaw/core/server/utils/observability");
    initializeObservabilityRuntime("cmdclaw-web");
  } catch (error) {
    console.error("[observability] Failed to initialize web observability runtime", error);
  }
}

const entry = await import("./dist/server/server.js");
const handler = entry.default ?? entry;

const port = process.env.PORT ?? 3000;
const hostname = process.env.HOST ?? undefined;

// Vite emits the built client assets (icons, logos, manifest, /sw.js, well-known files, JS
// chunks) to dist/client. The TanStack fetch handler only renders app/API routes, so the
// host serves dist/client first and falls through to the handler for everything else.
const clientDir = fileURLToPath(new URL("./dist/client", import.meta.url));

serve({
  middleware: [serveStatic({ dir: clientDir })],
  fetch: (request) => handler.fetch(request),
  port,
  hostname,
});

console.info(`[web] TanStack Start server listening on ${hostname ?? "0.0.0.0"}:${port}`);
