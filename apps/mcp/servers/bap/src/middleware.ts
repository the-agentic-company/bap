import { authenticateHostedMcpRequest, sendUnauthorizedMcpResponse } from "../../../shared/auth";
import {
  isManagedBapToolAllowed,
  type ManagedBapCapabilityProfile,
} from "@bap/core/server/managed-bap-capabilities";

export function filterManagedToolsListPayload(
  payload: unknown,
  surface: ManagedBapCapabilityProfile | undefined,
): unknown {
  if (Array.isArray(payload)) {
    return payload.map((entry) => filterManagedToolsListPayload(entry, surface));
  }
  if (!payload || typeof payload !== "object") return payload;
  const response = payload as { result?: { tools?: Array<{ name?: unknown }> } };
  if (!Array.isArray(response.result?.tools)) return payload;
  return {
    ...response,
    result: {
      ...response.result,
      tools: response.result.tools.filter(
        (tool) => typeof tool.name === "string" && isManagedBapToolAllowed(surface, tool.name),
      ),
    },
  };
}

function filterManagedToolsListResponse(
  res: any,
  surface: ManagedBapCapabilityProfile | undefined,
) {
  const chunks: Buffer[] = [];
  const originalWrite = res.write.bind(res);
  const originalWriteHead = res.writeHead.bind(res);
  const originalEnd = res.end.bind(res);
  let pendingWriteHead: unknown[] | undefined;
  res.writeHead = (...args: unknown[]) => {
    pendingWriteHead = args;
    return res;
  };
  const flushHeaders = () => {
    if (pendingWriteHead) {
      originalWriteHead(...pendingWriteHead);
      pendingWriteHead = undefined;
    }
  };
  res.write = (chunk: unknown, ..._args: unknown[]) => {
    if (chunk !== undefined) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return true;
  };
  res.end = (chunk?: unknown, ...args: unknown[]) => {
    if (chunk !== undefined) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    if (chunks.length > 0) {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        const filtered = filterManagedToolsListPayload(JSON.parse(text), surface);
        res.removeHeader?.("content-length");
        flushHeaders();
        return originalEnd(JSON.stringify(filtered), ...args);
      } catch {
        // Preserve framework error responses that are not JSON-RPC payloads.
      }
      flushHeaders();
      for (const buffered of chunks.slice(0, -1)) originalWrite(buffered);
      return originalEnd(chunks.at(-1), ...args);
    }
    flushHeaders();
    return originalEnd(undefined, ...args);
  };
}

export default async function bapMiddleware(req: any, res: any, next: () => void) {
  try {
    req.auth = await authenticateHostedMcpRequest({
      req,
      requiredAudience: "bap",
      // Platform MCP Server (ADR-0013): generations authenticate with managed
      // tokens minted per generation; external agents keep using OAuth.
      allowManagedToken: true,
    });
    if (req.auth.extra.authType === "managed") {
      const surface = req.auth.extra.surface;
      res.set?.("X-Bap-Mcp-Profile", surface ?? "chat");
      // xmcp parses JSON-RPC after user middleware, so filter every managed
      // JSON response. The helper changes only payloads containing result.tools.
      filterManagedToolsListResponse(res, surface);
    }
    next();
  } catch (error) {
    sendUnauthorizedMcpResponse({
      req,
      res,
      slug: "bap",
      message: error instanceof Error ? error.message : "Unauthorized",
    });
  }
}
