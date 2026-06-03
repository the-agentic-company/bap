import { createFileRoute } from "@tanstack/react-router";
import { handleRpcRequest } from "@/server/rpc/handler";

/**
 * oRPC product API at the bare `/api/rpc` path. oRPC stays the primary product
 * API layer; this and the sibling `/api/rpc/$` splat together reproduce the old
 * optional-catch-all so every method on `/api/rpc` and `/api/rpc/**` keeps its
 * exact URL. Thin TanStack Start adapter — no-store headers, streaming, 401
 * behavior, observability, and cookie-aware logging live in the handler module.
 */
export const Route = createFileRoute("/api/rpc/")({
	server: {
		handlers: {
			HEAD: ({ request }) => handleRpcRequest(request),
			GET: ({ request }) => handleRpcRequest(request),
			POST: ({ request }) => handleRpcRequest(request),
			PUT: ({ request }) => handleRpcRequest(request),
			PATCH: ({ request }) => handleRpcRequest(request),
			DELETE: ({ request }) => handleRpcRequest(request),
		},
	},
});
