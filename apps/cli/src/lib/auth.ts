import {
  createRpcClient,
  defaultProfileStore,
  type CmdclawApiClient,
  type CmdclawProfile,
} from "@cmdclaw/client";
import { closePool, db } from "@cmdclaw/db/client";
import { session, user } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolveServerUrl } from "./client";

const DEFAULT_CHAT_AUTH_EMAIL = "cmdclaw@example.com";
const DEFAULT_CHAT_AUTH_NAME = "Baptiste";
const DEFAULT_CLIENT_ID = "cmdclaw-cli";

type AuthenticatedClient = {
  serverUrl: string;
  profile: CmdclawProfile;
  client: CmdclawApiClient;
};

type LoginOptions = {
  open?: boolean;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function isLocalServerUrl(serverUrl: string): boolean {
  try {
    const url = new URL(serverUrl);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function shouldUseRemoteTestLogin(): boolean {
  return Boolean(
    process.env.APP_SERVER_SECRET?.trim() &&
      (process.env.CI === "true" || process.env.E2E_LIVE === "1"),
  );
}

async function readResponseErrorSnippet(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await res.text();
  }

  const text = await res.text();
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.toLowerCase().startsWith("<!doctype html>")) {
    return "HTML error page";
  }
  return normalized.slice(0, 240);
}

async function loginWithRemoteTestSession(serverUrl: string): Promise<CmdclawProfile> {
  const secret = process.env.APP_SERVER_SECRET?.trim();
  if (!secret) {
    throw new Error("APP_SERVER_SECRET is required for remote test login.");
  }

  const email =
    process.env.CHAT_AUTH_EMAIL ||
    process.env.E2E_TEST_EMAIL ||
    process.env.APP_DEFAULT_USER_EMAIL?.trim() ||
    DEFAULT_CHAT_AUTH_EMAIL;
  const name = process.env.CHAT_AUTH_NAME || DEFAULT_CHAT_AUTH_NAME;
  const ttlHours = parsePositiveInt(process.env.CHAT_SESSION_TTL_HOURS, 24);

  console.log(`\nAuthenticating test session with ${serverUrl}\n`);

  const res = await fetch(`${serverUrl}/api/internal/testing/cli-session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, name, ttlHours }),
  });

  if (!res.ok) {
    throw new Error(`Failed to request remote test session: ${res.status} ${await readResponseErrorSnippet(res)}`);
  }

  const data = (await res.json()) as {
    token?: string;
    expiresAt?: string;
  };

  if (!data.token) {
    throw new Error("Remote test session response did not include a token.");
  }

  const profile = {
    serverUrl,
    token: data.token,
  };
  defaultProfileStore.save(profile);

  if (data.expiresAt) {
    console.log(`Test session valid until ${data.expiresAt}`);
  }

  return profile;
}

function openUrlInBrowser(url: string): boolean {
  try {
    const commandByPlatform: Record<string, { cmd: string; args: string[] }> = {
      darwin: { cmd: "open", args: [url] },
      linux: { cmd: "xdg-open", args: [url] },
      win32: { cmd: "cmd", args: ["/c", "start", "", url] },
    };
    const command = commandByPlatform[process.platform];
    if (!command) {
      return false;
    }
    const child = spawn(command.cmd, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  if (typeof code === "string" && code === "UNAUTHORIZED") {
    return true;
  }

  const message = "message" in error ? error.message : undefined;
  return typeof message === "string" && message.includes("You must be logged in");
}

function getLoginInstruction(serverUrl: string): string {
  return `Run 'bun run cmdclaw -- auth login --server ${serverUrl}' first.`;
}

async function bootstrapLocalProfileAndClose(serverUrl: string): Promise<CmdclawProfile> {
  try {
    return await bootstrapLocalProfile(serverUrl);
  } finally {
    await closePool().catch(() => undefined);
  }
}

async function bootstrapLocalProfile(serverUrl: string): Promise<CmdclawProfile> {
  const now = new Date();
  const email =
    process.env.CHAT_AUTH_EMAIL ||
    process.env.E2E_TEST_EMAIL ||
    process.env.APP_DEFAULT_USER_EMAIL?.trim() ||
    DEFAULT_CHAT_AUTH_EMAIL;
  const name = process.env.CHAT_AUTH_NAME || DEFAULT_CHAT_AUTH_NAME;

  const existingUser = await db.query.user.findFirst({
    where: eq(user.email, email),
  });

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    await db
      .update(user)
      .set({
        name,
        emailVerified: true,
        onboardedAt: existingUser.onboardedAt ?? now,
        updatedAt: now,
      })
      .where(eq(user.id, existingUser.id));
  } else {
    userId = randomUUID();
    await db.insert(user).values({
      id: userId,
      email,
      name,
      emailVerified: true,
      onboardedAt: now,
      role: "user",
      createdAt: now,
      updatedAt: now,
    });
  }

  const ttlHours = parsePositiveInt(process.env.CHAT_SESSION_TTL_HOURS, 24);
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const token = randomBytes(48).toString("hex");

  await db.insert(session).values({
    id: randomUUID(),
    userId,
    token,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ipAddress: "127.0.0.1",
    userAgent: "cmdclaw-cli-auth-bootstrap",
  });

  const profile = { serverUrl, token };
  defaultProfileStore.save(profile);
  return profile;
}

async function loginWithDeviceCode(
  serverUrl: string,
  options: LoginOptions = {},
): Promise<CmdclawProfile> {
  console.log(`\nAuthenticating with ${serverUrl}\n`);

  const res = await fetch(`${serverUrl}/api/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.CMDCLAW_CLI_CLIENT_ID || DEFAULT_CLIENT_ID,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to request device code: ${res.status}`);
  }

  const data = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    interval?: number;
    expires_in?: number;
  };

  const verificationUri = data.verification_uri_complete || data.verification_uri;
  if (!verificationUri) {
    throw new Error("Device auth response did not include a verification URL.");
  }

  console.log("Visit the following URL and enter the code:\n");
  console.log(`  ${verificationUri}\n`);
  console.log(`  Code: ${data.user_code}\n`);

  if (options.open && openUrlInBrowser(verificationUri)) {
    console.log("Opened the browser for you.\n");
  }

  console.log("Waiting for approval...\n");

  let pollingInterval = (data.interval || 5) * 1000;
  const deadline = Date.now() + (data.expires_in || 1800) * 1000;

  while (Date.now() < deadline) {
    await sleep(pollingInterval);

    const tokenRes = await fetch(`${serverUrl}/api/auth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: data.device_code,
        client_id: process.env.CMDCLAW_CLI_CLIENT_ID || DEFAULT_CLIENT_ID,
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
    };

    if (tokenData.access_token) {
      const profile = {
        serverUrl,
        token: tokenData.access_token,
      };
      defaultProfileStore.save(profile);
      return profile;
    }

    switch (tokenData.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        pollingInterval += 5000;
        break;
      case "expired_token":
        throw new Error("Device code expired. Please try again.");
      case "access_denied":
        throw new Error("Authentication denied.");
      default:
        break;
    }
  }

  throw new Error("Device code expired. Please try again.");
}

export async function login(
  serverUrlInput?: string,
  token?: string,
  options: LoginOptions = {},
): Promise<CmdclawProfile> {
  const serverUrl = resolveServerUrl(serverUrlInput);

  if (token) {
    const profile = { serverUrl, token };
    defaultProfileStore.save(profile);
    return profile;
  }

  if (isLocalServerUrl(serverUrl)) {
    return bootstrapLocalProfileAndClose(serverUrl);
  }

  if (shouldUseRemoteTestLogin()) {
    return loginWithRemoteTestSession(serverUrl);
  }

  return loginWithDeviceCode(serverUrl, options);
}

export async function ensureAuthenticatedClient(params?: {
  serverUrl?: string;
  token?: string;
}): Promise<AuthenticatedClient> {
  const serverUrl = resolveServerUrl(params?.serverUrl);

  if (params?.token) {
    const client = createRpcClient(serverUrl, params.token);
    try {
      await client.user.me();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        throw new Error(`Provided token is invalid for ${serverUrl}. ${getLoginInstruction(serverUrl)}`);
      }
      throw error;
    }
    return {
      serverUrl,
      profile: { serverUrl, token: params.token },
      client,
    };
  }

  let profile = defaultProfileStore.load(serverUrl);
  if (!profile?.token) {
    if (!isLocalServerUrl(serverUrl)) {
      throw new Error(`Not authenticated for ${serverUrl}. ${getLoginInstruction(serverUrl)}`);
    }

    profile = await bootstrapLocalProfileAndClose(serverUrl);
  }

  let client = createRpcClient(serverUrl, profile.token);

  try {
    await client.user.me();
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      throw error;
    }

    if (!isLocalServerUrl(serverUrl)) {
      throw new Error(`Authentication expired or is invalid for ${serverUrl}. ${getLoginInstruction(serverUrl)}`);
    }

    profile = await bootstrapLocalProfileAndClose(serverUrl);
    client = createRpcClient(serverUrl, profile.token);
    await client.user.me();
  }

  return { serverUrl, profile, client };
}

export async function authStatus(serverUrlInput?: string): Promise<{
  serverUrl: string;
  configPath: string;
  profile: CmdclawProfile | null;
  user: { id: string; email: string } | null;
}> {
  const serverUrl = resolveServerUrl(serverUrlInput);
  const profile = defaultProfileStore.load(serverUrl);
  const configPath = defaultProfileStore.getConfigPathForServerUrl(serverUrl);

  if (!profile?.token) {
    return {
      serverUrl,
      configPath,
      profile: null,
      user: null,
    };
  }

  try {
    const client = createRpcClient(serverUrl, profile.token);
    const currentUser = await client.user.me();
    return {
      serverUrl,
      configPath,
      profile,
      user: currentUser,
    };
  } catch {
    return {
      serverUrl,
      configPath,
      profile,
      user: null,
    };
  }
}
