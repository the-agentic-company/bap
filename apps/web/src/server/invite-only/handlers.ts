import { postInviteOnlyAccessRequestSlackNotification } from "@cmdclaw/core/server/services/telemetry-slack";
import { z } from "zod";
import { isApprovedLoginEmail } from "@/server/lib/approved-login-emails";

/**
 * Framework-neutral handler for the invite-only request-access endpoint.
 *
 * Preserves the public `/api/invite-only/request-access` URL and contract: validates the
 * JSON body, short-circuits already-approved emails, and otherwise posts a Slack
 * notification. Uses standard Web Request/Response so the TanStack Start route file stays a
 * thin adapter. The referrer is derived from the standard `referer` request header.
 */

const requestAccessSchema = z.object({
  email: z.string().email(),
  source: z.string().trim().min(1).max(100).optional(),
});

/** POST /api/invite-only/request-access */
export async function handleInviteOnlyRequestAccess(request: Request): Promise<Response> {
  let parsedBody: z.infer<typeof requestAccessSchema>;

  try {
    parsedBody = requestAccessSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (await isApprovedLoginEmail(parsedBody.email)) {
    return Response.json({ ok: true, alreadyApproved: true });
  }

  const notified = await postInviteOnlyAccessRequestSlackNotification({
    email: parsedBody.email.trim().toLowerCase(),
    source: parsedBody.source ?? "invite-only-page",
    occurredAt: new Date(),
    referrer: request.headers.get("referer"),
  });

  if (!notified) {
    return Response.json(
      { error: "Request access notifications are not configured" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, alreadyApproved: false });
}
