import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	getSessionMock,
	findFirstMock,
	insertValuesMock,
	updateSetMock,
	updateWhereMock,
} = vi.hoisted(() => ({
	getSessionMock: vi.fn(),
	findFirstMock: vi.fn(),
	insertValuesMock: vi.fn(),
	updateSetMock: vi.fn(),
	updateWhereMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: getSessionMock,
		},
	},
}));

vi.mock("@cmdclaw/db/client", () => ({
	db: {
		query: {
			whatsappUserLink: {
				findFirst: findFirstMock,
			},
		},
		insert: vi.fn(() => ({
			values: insertValuesMock,
		})),
		update: vi.fn(() => ({
			set: updateSetMock,
		})),
	},
}));

import {
	getWhatsAppStatusEndpoint,
	postWhatsAppLinkCode,
	postWhatsAppStart,
} from "./handlers";

function request(method: string): Request {
	return new Request("http://localhost:3000/api/whatsapp/x", { method });
}

describe("postWhatsAppLinkCode (POST /api/whatsapp/link-code)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		updateSetMock.mockReturnValue({ where: updateWhereMock });
		updateWhereMock.mockResolvedValue(undefined);
		insertValuesMock.mockResolvedValue(undefined);
		findFirstMock.mockResolvedValue(null);
	});

	it("returns 401 when there is no session", async () => {
		getSessionMock.mockResolvedValue(null);

		const response = await postWhatsAppLinkCode(request("POST"));

		expect(response.status).toBe(401);
		await expect(response.text()).resolves.toBe("Unauthorized");
	});

	it("returns 400 when the user has no phone number", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1", phoneNumber: null } });

		const response = await postWhatsAppLinkCode(request("POST"));

		expect(response.status).toBe(400);
		await expect(response.text()).resolves.toBe("Phone number required");
	});

	it("creates a 6-digit link code and reports prior linkage", async () => {
		getSessionMock.mockResolvedValue({
			user: { id: "u1", phoneNumber: "+15551234567" },
		});
		findFirstMock.mockResolvedValue({ userId: "u1" });

		const response = await postWhatsAppLinkCode(request("POST"));

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			code: string;
			expiresAt: string;
			alreadyLinked: boolean;
		};
		expect(body.code).toMatch(/^\d{6}$/);
		expect(body.alreadyLinked).toBe(true);
		expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false);
		// Prior codes are expired before a new one is issued.
		expect(updateSetMock).toHaveBeenCalled();
		expect(insertValuesMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "u1", code: body.code }),
		);
	});

	it("returns 500 when code insertion never succeeds", async () => {
		getSessionMock.mockResolvedValue({
			user: { id: "u1", phoneNumber: "+15551234567" },
		});
		insertValuesMock.mockRejectedValue(new Error("unique violation"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await postWhatsAppLinkCode(request("POST"));

		expect(response.status).toBe(500);
		await expect(response.text()).resolves.toBe("Failed to create link code");
		expect(insertValuesMock).toHaveBeenCalledTimes(5);
		errorSpy.mockRestore();
	});
});

describe.each([
	[
		"getWhatsAppStatusEndpoint (GET /api/whatsapp/status)",
		getWhatsAppStatusEndpoint,
	],
	["postWhatsAppStart (POST /api/whatsapp/start)", postWhatsAppStart],
])("%s", (_name, handler) => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 403 when there is no session", async () => {
		getSessionMock.mockResolvedValue(null);

		const response = await handler(request("POST"));

		expect(response.status).toBe(403);
		await expect(response.text()).resolves.toBe("Forbidden");
	});

	it("returns 403 for non-admin users", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1", role: "user" } });

		const response = await handler(request("POST"));

		expect(response.status).toBe(403);
	});

	it("returns the WhatsApp status for admins", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1", role: "admin" } });

		const response = await handler(request("POST"));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			status: "disconnected",
			lastQr: null,
			lastQrAt: null,
			lastError: null,
		});
	});
});
