import { createFileRoute } from "@tanstack/react-router";
import { handleRpcRequest } from "@/server/rpc/handler";

/**
 * oRPC product API splat for `/api/rpc/**` (e.g. `/api/rpc/skill/updateFile`).
 * Pairs with the `/api/rpc` index route to reproduce the old Next optional
 * catch-all so every oRPC method keeps its exact public URL. Thin TanStack
 * Start adapter; the frozen `/api/rpc` contract (no-store headers, streaming,
 * 401 behavior, observability, logging) lives in the handler module.
 */
export const Route = createFileRoute("/api/rpc/$")({
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
