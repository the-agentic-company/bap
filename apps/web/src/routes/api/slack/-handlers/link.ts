import { db } from "@cmdclaw/db/client";
import { slackUserLink } from "@cmdclaw/db/schema";
import { auth } from "@/lib/auth";
import { buildRequestAwareUrl } from "@/lib/request-aware-url";

/**
 * Framework-neutral handler for `GET /api/slack/link`.
 *
 * Slack link flow: associates a Slack user/team with the authenticated CmdClaw
 * account, then renders a small confirmation HTML page. API authorization (the
 * Better Auth session check) lives here, not in any page route guard.
 *
 * The previous handler used `standard redirect`, which is a **307**
 * (method-preserving) redirect. We preserve that exact status with a plain Web
 * `Response`. Session lookup reads `request.headers` directly instead of the
 * previous `headers()` helper. Uses only standard `Request`/`Response`/`URL`.
 */
export async function handleSlackLink(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const slackUserId = url.searchParams.get("slackUserId");
  const slackTeamId = url.searchParams.get("slackTeamId");

  if (!slackUserId || !slackTeamId) {
    return Response.json({ error: "Missing slackUserId or slackTeamId" }, { status: 400 });
  }

  // Require authenticated session
  const sessionData = await auth.api.getSession({
    headers: request.headers,
  });

  if (!sessionData?.session) {
    // Redirect to login with return URL
    const returnUrl = encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 307,
      headers: {
        location: buildRequestAwareUrl(`/login?redirect=${returnUrl}`, request).toString(),
      },
    });
  }

  const userId = sessionData.session.userId;

  // Create link (upsert - ignore if already exists)
  await db
    .insert(slackUserLink)
    .values({
      slackTeamId,
      slackUserId,
      userId,
    })
    .onConflictDoUpdate({
      target: [slackUserLink.slackTeamId, slackUserLink.slackUserId],
      set: { userId },
    });

  return new Response(
    `<!DOCTYPE html>
<html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center">
<h1>Account linked!</h1>
<p>You can now use @cmdclaw in Slack. Head back to your workspace and try it out.</p>
</div>
</body></html>`,
    {
      headers: { "Content-Type": "text/html" },
    },
  );
}
