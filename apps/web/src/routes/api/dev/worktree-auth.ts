import { createFileRoute } from "@tanstack/react-router";
import { handleDevWorktreeAuth } from "./-handlers";

/**
 * Dev/worktree-only auto-login from a bootstrapped storage-state cookie. Preserves the
 * public `/api/dev/worktree-auth` URL, loopback + worktree gating, and the Better Auth
 * session cookie + redirect contract. Thin TanStack Start adapter.
 */
export const Route = createFileRoute("/api/dev/worktree-auth")({
	server: {
		handlers: {
			GET: ({ request }) => handleDevWorktreeAuth(request),
		},
	},
});
