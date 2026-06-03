import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	ensureWorkspaceForUserMock,
	envMock,
	findFirstMock,
	insertValuesMock,
	serializeSignedCookieMock,
	updateSetMock,
	updateWhereMock,
	existsSyncMock,
	readFileSyncMock,
} = vi.hoisted(() => ({
	ensureWorkspaceForUserMock: vi.fn(),
	envMock: {
		BETTER_AUTH_SECRET: "test-secret",
		CMDCLAW_DEV_AUTO_LOGIN: "0",
		CMDCLAW_DEV_AUTO_LOGIN_EMAIL: undefined as string | undefined,
	},
	findFirstMock: vi.fn(),
	insertValuesMock: vi.fn(),
	serializeSignedCookieMock: vi.fn(),
	updateSetMock: vi.fn(),
	updateWhereMock: vi.fn(),
	existsSyncMock: vi.fn(),
	readFileSyncMock: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: envMock,
}));

vi.mock("@cmdclaw/core/server/billing/service", () => ({
	ensureWorkspaceForUser: ensureWorkspaceForUserMock,
}));

vi.mock("@cmdclaw/db/client", () => ({
	db: {
		query: {
			user: {
				findFirst: findFirstMock,
			},
		},
		update: vi.fn(() => ({
			set: updateSetMock,
		})),
		insert: vi.fn(() => ({
			values: insertValuesMock,
		})),
	},
}));

vi.mock("better-call", async (importOriginal) => {
	const actual = await importOriginal<typeof import("better-call")>();
	return {
		...actual,
		serializeSignedCookie: serializeSignedCookieMock,
	};
});

vi.mock("node:fs", () => ({
	existsSync: existsSyncMock,
	readFileSync: readFileSyncMock,
}));

import {
	handleDevAutoLogin,
	handleDevHealth,
	handleDevWorktreeAuth,
} from "./-handlers";

function locationFor(response: Response): string {
	const location = response.headers.get("location");
	if (!location) {
		throw new Error("Expected Location header");
	}
	return location;
}

function setCookieHeader(response: Response): string {
	return response.headers.getSetCookie().join("\n");
}

describe("handleDevHealth (GET /api/dev/health)", () => {
	it("returns a public readiness response", async () => {
		const response = handleDevHealth();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});
});

describe("handleDevAutoLogin (GET /api/dev/auto-login)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		envMock.BETTER_AUTH_SECRET = "test-secret";
		envMock.CMDCLAW_DEV_AUTO_LOGIN = "0";
		envMock.CMDCLAW_DEV_AUTO_LOGIN_EMAIL = undefined;
		findFirstMock.mockResolvedValue(null);
		updateSetMock.mockReturnValue({ where: updateWhereMock });
		updateWhereMock.mockResolvedValue(undefined);
		insertValuesMock.mockResolvedValue(undefined);
		ensureWorkspaceForUserMock.mockResolvedValue({ id: "ws-1" });
		serializeSignedCookieMock.mockResolvedValue("signed-session%2Fvalue=");
	});

	it("redirects to login when the hatch is disabled", async () => {
		const response = await handleDevAutoLogin(
			new Request(
				"http://localhost:3000/api/dev/auto-login?callbackUrl=%2Fagents",
			),
		);

		expect(response.status).toBe(307);
		expect(locationFor(response)).toBe(
			"http://localhost:3000/login?callbackUrl=%2Fagents&error=dev_auto_login_unavailable",
		);
	});

	it("does not expose the hatch to non-loopback hosts", async () => {
		envMock.CMDCLAW_DEV_AUTO_LOGIN = "1";

		const response = await handleDevAutoLogin(
			new Request(
				"https://cmdclaw.ai/api/dev/auto-login?callbackUrl=%2Fagents",
			),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({ error: "Not found" });
	});

	it("creates a session cookie and redirects to the callback for loopback requests", async () => {
		envMock.CMDCLAW_DEV_AUTO_LOGIN = "1";
		envMock.CMDCLAW_DEV_AUTO_LOGIN_EMAIL = "baptiste@heybap.com";
		findFirstMock.mockResolvedValue({
			id: "user-1",
			name: "Baptiste",
			activeWorkspaceId: "ws-1",
			onboardedAt: new Date("2026-01-01T00:00:00.000Z"),
		});

		const response = await handleDevAutoLogin(
			new Request(
				"http://127.0.0.1:3000/api/dev/auto-login?callbackUrl=%2Fagents",
			),
		);

		expect(response.status).toBe(307);
		expect(locationFor(response)).toBe("http://127.0.0.1:3000/agents");
		expect(ensureWorkspaceForUserMock).toHaveBeenCalledWith("user-1", "ws-1");
		expect(insertValuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-1",
				userAgent: "cmdclaw-dev-auto-login",
			}),
		);
		expect(setCookieHeader(response)).toContain(
			"better-auth.session_token=signed-session%2Fvalue",
		);
	});
});

describe("handleDevWorktreeAuth (GET /api/dev/worktree-auth)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.CMDCLAW_INSTANCE_ROOT;
		existsSyncMock.mockReturnValue(false);
	});

	it("falls back to login when worktree auto-login is unavailable", () => {
		const response = handleDevWorktreeAuth(
			new Request(
				"http://127.0.0.1:3626/api/dev/worktree-auth?callbackUrl=%2Fchat",
			),
		);

		expect(response.status).toBe(307);
		expect(locationFor(response)).toBe(
			"http://127.0.0.1:3626/login?callbackUrl=%2Fchat&error=worktree_auto_login_unavailable",
		);
	});

	it("sets the bootstrapped session cookie and redirects back to the callback", () => {
		process.env.CMDCLAW_INSTANCE_ROOT = "/tmp/cmdclaw-worktree";
		existsSyncMock.mockReturnValue(true);
		readFileSyncMock.mockReturnValue(
			JSON.stringify({
				cookies: [
					{
						name: "better-auth.session_token",
						value: "signed-cookie%2Fvalue%3D",
						expires: 1_900_000_000,
						httpOnly: true,
						sameSite: "Lax",
					},
				],
			}),
		);

		const response = handleDevWorktreeAuth(
			new Request(
				"http://127.0.0.1:3626/api/dev/worktree-auth?callbackUrl=%2Fchat",
			),
		);

		expect(response.status).toBe(307);
		expect(locationFor(response)).toBe("http://127.0.0.1:3626/chat");
		expect(setCookieHeader(response)).toContain(
			"better-auth.session_token=signed-cookie%2Fvalue%3D",
		);
	});
});
