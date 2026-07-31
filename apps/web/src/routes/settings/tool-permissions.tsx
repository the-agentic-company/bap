import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/tool-permissions")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/tool-permissions" });
  },
});
