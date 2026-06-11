import { createFileRoute } from "@tanstack/react-router";
import { handleZeroQueryRequest } from "@/server/zero/query";

export const Route = createFileRoute("/api/zero/query")({
  server: {
    handlers: {
      POST: ({ request }) => handleZeroQueryRequest(request),
    },
  },
});
