import { limitOf, type OperationContext } from "./context";

type JsonValue = ReturnType<typeof JSON.parse>;
type JsonRecord = Record<string, JsonValue>;

/**
 * Invitation and connection operations — the LinkedIn relationship graph.
 */

export async function sendInvitation(
  ctx: OperationContext,
  profileId: string,
  message?: string,
): Promise<void> {
  const { client } = ctx;
  const body: JsonRecord = { account_id: client.accountId, provider_id: profileId };
  if (message) {
    body.message = message;
  }

  await client.request("/users/invite", { method: "POST", body: JSON.stringify(body) });
  console.log(
    JSON.stringify({ success: true, message: `Invitation sent to ${profileId}` }, null, 2),
  );
}

export async function listPendingInvitations(ctx: OperationContext): Promise<void> {
  const { client, values } = ctx;
  const limit = limitOf(values, "20");
  const data = await client.request(
    `/users/invitations?account_id=${client.accountId}&limit=${limit}`,
  );

  const invitations =
    data.items?.map((i: JsonRecord) => ({
      id: i.provider_id,
      name: i.display_name,
      headline: i.headline,
      sentAt: i.sent_at,
      direction: i.direction,
    })) || [];

  console.log(JSON.stringify({ items: invitations, cursor: data.cursor }, null, 2));
}

export async function listConnections(ctx: OperationContext): Promise<void> {
  const { client, values } = ctx;
  const limit = limitOf(values, "50");
  const params = new URLSearchParams({ account_id: client.accountId, limit: limit.toString() });
  if (values.cursor) {
    params.set("cursor", values.cursor);
  }

  const data = await client.request(`/users/relations?${params}`);

  const connections =
    data.items?.map((c: JsonRecord) => ({
      id: c.provider_id,
      name: c.display_name,
      headline: c.headline,
      connectedAt: c.connected_at,
    })) || [];

  console.log(JSON.stringify({ items: connections, cursor: data.cursor }, null, 2));
}

export async function removeConnection(ctx: OperationContext, profileId: string): Promise<void> {
  const { client } = ctx;
  await client.request(`/users/relations/${profileId}?account_id=${client.accountId}`, {
    method: "DELETE",
  });
  console.log(
    JSON.stringify({ success: true, message: `Connection removed: ${profileId}` }, null, 2),
  );
}
