import { registerHostedMcpClient } from "@/server/hosted-mcp-oauth";
import { hostedMcpOauthOptionsResponse, withHostedMcpOauthCors } from "./cors";

/**
 * Framework-neutral handlers for the hosted MCP OAuth dynamic client
 * registration endpoint (`/api/mcp/oauth/register`). Accepts RFC 7591 client
 * metadata, registers a public client, and returns it with dynamic CORS headers
 * and `Cache-Control: no-store`. Uses only standard `Request`/`Response` -- no
 * Next imports.
 */

export function handleHostedMcpRegisterOptions(request: Request): Response {
  return hostedMcpOauthOptionsResponse(request);
}

export async function handleHostedMcpRegisterPost(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      redirect_uris?: string[];
      token_endpoint_auth_method?: string;
      grant_types?: string[];
      response_types?: string[];
      client_name?: string;
      client_uri?: string;
      logo_uri?: string;
      contacts?: string[];
      policy_uri?: string;
      tos_uri?: string;
      scope?: string;
    };

    const registered = await registerHostedMcpClient(body);
    return withHostedMcpOauthCors(
      request,
      Response.json(registered, {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
        },
      }),
    );
  } catch (error) {
    return withHostedMcpOauthCors(
      request,
      Response.json(
        {
          error: "invalid_client_metadata",
          error_description: error instanceof Error ? error.message : "Invalid client metadata",
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
