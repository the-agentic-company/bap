import { limitOf, type OperationContext } from "./context";
import { normalizeLinkedInCompanyIdentifier, normalizeLinkedInProfileIdentifier } from "./identifiers";

type JsonValue = ReturnType<typeof JSON.parse>;
type JsonRecord = Record<string, JsonValue>;

/**
 * Profile, company-profile and people-search read operations.
 */

export async function getMyProfile(ctx: OperationContext): Promise<void> {
  const { client } = ctx;
  const data = await client.request<JsonRecord>(`/users/me?account_id=${client.accountId}`);
  let headline = typeof data.headline === "string" ? data.headline : null;

  if (!headline && typeof data.public_identifier === "string" && data.public_identifier.length > 0) {
    const fullProfile = await client.request<JsonRecord>(
      `/users/${encodeURIComponent(data.public_identifier)}?account_id=${client.accountId}`,
    );
    headline = typeof fullProfile.headline === "string" ? fullProfile.headline : null;
  }

  console.log(
    JSON.stringify(
      {
        id: data.provider_id,
        name: data.display_name,
        headline,
        location: data.location,
        profileUrl: data.public_identifier,
        connectionsCount: data.connections_count,
      },
      null,
      2,
    ),
  );
}

export async function getProfile(ctx: OperationContext, identifier: string): Promise<void> {
  const { client } = ctx;
  const normalizedIdentifier = normalizeLinkedInProfileIdentifier(identifier) ?? identifier;
  const data = await client.request(
    `/users/${encodeURIComponent(normalizedIdentifier)}?account_id=${client.accountId}`,
  );
  console.log(
    JSON.stringify(
      {
        id: data.provider_id,
        name: data.display_name,
        headline: data.headline,
        location: data.location,
        profileUrl: data.public_identifier,
        connectionsCount: data.connections_count,
        company: data.current_company,
        summary: data.summary,
      },
      null,
      2,
    ),
  );
}

export async function getCompanyProfile(ctx: OperationContext, identifier: string): Promise<void> {
  const { client } = ctx;
  const normalizedIdentifier = normalizeLinkedInCompanyIdentifier(identifier) ?? identifier;
  const data = await client.request(
    `/linkedin/company/${encodeURIComponent(normalizedIdentifier)}?account_id=${client.accountId}`,
  );
  console.log(
    JSON.stringify(
      {
        id: data.id,
        name: data.name,
        description: data.description,
        industry: data.industry,
        employeeCount: data.employee_count,
        website: data.website,
        headquarters: Array.isArray(data.locations)
          ? (data.locations.find(
              (location): location is JsonRecord =>
                typeof location === "object" &&
                location !== null &&
                location.is_headquarter === true,
            ) ?? null)
          : null,
      },
      null,
      2,
    ),
  );
}

export async function searchUsers(ctx: OperationContext, query: string): Promise<void> {
  const { client, values } = ctx;
  const limit = limitOf(values, "20");
  const params = new URLSearchParams({ account_id: client.accountId, limit: limit.toString() });
  if (values.cursor) {
    params.set("cursor", values.cursor);
  }

  const data = await client.request(`/linkedin/search?${params}`, {
    method: "POST",
    body: JSON.stringify({ api: "classic", category: "people", keywords: query }),
  });

  const items = Array.isArray(data.items) ? (data.items as JsonRecord[]) : [];
  const users = items.map((u) => ({
    id: u.id ?? u.provider_id ?? null,
    name:
      typeof u.name === "string"
        ? u.name
        : typeof u.display_name === "string"
          ? u.display_name
          : null,
    headline: typeof u.headline === "string" ? u.headline : null,
    profileUrl:
      normalizeLinkedInProfileIdentifier(u.public_identifier) ??
      normalizeLinkedInProfileIdentifier(u.profile_url) ??
      null,
    location: typeof u.location === "string" ? u.location : null,
  }));

  console.log(JSON.stringify({ items: users, cursor: data.cursor }, null, 2));
}
