import { createFileRoute } from "@tanstack/react-router";
import {
  handleHostedMcpRegisterOptions,
  handleHostedMcpRegisterPost,
} from "./-handlers/register";

/**
 * Server route for `/api/mcp/oauth/register`. Thin adapter over the
 * framework-neutral dynamic client registration handlers, including the CORS
 * preflight (OPTIONS).
 */
export const Route = createFileRoute("/api/mcp/oauth/register")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => handleHostedMcpRegisterOptions(request),
      POST: ({ request }) => handleHostedMcpRegisterPost(request),
    },
  },
});
