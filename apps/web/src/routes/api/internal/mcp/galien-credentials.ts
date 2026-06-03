import { createFileRoute } from "@tanstack/react-router";
import { handleGalienCredentials } from "@/server/internal/mcp-credentials";

/** Thin server-route adapter for the internal Galien MCP credentials endpoint. */
export const Route = createFileRoute("/api/internal/mcp/galien-credentials")({
  server: {
    handlers: {
      POST: ({ request }) => handleGalienCredentials(request),
    },
  },
});
