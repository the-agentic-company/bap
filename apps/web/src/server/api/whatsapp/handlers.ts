import { db } from "@cmdclaw/db/client";
import { whatsappLinkCode, whatsappUserLink } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getWhatsAppStatus } from "@/server/services/whatsapp-bot";

/**
 * Framework-neutral handlers for the `/api/whatsapp/**` routes.
 *
 * API authorization (Better Auth session, admin role) lives here, not in a route
 * page-guard: missing/insufficient sessions return 401/403. Everything uses standard Web
 * Request/Response so the TanStack Start route files stay thin adapters.
 */

function generateLinkCode(): string {
	return Math.floor(100000 + Math.random() * 900000).toString();
}

async function insertLinkCodeWithRetry(params: {
	userId: string;
	expiresAt: Date;
	maxAttempts: number;
	attempt?: number;
}): Promise<{ ok: true; code: string } | { ok: false }> {
	const { userId, expiresAt, maxAttempts } = params;
	const attempt = params.attempt ?? 0;
	const code = generateLinkCode();

	try {
		await db.insert(whatsappLinkCode).values({
			userId,
			code,
			expiresAt,
		});
		return { ok: true, code };
	} catch (err) {
		if (attempt >= maxAttempts - 1) {
			console.error("[whatsapp-link] Failed to create code:", err);
			return { ok: false };
		}
		return insertLinkCodeWithRetry({
			userId,
			expiresAt,
			maxAttempts,
			attempt: attempt + 1,
		});
	}
}

/** POST /api/whatsapp/link-code */
export async function postWhatsAppLinkCode(
	request: Request,
): Promise<Response> {
	const sessionData = await auth.api.getSession({ headers: request.headers });
	const currentUser = sessionData?.user;
	if (!currentUser) {
		return new Response("Unauthorized", { status: 401 });
	}

	if (!currentUser.phoneNumber) {
		return new Response("Phone number required", { status: 400 });
	}

	const existingLink = await db.query.whatsappUserLink.findFirst({
		where: eq(whatsappUserLink.userId, currentUser.id),
	});

	await db
		.update(whatsappLinkCode)
		.set({ usedAt: new Date() })
		.where(eq(whatsappLinkCode.userId, currentUser.id));

	const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

	const inserted = await insertLinkCodeWithRetry({
		userId: currentUser.id,
		expiresAt,
		maxAttempts: 5,
	});
	if (!inserted.ok) {
		return new Response("Failed to create link code", { status: 500 });
	}

	return Response.json({
		code: inserted.code,
		expiresAt: expiresAt.toISOString(),
		alreadyLinked: !!existingLink,
	});
}

/**
 * Shared admin-gated WhatsApp status response, used by both `GET /api/whatsapp/status`
 * and `POST /api/whatsapp/start`.
 */
async function whatsAppStatusForAdmin(request: Request): Promise<Response> {
	const sessionData = await auth.api.getSession({ headers: request.headers });
	if (sessionData?.user?.role !== "admin") {
		return new Response("Forbidden", { status: 403 });
	}

	// Disabled for now: avoid starting Baileys while WhatsApp integration is unused.
	// await ensureWhatsAppSocket();
	const status = getWhatsAppStatus();
	return Response.json(status);
}

/** GET /api/whatsapp/status */
export function getWhatsAppStatusEndpoint(request: Request): Promise<Response> {
	return whatsAppStatusForAdmin(request);
}

/** POST /api/whatsapp/start */
export function postWhatsAppStart(request: Request): Promise<Response> {
	return whatsAppStatusForAdmin(request);
}
