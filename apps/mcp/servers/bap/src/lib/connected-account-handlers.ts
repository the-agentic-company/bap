import type { BapApiClient } from "@bap/client";

export async function handleConnectedAccountRead(params: {
  client: BapApiClient;
  query: { type: "list"; integrationType?: string } | { type: "get"; connectedAccountId: string };
}) {
  const accounts = await params.client.integration.list();
  const matches = accounts.filter((account) => {
    if (params.query.type === "get") return account.id === params.query.connectedAccountId;
    return !params.query.integrationType || account.type === params.query.integrationType;
  });

  if (params.query.type === "get" && matches.length === 0) {
    throw new Error("Connected Account not found.");
  }

  return { status: "completed" as const, connectedAccounts: matches };
}

export async function handleConnectedAccountConnect(params: {
  client: BapApiClient;
  integrationType: string;
  redirectUrl: string;
  mode?: "connect" | "connect_to_label" | "reauth";
  accountLabel?: string;
  connectedAccountId?: string;
}) {
  const result = await params.client.integration.getAuthUrl({
    type: params.integrationType,
    redirectUrl: params.redirectUrl,
    mode: params.mode,
    accountLabel: params.accountLabel,
    connectedAccountId: params.connectedAccountId,
  });
  return { status: "completed" as const, integrationType: params.integrationType, ...result };
}

export async function handleConnectedAccountDisconnect(params: {
  client: BapApiClient;
  connectedAccountId: string;
}) {
  const result = await params.client.integration.disconnect({ id: params.connectedAccountId });
  return {
    status: "completed" as const,
    connectedAccountId: params.connectedAccountId,
    disconnected: result.success,
  };
}
