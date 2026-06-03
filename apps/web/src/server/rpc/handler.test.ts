import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused tests for the framework-neutral oRPC handler. We mock the two heavy
 * boundaries (the oRPC `RPCHandler.handle` and `createORPCContext`) and the
 * observability sink so the test exercises the frozen `/api/rpc` HTTP contract
 * — no-store/private cache headers, streaming body passthrough, 401 login-debug
 * logging, and method support — without duplicating router or DB logic.
 */

const { handleMock, createContextMock } = vi.hoisted(() => ({
	handleMock: vi.fn(),
	createContextMock: vi.fn(),
}));

vi.mock("@orpc/server/fetch", () => ({
	RPCHandler: class {
		handle = handleMock;
	},
}));

vi.mock("@/server/orpc", () => ({ appRouter: {} }));

vi.mock("@/server/orpc/context", () => ({
	createORPCContext: (...args: unknown[]) => createContextMock(...args),
}));

vi.mock("@cmdclaw/core/server/utils/observability", () => ({
	extractHttpTraceContext: () => undefined,
	recordCounter: vi.fn(),
	recordHistogram: vi.fn(),
	startActiveServerSpan: (_name: string, _opts: unknown, fn: () => unknown) =>
		fn(),
}));

import { handleRpcRequest, withNoStore } from "./handler";

beforeEach(() => {
	handleMock.mockReset();
	createContextMock.mockReset();
	createContextMock.mockResolvedValue({});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function rpcRequest(path = "/api/rpc/foo", init?: RequestInit): Request {
	return new Request(`https://cmdclaw.ai${path}`, { method: "POST", ...init });
}

describe("withNoStore", () => {
	it("applies the frozen no-store/private cache contract", () => {
		const response = withNoStore(new Response("ok", { status: 200 }));

		expect(response.headers.get("Cache-Control")).toBe(
			"no-store, no-cache, must-revalidate, private",
		);
		expect(response.headers.get("Pragma")).toBe("no-cache");
		expect(response.headers.get("Expires")).toBe("0");
		expect(response.headers.get("Vary")).toContain("Cookie");
		expect(response.headers.get("Vary")).toContain("Authorization");
	});

	it("preserves status, statusText and existing headers", () => {
		const response = withNoStore(
			new Response("x", {
				status: 207,
				statusText: "Multi",
				headers: { "X-Keep": "1" },
			}),
		);

		expect(response.status).toBe(207);
		expect(response.statusText).toBe("Multi");
		expect(response.headers.get("X-Keep")).toBe("1");
	});
});

describe("handleRpcRequest", () => {
	it("passes the bare /api/rpc prefix to the oRPC handler", async () => {
		handleMock.mockResolvedValue({ response: Response.json({ ok: true }) });

		await handleRpcRequest(rpcRequest());

		expect(handleMock).toHaveBeenCalledTimes(1);
		const [, options] = handleMock.mock.calls[0];
		expect(options.prefix).toBe("/api/rpc");
	});

	it("returns 404 when the oRPC handler does not match", async () => {
		handleMock.mockResolvedValue({ response: null });

		const response = await handleRpcRequest(rpcRequest());

		expect(response.status).toBe(404);
		expect(response.headers.get("Cache-Control")).toContain("no-store");
	});

	it("preserves a streaming response body untouched", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("chunk-1"));
				controller.enqueue(new TextEncoder().encode("chunk-2"));
				controller.close();
			},
		});
		handleMock.mockResolvedValue({
			response: new Response(stream, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			}),
		});

		const response = await handleRpcRequest(rpcRequest());

		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toContain("no-store");
		await expect(response.text()).resolves.toBe("chunk-1chunk-2");
	});

	it("logs a 401 with a session-cookie fingerprint and applies no-store", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		handleMock.mockResolvedValue({
			response: new Response("Unauthorized", { status: 401 }),
		});

		const response = await handleRpcRequest(
			rpcRequest("/api/rpc/secret", {
				headers: { cookie: "better-auth.session_token=abc123" },
			}),
		);

		expect(response.status).toBe(401);
		expect(response.headers.get("Cache-Control")).toContain("no-store");
		expect(warn).toHaveBeenCalledWith(
			"[Auth Debug] RPC request returned 401",
			expect.objectContaining({
				path: "/api/rpc/secret",
				method: "POST",
				hasSessionCookie: true,
				sessionCookieName: "better-auth.session_token",
			}),
		);
	});

	it("returns a 500 JSON envelope with no-store when the handler throws", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		handleMock.mockRejectedValue(new Error("boom"));

		const response = await handleRpcRequest(rpcRequest());

		expect(response.status).toBe(500);
		expect(response.headers.get("Content-Type")).toBe("application/json");
		expect(response.headers.get("Cache-Control")).toContain("no-store");
		await expect(response.json()).resolves.toEqual({ error: "Error: boom" });
	});
});
