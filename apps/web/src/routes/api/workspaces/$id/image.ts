import { createFileRoute } from "@tanstack/react-router";
import { downloadWorkspaceImage } from "@/server/api/workspaces/image";

export const Route = createFileRoute("/api/workspaces/$id/image")({
  server: {
    handlers: {
      GET: ({ request, params }) => downloadWorkspaceImage(request, params.id),
    },
  },
});
