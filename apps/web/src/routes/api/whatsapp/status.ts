import { createFileRoute } from "@tanstack/react-router";
import { getWhatsAppStatusEndpoint } from "@/server/api/whatsapp/handlers";

/**
 * Server route adapter preserving the public `GET /api/whatsapp/status` URL. Admin-only
 * authorization and the WhatsApp status response live in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/whatsapp/status")({
	server: {
		handlers: {
			GET: ({ request }) => getWhatsAppStatusEndpoint(request),
		},
	},
});
