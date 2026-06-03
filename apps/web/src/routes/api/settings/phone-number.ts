import { createFileRoute } from "@tanstack/react-router";
import { deletePhoneNumber } from "@/server/api/settings/phone-number";

/**
 * Server route adapter preserving the public `DELETE /api/settings/phone-number` URL. All
 * logic (session auth, clearing the user's phone number) lives in the framework-neutral
 * handler.
 */
export const Route = createFileRoute("/api/settings/phone-number")({
  server: {
    handlers: {
      DELETE: ({ request }) => deletePhoneNumber(request),
    },
  },
});
