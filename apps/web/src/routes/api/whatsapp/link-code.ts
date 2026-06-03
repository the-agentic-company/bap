import { createFileRoute } from "@tanstack/react-router";
import { postWhatsAppLinkCode } from "@/server/api/whatsapp/handlers";

/**
 * Server route adapter preserving the public `POST /api/whatsapp/link-code` URL. Session
 * auth and link-code creation live in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/whatsapp/link-code")({
	server: {
		handlers: {
			POST: ({ request }) => postWhatsAppLinkCode(request),
		},
	},
});
