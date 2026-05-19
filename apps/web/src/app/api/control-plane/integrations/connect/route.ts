import { getOAuthConfig, type IntegrationType } from "@cmdclaw/core/server/oauth/config";
import { NextResponse } from "next/server";
import { buildRequestAwareUrl, getRequestAwareOrigin } from "@/lib/request-aware-url";
import { assertCloudControlPlaneEnabled, requireCloudSession } from "@/server/control-plane/auth";
import { generateLinkedInAuthUrl } from "@/server/integrations/unipile";

const SUPPORTED_TYPES = new Set<IntegrationType>([
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
  "reddit",
  "twitter",
]);

function createState(payload: Record<string, string | undefined>) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export async function GET(request: Request) {
  try {
    assertCloudControlPlaneEnabled();
    const sessionData = await requireCloudSession(request);
    if (!sessionData?.user?.id) {
      const url = new URL(request.url);
      const loginUrl = buildRequestAwareUrl("/login", request);
      loginUrl.searchParams.set("callbackUrl", url.pathname + url.search);
      return NextResponse.redirect(loginUrl);
    }

    const url = new URL(request.url);
    const type = url.searchParams.get("type") as IntegrationType | null;
    if (!type || !SUPPORTED_TYPES.has(type)) {
      return NextResponse.json({ message: "Unsupported integration type" }, { status: 400 });
    }

    const redirectUrl = new URL("/toolbox", getRequestAwareOrigin(request)).toString();
    if (type === "linkedin") {
      const authUrl = await generateLinkedInAuthUrl(sessionData.user.id, redirectUrl);
      return NextResponse.redirect(authUrl);
    }

    const config = getOAuthConfig(type);
    const state = createState({
      userId: sessionData.user.id,
      type,
      redirectUrl,
    });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      state,
    });

    if (type === "slack") {
      params.set("user_scope", config.scopes.join(" "));
    } else {
      params.set("scope", config.scopes.join(" "));
    }

    if (
      type === "google_gmail" ||
      type === "google_calendar" ||
      type === "google_docs" ||
      type === "google_sheets" ||
      type === "google_drive"
    ) {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
    }

    if (type === "outlook" || type === "outlook_calendar") {
      params.set("prompt", "select_account");
    }

    if (type === "notion") {
      params.set("owner", "user");
    }

    if (type === "reddit") {
      params.set("duration", "permanent");
    }

    return NextResponse.redirect(`${config.authUrl}?${params}`);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to start integration connect" },
      { status: 500 },
    );
  }
}
