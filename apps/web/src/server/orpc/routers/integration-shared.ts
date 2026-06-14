import { type IntegrationType } from "@bap/core/server/oauth/config";
import { user, googleIntegrationAccessAllowlist } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type AuthenticatedContext } from "../middleware";

export const GOOGLE_INTEGRATION_TYPES = new Set<IntegrationType>([
  "google_gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
]);
export const GOOGLE_ACCESS_REQUEST_SLACK_CHANNEL_NAME = "google-oauth-access-for-users";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSlackChannelName(value: string): string {
  return value.trim().replace(/^#/, "").toLowerCase();
}

export function getSlackBotToken(): string | null {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  return token ? token : null;
}

export async function ensureAdmin(context: AuthenticatedContext) {
  const dbUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
    columns: { role: true },
  });

  if (dbUser?.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
  }
}

export async function canUserAccessGoogleIntegrations(context: AuthenticatedContext) {
  const dbUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
    columns: { role: true, email: true },
  });

  if (dbUser?.role === "admin") {
    return true;
  }

  const normalizedEmail =
    typeof dbUser?.email === "string" && dbUser.email.length > 0
      ? normalizeEmail(dbUser.email)
      : null;

  if (!normalizedEmail) {
    return false;
  }

  const allowlisted = await context.db.query.googleIntegrationAccessAllowlist.findFirst({
    where: eq(googleIntegrationAccessAllowlist.email, normalizedEmail),
    columns: { id: true },
  });

  return Boolean(allowlisted);
}

export async function lookupSlackChannelIdByName(
  channelName: string,
  slackBotToken: string,
): Promise<string> {
  const targetName = normalizeSlackChannelName(channelName);
  const lookupPage = async (cursor?: string): Promise<string> => {
    const params = new URLSearchParams({
      exclude_archived: "true",
      limit: "200",
      types: "public_channel,private_channel,mpim",
    });
    if (cursor) {
      params.set("cursor", cursor);
    }

    const response = await fetch(`https://slack.com/api/conversations.list?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
      },
    });

    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
      channels?: Array<{ id: string; name?: string; name_normalized?: string }>;
      response_metadata?: { next_cursor?: string };
    };

    if (!result.ok) {
      throw new Error(result.error ?? "Could not list Slack channels");
    }

    const match = result.channels?.find((channel) => {
      const name = channel.name_normalized ?? channel.name;
      if (!name) {
        return false;
      }
      return normalizeSlackChannelName(name) === targetName;
    });
    if (match?.id) {
      return match.id;
    }

    const nextCursor = result.response_metadata?.next_cursor?.trim();
    if (!nextCursor) {
      throw new Error(`Slack channel not found: ${channelName}`);
    }

    return lookupPage(nextCursor);
  };

  return lookupPage();
}

export async function postSlackMessage(channelId: string, text: string, slackBotToken: string) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackBotToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      text,
    }),
  });

  return response.json() as Promise<{ ok: boolean; error?: string }>;
}

// PKCE helpers for Airtable OAuth
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export const integrationTypeSchema = z.enum([
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
  "reddit",
  "twitter",
]);

export const googleIntegrationTypeSchema = z.enum([
  "google_gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
]);
