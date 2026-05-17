import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { getTrustedOrigins } from "@/lib/trusted-origins";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const trustedOrigins = new Set(getTrustedOrigins());
const DEFAULT_ALLOWED_ORIGIN =
  env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function getHostedMcpOauthCorsHeaders(origin: string | null): HeadersInit {
  const isAllowed = origin && (trustedOrigins.has(origin) || isLoopbackOrigin(origin));

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : DEFAULT_ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    "Access-Control-Allow-Credentials": "true",
  };
}

export function withHostedMcpOauthCors(request: NextRequest, response: Response): NextResponse {
  const corsHeaders = getHostedMcpOauthCorsHeaders(request.headers.get("origin"));
  const nextResponse = new NextResponse(response.body, response);

  Object.entries(corsHeaders).forEach(([key, value]) => {
    nextResponse.headers.set(key, value);
  });

  return nextResponse;
}

export function hostedMcpOauthOptionsResponse(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: getHostedMcpOauthCorsHeaders(request.headers.get("origin")),
  });
}
