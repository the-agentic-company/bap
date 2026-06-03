import { createFileRoute } from "@tanstack/react-router";
import { handleRuntimeCredentials } from "@/server/internal/mcp-credentials";

/** Thin server-route adapter for the internal runtime MCP credentials endpoint. */
export const Route = createFileRoute("/api/internal/mcp/runtime-credentials")({
  server: {
    handlers: {
      POST: ({ request }) => handleRuntimeCredentials(request),
    },
  },
});
