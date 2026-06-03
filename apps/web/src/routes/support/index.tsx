import { createFileRoute } from "@tanstack/react-router";

/**
 * Support / help-center page. Migrated from Next `src/app/support/page.tsx`.
 * Static metadata moves from the Next `metadata` export to the route `head`.
 * URL is preserved exactly: /support.
 */
export const Route = createFileRoute("/support/")({
  head: () => ({
    meta: [
      { title: "Support - CmdClaw" },
      { name: "description", content: "Get help and support for CmdClaw" },
    ],
  }),
  component: SupportPage,
});

function SupportPage() {
  return (
    <div className="space-y-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Support</h1>
        <p className="text-muted-foreground">
          For any questions or assistance, please reach out to us via email.
        </p>
      </div>

      <a
        href="mailto:baptiste@cmdclaw.ai"
        className="text-primary text-lg font-medium hover:underline"
      >
        baptiste@cmdclaw.ai
      </a>
    </div>
  );
}
