import { env } from "../../env";

type PostHogProperties = Record<string, string | number | boolean | null | undefined>;

type CaptureEventParams = {
  distinctId: string;
  event: "user_signed_up" | "user_active_today";
  properties: PostHogProperties;
  timestamp?: Date;
};

function getPostHogKey(): string | null {
  const key = env.NEXT_PUBLIC_POSTHOG_KEY ?? env.POSTHOG_API_KEY;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

function getPostHogHost(): string {
  const configuredHost = env.POSTHOG_HOST ?? env.NEXT_PUBLIC_POSTHOG_HOST;
  if (typeof configuredHost === "string" && configuredHost.trim().length > 0) {
    return configuredHost.trim().replace(/\/+$/, "");
  }

  return "https://us.i.posthog.com";
}

function compactProperties(properties: PostHogProperties): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  ) as Record<string, string | number | boolean | null>;
}

async function capturePostHogEvent(params: CaptureEventParams): Promise<void> {
  const apiKey = getPostHogKey();
  if (!apiKey) {
    return;
  }

  const payload = {
    api_key: apiKey,
    event: params.event,
    properties: {
      distinct_id: params.distinctId,
      ...compactProperties(params.properties),
    },
    ...(params.timestamp ? { timestamp: params.timestamp.toISOString() } : {}),
  };

  const response = await fetch(`${getPostHogHost()}/capture/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `[posthog] capture failed (${response.status} ${response.statusText}): ${body || "empty body"}`,
    );
  }
}

export async function captureUserSignedUp(params: {
  distinctId: string;
  email: string;
  name?: string | null;
  signupMethod?: string;
}): Promise<void> {
  await capturePostHogEvent({
    distinctId: params.distinctId,
    event: "user_signed_up",
    properties: {
      email: params.email,
      name: params.name ?? undefined,
      signup_method: params.signupMethod,
      source: "web",
    },
  });
}

export async function captureUserActiveToday(params: {
  distinctId: string;
  activityDate: string;
  workspaceId?: string | null;
}): Promise<void> {
  await capturePostHogEvent({
    distinctId: params.distinctId,
    event: "user_active_today",
    properties: {
      activity_date: params.activityDate,
      source: "web",
      workspace_id: params.workspaceId ?? undefined,
    },
  });
}
