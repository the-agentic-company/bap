import { createFileRoute } from "@tanstack/react-router";
import { ReadmePreviewDemo } from "./-readme-preview-demo";

/**
 * README preview (`/internal/readme-preview`).
 *
 * Internal/dev page that renders the animated README capture surface used for marketing
 * screenshots. No auth guard (internal pages were never in the old proxy `protectedRoutes`).
 * The demo component is colocated as `-readme-preview-demo.tsx` (the `-` prefix keeps it out
 * of the generated route tree).
 */
export const Route = createFileRoute("/internal/readme-preview")({
  head: () => ({
    meta: [{ title: "README Preview · CmdClaw" }],
  }),
  component: ReadmePreviewPage,
});

function ReadmePreviewPage() {
  return <ReadmePreviewDemo />;
}
