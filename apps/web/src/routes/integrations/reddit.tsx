"use client";

import { createFileRoute } from "@tanstack/react-router";
import { AdminComingSoonPage } from "@/components/integrations/admin-coming-soon-page";

export const Route = createFileRoute("/integrations/reddit")({
  head: () => ({ meta: [{ title: "Reddit - CmdClaw" }] }),
  component: RedditIntegrationPage,
});

function RedditIntegrationPage() {
  return (
    <AdminComingSoonPage
      title="Reddit"
      description="Reddit integration is in progress and will be available soon."
    />
  );
}
