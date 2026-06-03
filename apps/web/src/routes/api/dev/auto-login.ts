import { createFileRoute } from "@tanstack/react-router";
import { handleDevAutoLogin } from "./-handlers";

/**
 * Dev-only loopback auto-login. Preserves the public `/api/dev/auto-login` URL, loopback
 * gating, 404 for non-loopback hosts, and the Better Auth session cookie + redirect
 * contract. Thin TanStack Start adapter over the framework-neutral handler.
 */
export const Route = createFileRoute("/api/dev/auto-login")({
	server: {
		handlers: {
			GET: ({ request }) => handleDevAutoLogin(request),
		},
	},
});
