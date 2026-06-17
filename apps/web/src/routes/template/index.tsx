import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /template — redirect-only route (was src/app/template/page.tsx, which called
 * `redirect("/templates")`).
 *
 * The redirect runs in `beforeLoad` so it happens before any render (matching the previous
 * server-component redirect). The `/templates` browser lives under the public shell.
 */
export const Route = createFileRoute("/template/")({
  beforeLoad: () => {
    throw redirect({ to: "/templates" });
  },
});
