import { createFileRoute } from "@tanstack/react-router";
import { handleInterruptCreate } from "@/server/internal/runtime-interrupts";

/** Thin server-route adapter for the internal runtime interrupt create endpoint. */
export const Route = createFileRoute("/api/internal/runtime/interrupts/create")({
  server: {
    handlers: {
      POST: ({ request }) => handleInterruptCreate(request),
    },
  },
});
