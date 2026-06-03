import { createFileRoute } from "@tanstack/react-router";
import { handleModulrCredentials } from "@/server/internal/mcp-credentials";

/** Thin server-route adapter for the internal Modulr MCP credentials endpoint. */
export const Route = createFileRoute("/api/internal/mcp/modulr-credentials")({
  server: {
    handlers: {
      POST: ({ request }) => handleModulrCredentials(request),
    },
  },
});
