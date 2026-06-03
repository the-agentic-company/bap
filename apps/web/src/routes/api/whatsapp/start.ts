import { createFileRoute } from "@tanstack/react-router";
import { postWhatsAppStart } from "@/server/api/whatsapp/handlers";

/**
 * Server route adapter preserving the public `POST /api/whatsapp/start` URL. Admin-only
 * authorization and the WhatsApp status response live in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/whatsapp/start")({
	server: {
		handlers: {
			POST: ({ request }) => postWhatsAppStart(request),
		},
	},
});
