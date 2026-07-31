import { buildWorkspaceMcpUpstreamRuntimeServer } from "@bap/core/server/executor/workspace-sources";
import { hasWorkspaceManagedMcpAccess } from "@bap/core/server/services/workspace-integration-policy";
import { db } from "@bap/db/client";
import { workspaceMcpAuthorization, workspaceMcpServer } from "@bap/db/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq } from "drizzle-orm";
import {
  persistWorkspaceMcpToolCatalog,
  type WorkspaceMcpToolDescriptor,
} from "./workspace-mcp-tool-catalog";

type Database = typeof db;

const DISCOVERY_TIMEOUT_MS = 8_000;

function withDiscoveryTimeout<T>(promise: Promise<T>, serverName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Tool discovery timed out for ${serverName}.`)),
      DISCOVERY_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function listAllTools(
  client: Client,
  serverName: string,
  cursor?: string,
  visitedCursors = new Set<string>(),
): Promise<WorkspaceMcpToolDescriptor[]> {
  if (cursor && visitedCursors.has(cursor)) {
    throw new Error(`Tool discovery returned a repeated cursor for ${serverName}.`);
  }
  if (cursor) {
    visitedCursors.add(cursor);
  }

  const response = await withDiscoveryTimeout(
    client.listTools(cursor ? { cursor } : undefined),
    serverName,
  );
  if (!response.nextCursor) {
    return response.tools;
  }
  return [
    ...response.tools,
    ...(await listAllTools(client, serverName, response.nextCursor, visitedCursors)),
  ];
}

async function discoverServerTools(input: {
  database: Database;
  source: typeof workspaceMcpServer.$inferSelect;
  credential: typeof workspaceMcpAuthorization.$inferSelect | null;
  userId: string;
}): Promise<void> {
  const upstream = await buildWorkspaceMcpUpstreamRuntimeServer({
    database: input.database,
    source: input.source,
    credential: input.credential,
    userId: input.userId,
  });
  const upstreamHeaders = new Headers(
    upstream.headers.map((header) => [header.name, header.value]),
  );
  const authenticatedFetch = (resource: URL | RequestInfo, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of upstreamHeaders) {
      if (!headers.has(name)) {
        headers.set(name, value);
      }
    }
    return fetch(resource, { ...init, headers });
  };
  const transport =
    upstream.type === "sse"
      ? new SSEClientTransport(new URL(upstream.url), { fetch: authenticatedFetch })
      : new StreamableHTTPClientTransport(new URL(upstream.url), {
          fetch: authenticatedFetch,
        });
  const client = new Client(
    { name: "bap-workspace-policy-discovery", version: "1.0.0" },
    { capabilities: {} },
  );

  try {
    await withDiscoveryTimeout(client.connect(transport), input.source.name);
    const tools = await listAllTools(client, input.source.name);

    await persistWorkspaceMcpToolCatalog({
      database: input.database,
      workspaceMcpServerId: input.source.id,
      tools,
      markMissingUnavailable: true,
    });
  } finally {
    await withDiscoveryTimeout(client.close(), input.source.name).catch(() => undefined);
  }
}

export async function discoverWorkspaceMcpToolCatalog(input: {
  database?: Database;
  workspaceId: string;
  userId: string;
}): Promise<void> {
  const database = input.database ?? db;
  const [sources, credentials] = await Promise.all([
    database.query.workspaceMcpServer.findMany({
      where: and(
        eq(workspaceMcpServer.workspaceId, input.workspaceId),
        eq(workspaceMcpServer.enabled, true),
      ),
    }),
    database.query.workspaceMcpAuthorization.findMany({
      where: eq(workspaceMcpAuthorization.userId, input.userId),
    }),
  ]);
  const credentialByServerId = new Map(
    credentials.map((credential) => [credential.workspaceMcpServerId, credential]),
  );
  const governedSources = sources.filter(
    (source) => source.internalKey !== "gmail" && source.internalKey !== "bap",
  );
  const discoverableSources = (
    await Promise.all(
      governedSources.map(async (source) => {
        if (source.internalKey !== "galien" && source.internalKey !== "modulr") {
          return source;
        }
        return (await hasWorkspaceManagedMcpAccess({
          database,
          workspaceId: input.workspaceId,
          internalKey: source.internalKey,
          managedWorkspaceWideAccess: source.managedWorkspaceWideAccess,
        }))
          ? source
          : null;
      }),
    )
  ).filter((source): source is (typeof governedSources)[number] => Boolean(source));

  const results = await Promise.allSettled(
    discoverableSources.map((source) =>
      discoverServerTools({
        database,
        source,
        credential: credentialByServerId.get(source.id) ?? null,
        userId: input.userId,
      }),
    ),
  );

  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      console.warn("[WorkspaceMcpPolicy] Proactive tool discovery failed", {
        workspaceMcpServerId: discoverableSources[index]?.id,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }
}
