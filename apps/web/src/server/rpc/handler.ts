import { createHash } from "node:crypto";
import {
  extractHttpTraceContext,
  recordCounter,
  recordHistogram,
  startActiveServerSpan,
} from "@bap/core/server/utils/observability";
import { RPCHandler } from "@orpc/server/fetch";
import { appRouter } from "@/server/orpc";
import { createORPCContext } from "@/server/orpc/context";
import { authorizeManagedBapRpcRequest } from "./managed-bap-authorization";

/**
 * Framework-neutral oRPC HTTP handler. oRPC stays the product API layer; this
 * module preserves the frozen `/api/rpc` contract: supported HTTP methods,
 * no-store/private cache headers, streaming responses, 401 login-debug logging,
 * and the request counter/duration metrics + tracing span. It speaks standard
 * `Request`/`Response`/`Headers` only — no framework imports — so the TanStack
 * Start route file stays a thin adapter.
 */

const handler = new RPCHandler(appRouter);

const RPC_PREFIX = "/api/rpc";

function isSkillUpdateFilePath(request: Request): boolean {
  return new URL(request.url).pathname === "/api/rpc/skill/updateFile";
}

function getCookieValue(cookieHeader: string, cookieName: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${cookieName}=`));

  if (!match) {
    return null;
  }

  return match.slice(cookieName.length + 1);
}

function logUnauthorizedRpcRequest(request: Request, response: Response): void {
  if (response.status !== 401) {
    return;
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const secureSessionToken = getCookieValue(cookieHeader, "__Secure-better-auth.session_token");
  const regularSessionToken = getCookieValue(cookieHeader, "better-auth.session_token");
  const sessionToken = secureSessionToken ?? regularSessionToken;

  console.warn("[Auth Debug] RPC request returned 401", {
    path: new URL(request.url).pathname,
    method: request.method,
    hasSessionCookie: Boolean(sessionToken),
    sessionCookieName: secureSessionToken
      ? "__Secure-better-auth.session_token"
      : regularSessionToken
        ? "better-auth.session_token"
        : null,
    sessionCookieFingerprint: sessionToken
      ? createHash("sha256").update(sessionToken).digest("hex").slice(0, 12)
      : null,
    userAgent: request.headers.get("user-agent"),
    referer: request.headers.get("referer"),
  });
}

/**
 * Applies the frozen no-store/private cache contract to the oRPC response while
 * preserving the streaming body untouched.
 */
export function withNoStore(response: Response): Response {
  const nextHeaders = new Headers(response.headers);
  nextHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  nextHeaders.set("Pragma", "no-cache");
  nextHeaders.set("Expires", "0");
  nextHeaders.append("Vary", "Cookie");
  nextHeaders.append("Vary", "Authorization");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders,
  });
}

export async function handleRpcRequest(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const startedAt = performance.now();
  const baseAttributes = {
    route: requestUrl.pathname,
    method: request.method,
  };

  return startActiveServerSpan(
    `rpc ${request.method} ${requestUrl.pathname}`,
    {
      attributes: baseAttributes,
      parentContext: extractHttpTraceContext(request.headers),
    },
    async () => {
      try {
        let response: Response | null = null;

        if (isSkillUpdateFilePath(request)) {
          console.info("[RPC Debug] Incoming skill/updateFile request", {
            method: request.method,
            route: requestUrl.pathname,
            origin: request.headers.get("origin"),
            referer: request.headers.get("referer"),
            userAgent: request.headers.get("user-agent"),
            contentType: request.headers.get("content-type"),
            hasCookieHeader: Boolean(request.headers.get("cookie")),
            xForwardedFor: request.headers.get("x-forwarded-for"),
            cfRay: request.headers.get("cf-ray"),
          });
        }

        const context = await createORPCContext({ headers: request.headers });
        const authorization = await authorizeManagedBapRpcRequest({ request, context });
        if (!authorization.allowed) {
          return withNoStore(
            Response.json({ error: authorization.message }, { status: authorization.status }),
          );
        }
        const handlerResult = await handler.handle(request, {
          prefix: RPC_PREFIX,
          context,
        });

        response = handlerResult.response ?? new Response("Not found", { status: 404 });
        logUnauthorizedRpcRequest(request, response);

        if (isSkillUpdateFilePath(request)) {
          let responseBody: string | null = null;

          try {
            responseBody = await response.clone().text();
          } catch (error) {
            responseBody = `[failed to read response body: ${String(error)}]`;
          }

          console.info("[RPC Debug] Completed skill/updateFile request", {
            method: request.method,
            route: requestUrl.pathname,
            status: response.status,
            responseContentType: response.headers.get("content-type"),
            responseBody,
          });
        }

        recordCounter(
          "bap_rpc_requests_total",
          1,
          {
            ...baseAttributes,
            status_code: response.status,
          },
          "Count of RPC requests handled by the Bap web server.",
        );
        recordHistogram(
          "bap_rpc_request_duration_ms",
          performance.now() - startedAt,
          {
            ...baseAttributes,
            status_code: response.status,
          },
          "Duration of RPC requests handled by the Bap web server.",
        );

        return withNoStore(response);
      } catch (error) {
        console.error("[RPC Handler Error]", error);

        recordCounter(
          "bap_rpc_requests_total",
          1,
          {
            ...baseAttributes,
            status_code: 500,
          },
          "Count of RPC requests handled by the Bap web server.",
        );
        recordHistogram(
          "bap_rpc_request_duration_ms",
          performance.now() - startedAt,
          {
            ...baseAttributes,
            status_code: 500,
          },
          "Duration of RPC requests handled by the Bap web server.",
        );

        return withNoStore(
          new Response(JSON.stringify({ error: String(error) }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    },
  );
}
