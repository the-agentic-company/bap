import { isCloudEdition } from "@cmdclaw/core/server/edition";
import { db } from "@cmdclaw/db/client";
import { controlPlaneAuthRequest, controlPlaneLinkRequest } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/env";
import { auth } from "@/lib/auth";

const CONTROL_PLANE_INSTANCE_API_KEY_HEADER = "x-cmdclaw-instance-api-key";
const LINK_REQUEST_TTL_MS = 10 * 60 * 1000;

export function assertCloudControlPlaneEnabled() {
  if (!isCloudEdition()) {
    throw new Error("Control plane endpoints are only available in cloud edition");
  }
}

export function assertValidInstanceApiKey(request: Request) {
  assertCloudControlPlaneEnabled();

  const provided = request.headers.get(CONTROL_PLANE_INSTANCE_API_KEY_HEADER);
  if (!env.CMDCLAW_CLOUD_INSTANCE_API_KEY || provided !== env.CMDCLAW_CLOUD_INSTANCE_API_KEY) {
    throw new Error("Invalid instance API key");
  }
}

export async function requireCloudSession(request: Request) {
  const sessionData = await auth.api.getSession({
    headers: request.headers,
  });

  return sessionData;
}

export async function getValidLinkRequest(code: string) {
  const request = await db.query.controlPlaneLinkRequest.findFirst({
    where: eq(controlPlaneLinkRequest.code, code),
  });

  if (!request) {
    return null;
  }

  if (Date.now() - request.createdAt.getTime() > LINK_REQUEST_TTL_MS) {
    return null;
  }

  return request;
}

export async function getValidAuthRequest(code: string) {
  const request = await db.query.controlPlaneAuthRequest.findFirst({
    where: eq(controlPlaneAuthRequest.code, code),
  });

  if (!request) {
    return null;
  }

  if (Date.now() - request.createdAt.getTime() > LINK_REQUEST_TTL_MS) {
    return null;
  }

  return request;
}
