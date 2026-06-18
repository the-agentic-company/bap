import {
  normalizeLinkedInCompanyIdentifier,
  normalizeLinkedInProfileIdentifier,
} from "./identifiers";
import { mapUserSummary, type UserSummary } from "./mappers";
import type { UnipileClient } from "./unipile-client";

type JsonValue = ReturnType<typeof JSON.parse>;
type JsonRecord = Record<string, JsonValue>;

/**
 * Identity resolution for LinkedIn entities, shared by messaging, posts and company
 * operations.
 *
 * It owns the per-process user-summary cache (so a chat list that mentions the same
 * person ten times hits the API once) and the "give me a provider id from whatever the
 * user typed" resolvers. Messaging, posts and company pages all need these; deleting
 * this module would re-spread the cache and the resolve-by-handle logic across them.
 */
export type Directory = {
  /** Resolve a provider id to a {@link UserSummary}, memoized for the process. */
  getUserSummary(providerId: unknown): Promise<UserSummary | null>;
  /** Fetch the most recent message of a chat, or null when empty. */
  getLatestMessage(chatId: string): Promise<JsonRecord | null>;
  /** Resolve a profile handle/URL (or the current user when omitted) to a provider id. */
  resolveProfileProviderId(identifier?: string): Promise<string>;
  /** Resolve a company slug/URL to its Unipile company id. */
  resolveCompanyProviderId(identifier: string): Promise<string>;
};

export function createDirectory(client: UnipileClient): Directory {
  const accountId = client.accountId;
  const userSummaryCache = new Map<string, Promise<UserSummary | null>>();

  function getUserSummary(providerId: unknown): Promise<UserSummary | null> {
    if (typeof providerId !== "string" || providerId.length === 0) {
      return Promise.resolve(null);
    }

    const cached = userSummaryCache.get(providerId);
    if (cached) {
      return cached;
    }

    const promise = (async () => {
      try {
        const profile = await client.request<JsonRecord>(
          `/users/${encodeURIComponent(providerId)}?account_id=${accountId}`,
        );
        return mapUserSummary(profile);
      } catch {
        return null;
      }
    })();

    userSummaryCache.set(providerId, promise);
    return promise;
  }

  async function getLatestMessage(chatId: string): Promise<JsonRecord | null> {
    const params = new URLSearchParams({ account_id: accountId, limit: "1" });
    const response = await client.request<JsonRecord>(`/chats/${chatId}/messages?${params}`);
    const items = Array.isArray(response.items) ? response.items : [];
    const firstItem = items[0];

    if (!firstItem || typeof firstItem !== "object") {
      return null;
    }

    return firstItem as JsonRecord;
  }

  async function resolveProfileProviderId(identifier?: string): Promise<string> {
    if (!identifier) {
      const me = await client.request<JsonRecord>(`/users/me?account_id=${accountId}`);
      if (typeof me.provider_id !== "string" || me.provider_id.length === 0) {
        throw new Error("Could not resolve the current LinkedIn profile provider ID.");
      }
      return me.provider_id;
    }

    const normalizedIdentifier = normalizeLinkedInProfileIdentifier(identifier) ?? identifier;
    const profile = await client.request<JsonRecord>(
      `/users/${encodeURIComponent(normalizedIdentifier)}?account_id=${accountId}`,
    );

    if (typeof profile.provider_id !== "string" || profile.provider_id.length === 0) {
      throw new Error(`Could not resolve LinkedIn provider ID for profile: ${identifier}`);
    }

    return profile.provider_id;
  }

  async function resolveCompanyProviderId(identifier: string): Promise<string> {
    const normalizedIdentifier = normalizeLinkedInCompanyIdentifier(identifier) ?? identifier;
    const company = await client.request<JsonRecord>(
      `/linkedin/company/${encodeURIComponent(normalizedIdentifier)}?account_id=${accountId}`,
    );

    if (typeof company.id !== "string" || company.id.length === 0) {
      throw new Error(`Could not resolve LinkedIn company ID for: ${identifier}`);
    }

    return company.id;
  }

  return {
    getUserSummary,
    getLatestMessage,
    resolveProfileProviderId,
    resolveCompanyProviderId,
  };
}
