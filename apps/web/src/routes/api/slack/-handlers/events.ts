import { buildQueueJobId, SLACK_EVENT_JOB_NAME, getQueue } from "@cmdclaw/core/server/queues";
import { verifySlackSignature } from "@/lib/slack-signature";

/**
 * Framework-neutral handler for `POST /api/slack/events`.
 *
 * This is a signed Slack Events API webhook. The raw request body is read
 * verbatim with `request.text()` and passed unmodified to
 * `verifySlackSignature`, preserving the exact bytes required for the
 * HMAC-SHA256 signature check (`v0:{timestamp}:{body}`). Uses only standard
 * `Request`/`Response` so the TanStack Start route stays a thin adapter and the
 * logic remains testable without the framework. API authorization (Slack
 * signature verification) lives here, not in any page route guard.
 */
export async function handleSlackEvents(request: Request): Promise<Response> {
  const body = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";

  // Verify request authenticity
  if (!verifySlackSignature(body, timestamp, signature)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(body);

  // Handle Slack URL verification challenge
  if (payload.type === "url_verification") {
    return Response.json({ challenge: payload.challenge });
  }

  // Acknowledge immediately (Slack requires response within 3s)
  if (payload.type === "event_callback") {
    const eventId = typeof payload.event_id === "string" ? payload.event_id : undefined;
    if (!eventId) {
      return Response.json({ error: "Missing event_id" }, { status: 400 });
    }

    try {
      const queue = getQueue();
      await queue.add(
        SLACK_EVENT_JOB_NAME,
        { payload, eventId },
        {
          jobId: buildQueueJobId([SLACK_EVENT_JOB_NAME, eventId]),
          removeOnComplete: true,
          removeOnFail: 500,
        },
      );
    } catch (err) {
      console.error("[slack-events] Failed to enqueue event:", err);
      return Response.json({ error: "Failed to enqueue event" }, { status: 503 });
    }
  }

  return Response.json({ ok: true });
}
