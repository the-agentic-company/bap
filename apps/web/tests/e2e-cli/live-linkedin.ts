import { expectedUserEmail } from "./live-config";
import { callCliLiveTestingApi } from "./testing-api";

type UnipileUserResponse = {
  provider_id?: string;
  display_name?: string;
  headline?: string;
  public_identifier?: string;
};

export async function getLinkedInAccountIdForExpectedUser(): Promise<string> {
  const { providerAccountId } = await callCliLiveTestingApi<{
    providerAccountId: string | null;
  }>({
    action: "integration:provider-account-id",
    email: expectedUserEmail,
    integrationType: "linkedin",
  });

  if (!providerAccountId) {
    throw new Error(
      `LinkedIn is not connected for ${expectedUserEmail}. Connect LinkedIn in app integrations before running this test.`,
    );
  }

  return providerAccountId;
}

async function unipileApi<T>(
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const unipileApiKey = process.env.UNIPILE_API_KEY;
  const unipileDsn = process.env.UNIPILE_DSN;
  if (!unipileApiKey || !unipileDsn) {
    throw new Error(
      "Missing Unipile configuration. Set UNIPILE_API_KEY and UNIPILE_DSN to run LinkedIn live tests.",
    );
  }

  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = `https://${unipileDsn}/api/v1/${path}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    headers: {
      "X-API-KEY": unipileApiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Unipile API ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function readLinkedInOwnProfile(args: {
  accountId: string;
}): Promise<{ id: string; name: string; headline: string; publicIdentifier: string }> {
  const meProfile = await unipileApi<UnipileUserResponse>("users/me", {
    account_id: args.accountId,
  });

  const id = meProfile.provider_id?.trim() ?? "";
  const name = meProfile.display_name?.trim() ?? "";
  const publicIdentifier = meProfile.public_identifier?.trim() ?? "";
  let headline = meProfile.headline?.replace(/\s+/g, " ").trim() ?? "";

  // LinkedIn `users/me` may omit headline; mirror runtime behavior by following up with users/{identifier}.
  if (!headline && publicIdentifier) {
    const fullProfile = await unipileApi<UnipileUserResponse>(
      `users/${encodeURIComponent(publicIdentifier)}`,
      {
        account_id: args.accountId,
      },
    );
    headline = fullProfile.headline?.replace(/\s+/g, " ").trim() ?? "";
  }

  if (!id) {
    throw new Error("LinkedIn provider verification failed: own profile missing provider_id.");
  }
  if (!headline) {
    throw new Error("LinkedIn provider verification failed: own profile missing headline.");
  }

  return { id, name, headline, publicIdentifier };
}
