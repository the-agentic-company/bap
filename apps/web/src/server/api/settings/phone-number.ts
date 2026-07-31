import { db } from "@bap/db/client";
import { user } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import { getRequestSession } from "@/server/session-auth";

/**
 * Framework-neutral handler for `DELETE /api/settings/phone-number`.
 *
 * Clears the authenticated user's stored phone number. API authorization (Better Auth
 * session) lives here, not in a route page-guard: a missing session returns 401. Uses
 * standard Web Request/Response so the TanStack Start route file stays a thin adapter.
 */
export async function deletePhoneNumber(request: Request): Promise<Response> {
  const sessionData = await getRequestSession(request.headers);
  const currentUser = sessionData?.user;

  if (!currentUser) {
    return new Response("Unauthorized", { status: 401 });
  }

  await db.update(user).set({ phoneNumber: null }).where(eq(user.id, currentUser.id));

  return Response.json({ status: true });
}
