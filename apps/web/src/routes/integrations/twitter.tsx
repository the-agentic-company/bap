"use client";

import { createFileRoute } from "@tanstack/react-router";
import { AdminComingSoonPage } from "@/components/integrations/admin-coming-soon-page";

export const Route = createFileRoute("/integrations/twitter")({
  head: () => ({ meta: [{ title: "X (Twitter) - CmdClaw" }] }),
  component: TwitterIntegrationPage,
});

function TwitterIntegrationPage() {
  return (
    <AdminComingSoonPage
      title="X (Twitter)"
      description="X (Twitter) integration is in progress and will be available soon."
    />
  );
}
