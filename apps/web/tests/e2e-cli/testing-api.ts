export type CliLiveTestingAction = Record<string, unknown> & {
  action: string;
};

export async function callCliLiveTestingApi<T>(payload: CliLiveTestingAction): Promise<T> {
  const serverUrl = process.env.CMDCLAW_SERVER_URL ?? "http://localhost:3000";
  const secret = process.env.APP_SERVER_SECRET ?? process.env.BAP_SERVER_SECRET;
  if (!secret) {
    throw new Error("APP_SERVER_SECRET is required for CLI live testing API calls.");
  }

  const response = await fetch(`${serverUrl}/api/internal/testing/cli-live`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `CLI live testing API ${payload.action} failed with HTTP ${response.status}: ${body}`,
    );
  }

  return (await response.json()) as T;
}
