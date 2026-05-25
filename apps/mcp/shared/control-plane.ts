import { resolveCmdclawAppUrl, requireServerSecret } from "./runtime";

export async function getManagedIntegrationTokens(params: {
  userId: string;
  workspaceId?: string;
  integrationTypes: string[];
}): Promise<Record<string, string>> {
  const response = await fetch(
    new URL("/api/internal/mcp/runtime-credentials", resolveCmdclawAppUrl()),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireServerSecret()}`,
      },
      body: JSON.stringify(params),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Failed to fetch runtime credentials (${response.status})`);
  }

  const payload = (await response.json()) as { tokens?: Record<string, string> };
  return payload.tokens ?? {};
}

export async function getManagedGalienCredentials(params: {
  userId: string;
  workspaceId: string;
}): Promise<{
  username: string;
  password: string;
  displayName: string | null;
  galienUserId: number | null;
}> {
  const response = await fetch(
    new URL("/api/internal/mcp/galien-credentials", resolveCmdclawAppUrl()),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireServerSecret()}`,
      },
      body: JSON.stringify(params),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Failed to fetch Galien credentials (${response.status})`);
  }

  return (await response.json()) as {
    username: string;
    password: string;
    displayName: string | null;
    galienUserId: number | null;
  };
}

export async function getManagedModulrCredentials(params: {
  userId: string;
  workspaceId: string;
}): Promise<{
  database: string;
  clientId: string;
  clientSecret: string;
  locale: "fr" | "en";
  baseUrl: string;
}> {
  const response = await fetch(
    new URL("/api/internal/mcp/modulr-credentials", resolveCmdclawAppUrl()),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireServerSecret()}`,
      },
      body: JSON.stringify(params),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Failed to fetch Modulr credentials (${response.status})`);
  }

  return (await response.json()) as {
    database: string;
    clientId: string;
    clientSecret: string;
    locale: "fr" | "en";
    baseUrl: string;
  };
}
