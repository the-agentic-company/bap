import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { BapApiClient } from "./types";

export function createRpcClient(
  serverUrl: string,
  token: string,
  extraHeaders?: Record<string, string>,
): BapApiClient {
  const link = new RPCLink({
    url: `${serverUrl}/api/rpc`,
    headers: () => ({ ...extraHeaders, Authorization: `Bearer ${token}` }),
  });

  return createORPCClient(link) as unknown as BapApiClient;
}
