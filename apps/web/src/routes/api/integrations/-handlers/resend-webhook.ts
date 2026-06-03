import {
  buildQueueJobId,
  EMAIL_FORWARDED_COWORKER_JOB_NAME,
  getQueue,
} from "@cmdclaw/core/server/queues";
import { type ResendEmailReceivedEvent } from "@cmdclaw/core/server/services/coworker-email-forwarding";
import { Resend } from "resend";
import { env } from "@/env";

/**
 * Framework-neutral handler for `POST /api/integrations/resend/webhook`.
 *
 * This is a signed (Svix) webhook receiver. The raw request body is read verbatim with
 * `request.text()` and passed unmodified to `resend.webhooks.verify`, preserving the exact
 * bytes required for signature verification. Uses standard `Request`/`Response` only.
 */

const resend = new Resend(env.RESEND_API_KEY ?? "re_placeholder");

export async function handleResendWebhook(request: Request): Promise<Response> {
  const payload = await request.text();
  const svixId = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";
  const requestId = request.headers.get("x-request-id");

  console.info("[resend-webhook] received request", {
    requestId: requestId ?? null,
    svixId: svixId || null,
    payloadBytes: Buffer.byteLength(payload, "utf8"),
  });

  if (!env.RESEND_WEBHOOK_SECRET) {
    console.error("[resend-webhook] missing RESEND_WEBHOOK_SECRET");
    return Response.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  if (!svixId || !svixTimestamp || !svixSignature) {
    return Response.json({ error: "Missing webhook signature headers" }, { status: 400 });
  }

  let event: ResendEmailReceivedEvent;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      },
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
    }) as ResendEmailReceivedEvent;
  } catch {
    console.warn("[resend-webhook] signature verification failed", {
      requestId: requestId ?? null,
      svixId: svixId || null,
    });
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    console.info("[resend-webhook] verified event", {
      requestId: requestId ?? null,
      svixId: svixId || null,
      eventType: event.type,
      emailId: event.data?.email_id ?? null,
    });

    if (event.type !== "email.received") {
      console.info("[resend-webhook] ignored event type", {
        requestId: requestId ?? null,
        svixId: svixId || null,
        eventType: event.type,
      });
      return Response.json({ ok: true });
    }

    const emailId = event.data?.email_id;
    if (emailId) {
      const queue = getQueue();
      const jobId = buildQueueJobId([EMAIL_FORWARDED_COWORKER_JOB_NAME, svixId || emailId]);
      await queue.add(
        EMAIL_FORWARDED_COWORKER_JOB_NAME,
        {
          webhookId: svixId,
          event,
        },
        {
          jobId,
          attempts: 20,
          backoff: {
            type: "exponential",
            delay: 30_000,
          },
          removeOnComplete: true,
          removeOnFail: 500,
        },
      );
      console.info("[resend-webhook] enqueued forwarded-email job", {
        requestId: requestId ?? null,
        svixId: svixId || null,
        emailId,
        jobId,
      });
    } else {
      console.warn("[resend-webhook] email.received missing email_id; skipping enqueue", {
        requestId: requestId ?? null,
        svixId: svixId || null,
      });
    }
  } catch (error) {
    console.error("[resend-webhook] failed to enqueue", error);
    return Response.json({ error: "Failed to enqueue event" }, { status: 503 });
  }

  return Response.json({ ok: true });
}
