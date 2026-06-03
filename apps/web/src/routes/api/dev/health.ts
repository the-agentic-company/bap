import { createFileRoute } from "@tanstack/react-router";
import { handleDevHealth } from "./-handlers";

/**
 * Dev-only readiness probe. Preserves the public `/api/dev/health` URL and `{ ok: true }`
 * JSON shape. Thin TanStack Start adapter over the framework-neutral handler.
 */
export const Route = createFileRoute("/api/dev/health")({
	server: {
		handlers: {
			GET: () => handleDevHealth(),
		},
	},
});
