import { createFileRoute } from "@tanstack/react-router";
import { handleInterruptStatus } from "@/server/internal/runtime-interrupts";

/** Thin server-route adapter for the internal runtime interrupt status endpoint. */
export const Route = createFileRoute("/api/internal/runtime/interrupts/status")({
  server: {
    handlers: {
      POST: ({ request }) => handleInterruptStatus(request),
    },
  },
});
