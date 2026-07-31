import { createFileRoute } from "@tanstack/react-router";
import { handleWorkspaceMcpPolicyProxy } from "@/server/internal/workspace-mcp-policy-proxy";

export const Route = createFileRoute("/api/internal/workspace-mcp-proxy/$workspaceMcpServerId")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleWorkspaceMcpPolicyProxy(request, params.workspaceMcpServerId),
      POST: ({ request, params }) =>
        handleWorkspaceMcpPolicyProxy(request, params.workspaceMcpServerId),
      DELETE: ({ request, params }) =>
        handleWorkspaceMcpPolicyProxy(request, params.workspaceMcpServerId),
    },
  },
});
