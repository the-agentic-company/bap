import { createFileRoute } from "@tanstack/react-router";
import {
  handleDynamicsPendingGet,
  handleDynamicsPendingPost,
} from "../-handlers/dynamics-pending";

/**
 * `/api/oauth/dynamics/pending`. Pending Dynamics environment selection endpoint.
 * Thin TanStack Start server route adapter; the GET (list pending instances) and
 * POST (complete selection by starting instance-scoped re-auth) logic plus the
 * Better Auth session check live in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/oauth/dynamics/pending")({
  server: {
    handlers: {
      GET: ({ request }) => handleDynamicsPendingGet(request),
      POST: ({ request }) => handleDynamicsPendingPost(request),
    },
  },
});
