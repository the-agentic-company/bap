import {
  buildWorkspaceMcpUpstreamRuntimeServer,
  getWorkspaceMcpAuthorizationUnavailableReason,
  isWorkspaceMcpServerVisibleForUser,
} from "@bap/core/server/executor/workspace-sources";
import { verifyManagedMcpToken } from "@bap/core/server/managed-mcp-auth";
import { generationInterruptService } from "@bap/core/server/services/generation-interrupt-service";
import { generationManager } from "@bap/core/server/services/generation-manager";
import {
  resolveWorkspaceIntegrationOperationPolicy,
  type WorkspaceIntegrationPolicySubject,
} from "@bap/core/server/services/workspace-integration-policy";
import { db } from "@bap/db/client";
import {
  generation,
  workspaceMember,
  workspaceMcpAuthorization,
  workspaceMcpServer,
} from "@bap/db/schema";
import { resolveManagedMcpTool } from "@bap/integration-policy";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { env } from "@/env";
import {
  persistWorkspaceMcpToolCatalog,
  type WorkspaceMcpToolDescriptor,
} from "./workspace-mcp-tool-catalog";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
] as const;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    cursor?: string;
  };
};

function policyDeniedResponse(
  id: JsonRpcRequest["id"],
  input: {
    subject: WorkspaceIntegrationPolicySubject;
    operationKey: string;
  },
): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: -32_003,
      message: "Blocked by Workspace policy.",
      data: {
        code: "WORKSPACE_POLICY_DENIED",
        operation: input.operationKey,
        subject: input.subject,
      },
    },
  });
}

function approvalRejectedResponse(id: JsonRpcRequest["id"]): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: -32_004,
      message: "The user rejected this operation.",
      data: { code: "APPROVAL_REJECTED" },
    },
  });
}

function approvalRequiredAfterPolicyChangeResponse(id: JsonRpcRequest["id"]): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code: -32_006,
      message: "Workspace policy changed; retry this operation to request approval.",
      data: { code: "WORKSPACE_POLICY_APPROVAL_REQUIRED_RETRY" },
    },
  });
}

function invalidJsonRpcResponse(message: string): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32_600, message },
    },
    { status: 400 },
  );
}

function invalidProxyToken(message = "Invalid Workspace MCP proxy token."): Response {
  return Response.json({ error: "unauthorized", message }, { status: 401 });
}

function copySelectedHeaders(source: Headers, names: readonly string[]): Headers {
  const result = new Headers();
  for (const name of names) {
    const value = source.get(name);
    if (value) {
      result.set(name, value);
    }
  }
  return result;
}

function getPolicySubject(
  source: typeof workspaceMcpServer.$inferSelect,
  toolName: string,
): {
  subject: WorkspaceIntegrationPolicySubject;
  operationKey: string;
} {
  if (source.internalKey === "gmail") {
    const managed = resolveManagedMcpTool(toolName);
    return {
      subject: {
        kind: "integration",
        integrationType: managed?.integrationType ?? "google_gmail",
      },
      operationKey: managed?.operationKey ?? toolName,
    };
  }

  return {
    subject: {
      kind: "workspace_mcp_server",
      workspaceMcpServerId: source.id,
    },
    operationKey: toolName,
  };
}

/**
 * Trusted, stateless policy boundary for Workspace MCP traffic.
 *
 * OpenCode receives only the proxy token. Upstream credentials are resolved here for
 * each request and never cross the runtime boundary.
 */
export async function handleWorkspaceMcpPolicyProxy(
  request: Request,
  workspaceMcpServerId: string,
): Promise<Response> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return invalidProxyToken();
  }

  let claims;
  try {
    claims = verifyManagedMcpToken(token, env.APP_SERVER_SECRET);
  } catch {
    return invalidProxyToken();
  }
  if (
    claims.internalKey !== "workspace-mcp-policy-proxy" ||
    claims.workspaceMcpServerId !== workspaceMcpServerId ||
    !claims.generationId
  ) {
    return invalidProxyToken();
  }

  const [source, generationRecord, membership] = await Promise.all([
    db.query.workspaceMcpServer.findFirst({
      where: and(
        eq(workspaceMcpServer.id, workspaceMcpServerId),
        eq(workspaceMcpServer.workspaceId, claims.workspaceId),
      ),
    }),
    db.query.generation.findFirst({
      where: eq(generation.id, claims.generationId),
      with: { conversation: true },
    }),
    db.query.workspaceMember.findFirst({
      where: and(
        eq(workspaceMember.organizationId, claims.workspaceId),
        eq(workspaceMember.userId, claims.userId),
      ),
      columns: { id: true },
    }),
  ]);

  if (
    !source ||
    !source.enabled ||
    source.internalKey === "bap" ||
    !membership ||
    !(await isWorkspaceMcpServerVisibleForUser({
      source,
      userId: claims.userId,
    })) ||
    !generationRecord ||
    generationRecord.conversation.workspaceId !== claims.workspaceId ||
    generationRecord.conversation.userId !== claims.userId
  ) {
    return invalidProxyToken("The Workspace MCP proxy scope is no longer valid.");
  }

  const requestBody =
    request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
  let rpcRequest: JsonRpcRequest | null = null;
  if (request.method === "POST" && requestBody) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(requestBody));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return invalidJsonRpcResponse("JSON-RPC batch requests are not supported.");
      }
      rpcRequest = parsed as JsonRpcRequest;
    } catch {
      return invalidJsonRpcResponse("Invalid JSON-RPC request.");
    }
  }

  let approvedProviderRequestId: string | null = null;
  if (rpcRequest?.method === "tools/call") {
    const toolName = rpcRequest.params?.name?.trim();
    if (!toolName) {
      return Response.json({ error: "missing_tool_name" }, { status: 400 });
    }
    const policyIdentity = getPolicySubject(source, toolName);
    const generationAutoApprove =
      generationRecord.executionPolicy?.autoApprove ?? generationRecord.conversation.autoApprove;
    const policy = await resolveWorkspaceIntegrationOperationPolicy({
      workspaceId: claims.workspaceId,
      ...policyIdentity,
      generationAutoApprove,
    });

    console.info("[WorkspaceMcpPolicy]", {
      generationId: claims.generationId,
      workspaceMcpServerId,
      operationKey: policyIdentity.operationKey,
      decision: policy.decision,
      source: policy.source,
    });

    if (policy.decision === "denied") {
      return policyDeniedResponse(rpcRequest.id, policyIdentity);
    }
    if (policy.decision === "requires_approval") {
      const providerRequestId = [
        "workspace-mcp",
        claims.generationId,
        workspaceMcpServerId,
        String(rpcRequest.id ?? "notification"),
        toolName,
        createHash("sha256")
          .update(JSON.stringify(rpcRequest.params?.arguments ?? {}))
          .digest("hex")
          .slice(0, 24),
      ].join(":");
      approvedProviderRequestId = providerRequestId;
      const approval = await generationManager.waitForApproval(claims.generationId, {
        integration: source.namespace,
        operation: policyIdentity.operationKey,
        command: `${source.namespace}.${toolName}`,
        toolInput: rpcRequest.params?.arguments ?? {},
        providerRequestId,
        deadlineAt: new Date(Math.min(claims.exp * 1000, generationRecord.deadlineAt.getTime())),
        deferApplicationClaim: true,
      });
      if (approval !== "allow") {
        return approvalRejectedResponse(rpcRequest.id);
      }
    }
  }

  try {
    verifyManagedMcpToken(token, env.APP_SERVER_SECRET);
  } catch {
    return invalidProxyToken("The Workspace MCP proxy token expired before execution.");
  }
  const [currentSource, currentCredential, currentMembership, currentGeneration] =
    await Promise.all([
      db.query.workspaceMcpServer.findFirst({
        where: and(
          eq(workspaceMcpServer.id, workspaceMcpServerId),
          eq(workspaceMcpServer.workspaceId, claims.workspaceId),
        ),
      }),
      db.query.workspaceMcpAuthorization.findFirst({
        where: and(
          eq(workspaceMcpAuthorization.workspaceMcpServerId, workspaceMcpServerId),
          eq(workspaceMcpAuthorization.userId, claims.userId),
        ),
      }),
      db.query.workspaceMember.findFirst({
        where: and(
          eq(workspaceMember.organizationId, claims.workspaceId),
          eq(workspaceMember.userId, claims.userId),
        ),
        columns: { id: true },
      }),
      db.query.generation.findFirst({
        where: eq(generation.id, claims.generationId),
        columns: { status: true, deadlineAt: true },
      }),
    ]);
  if (
    !currentSource ||
    !currentSource.enabled ||
    currentSource.internalKey === "bap" ||
    !currentMembership ||
    !currentGeneration ||
    currentGeneration.deadlineAt.getTime() <= Date.now() ||
    currentGeneration.status === "completed" ||
    currentGeneration.status === "cancelled" ||
    currentGeneration.status === "error" ||
    !(await isWorkspaceMcpServerVisibleForUser({
      source: currentSource,
      userId: claims.userId,
    }))
  ) {
    return invalidProxyToken("Workspace MCP access was revoked before execution.");
  }
  const credentialUnavailableReason = getWorkspaceMcpAuthorizationUnavailableReason(
    currentSource,
    currentCredential,
  );
  if (credentialUnavailableReason) {
    return invalidProxyToken(credentialUnavailableReason);
  }

  if (rpcRequest?.method === "tools/call") {
    const toolName = rpcRequest.params?.name?.trim();
    const policyIdentity = toolName ? getPolicySubject(currentSource, toolName) : null;
    if (policyIdentity) {
      const currentPolicy = await resolveWorkspaceIntegrationOperationPolicy({
        workspaceId: claims.workspaceId,
        ...policyIdentity,
        generationAutoApprove:
          generationRecord.executionPolicy?.autoApprove ??
          generationRecord.conversation.autoApprove,
      });
      if (currentPolicy.decision === "denied") {
        return policyDeniedResponse(rpcRequest.id, policyIdentity);
      }
      if (currentPolicy.decision === "requires_approval" && !approvedProviderRequestId) {
        return approvalRequiredAfterPolicyChangeResponse(rpcRequest.id);
      }
    }
  }

  const upstream = await buildWorkspaceMcpUpstreamRuntimeServer({
    source: currentSource,
    credential: currentCredential,
    userId: claims.userId,
    remoteIntegrationSource: claims.remoteIntegrationSource,
  });
  const upstreamHeaders = copySelectedHeaders(request.headers, FORWARDED_REQUEST_HEADERS);
  for (const header of upstream.headers) {
    upstreamHeaders.set(header.name, header.value);
  }

  if (approvedProviderRequestId) {
    const claimed = await generationInterruptService.claimInterruptApplicationByProviderRequestId({
      generationId: claims.generationId,
      providerRequestId: approvedProviderRequestId,
    });
    if (!claimed) {
      return Response.json({
        jsonrpc: "2.0",
        id: rpcRequest?.id ?? null,
        error: {
          code: -32_005,
          message: "This approved operation was already applied.",
          data: { code: "APPROVAL_ALREADY_APPLIED" },
        },
      });
    }
  }

  const upstreamResponse = await fetch(upstream.url, {
    method: request.method,
    headers: upstreamHeaders,
    body: requestBody,
    redirect: "manual",
  });
  const responseHeaders = copySelectedHeaders(upstreamResponse.headers, FORWARDED_RESPONSE_HEADERS);

  if (rpcRequest?.method === "tools/list" && upstreamResponse.ok) {
    const responseBody = await upstreamResponse.arrayBuffer();
    try {
      const response = JSON.parse(new TextDecoder().decode(responseBody)) as {
        result?: { tools?: WorkspaceMcpToolDescriptor[]; nextCursor?: string | null };
      };
      if (Array.isArray(response.result?.tools)) {
        await persistWorkspaceMcpToolCatalog({
          workspaceMcpServerId,
          tools: response.result.tools,
          markMissingUnavailable: !rpcRequest.params?.cursor && !response.result.nextCursor,
        });
      }
    } catch (error) {
      console.warn("[WorkspaceMcpPolicy] Could not persist tools/list response", {
        workspaceMcpServerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return new Response(responseBody, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
