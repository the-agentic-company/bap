import {
  exchangeHostedMcpAuthorizationCode,
  exchangeHostedMcpRefreshToken,
  getHostedMcpClient,
} from "@/server/hosted-mcp-oauth";
import { hostedMcpOauthOptionsResponse, withHostedMcpOauthCors } from "./cors";

/**
 * Framework-neutral handlers for the hosted MCP OAuth token endpoint
 * (`/api/mcp/oauth/token`). Supports the `authorization_code` and
 * `refresh_token` grant types for public (PKCE) clients. All responses carry
 * dynamic CORS headers and `Cache-Control: no-store`. Uses only standard
 * `Request`/`Response` -- no Next imports.
 */

async function resolveClientFromTokenRequest(formData: FormData) {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) {
    throw new Error("client_id is required.");
  }

  const client = await getHostedMcpClient(clientId);
  if (!client) {
    throw new Error("Unknown OAuth client.");
  }
  if (client.tokenEndpointAuthMethod !== "none") {
    throw new Error("Unsupported token endpoint auth method.");
  }

  return client;
}

export function handleHostedMcpTokenOptions(request: Request): Response {
  return hostedMcpOauthOptionsResponse(request);
}

export async function handleHostedMcpTokenPost(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const grantType = String(formData.get("grant_type") ?? "").trim();
    const client = await resolveClientFromTokenRequest(formData);

    if (grantType === "authorization_code") {
      const code = String(formData.get("code") ?? "").trim();
      const codeVerifier = String(formData.get("code_verifier") ?? "").trim();
      const redirectUri = String(formData.get("redirect_uri") ?? "").trim() || null;
      const resource = String(formData.get("resource") ?? "").trim() || null;

      if (!code || !codeVerifier) {
        throw new Error("code and code_verifier are required.");
      }

      const tokens = await exchangeHostedMcpAuthorizationCode({
        request,
        clientId: client.clientId,
        code,
        codeVerifier,
        redirectUri,
        resource,
      });
      return withHostedMcpOauthCors(
        request,
        Response.json(tokens, {
          headers: {
            "Cache-Control": "no-store",
          },
        }),
      );
    }

    if (grantType === "refresh_token") {
      const refreshToken = String(formData.get("refresh_token") ?? "").trim();
      const resource = String(formData.get("resource") ?? "").trim() || null;
      if (!refreshToken) {
        throw new Error("refresh_token is required.");
      }

      const tokens = await exchangeHostedMcpRefreshToken({
        request,
        clientId: client.clientId,
        refreshToken,
        resource,
      });
      return withHostedMcpOauthCors(
        request,
        Response.json(tokens, {
          headers: {
            "Cache-Control": "no-store",
          },
        }),
      );
    }

    return withHostedMcpOauthCors(
      request,
      Response.json(
        {
          error: "unsupported_grant_type",
          error_description: "The grant type is not supported by this authorization server.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      ),
    );
  } catch (error) {
    return withHostedMcpOauthCors(
      request,
      Response.json(
        {
          error: "invalid_grant",
          error_description: error instanceof Error ? error.message : "Token exchange failed",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      ),
    );
  }
}
