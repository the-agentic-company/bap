import { auth } from "@/lib/auth";

/**
 * Framework-neutral handler for `GET /api/integrations/nango/providers`.
 *
 * Fetches the Nango provider catalog, normalizes each entry, and returns a sorted list.
 * Authorization stays inside the handler (Better Auth session check) so the route adapter
 * remains thin.
 */

type NangoProvider = {
  name: string;
  displayName: string;
  logoUrl: string | null;
  authMode: string | null;
  categories: string[];
  docs: string | null;
};

function normalizeProvider(input: unknown): NangoProvider | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as Record<string, unknown>;
  const nameCandidates = [value.name, value.provider, value.config_key, value.slug];
  const displayNameCandidates = [value.display_name, value.displayName, value.name, value.provider];

  const name =
    nameCandidates.find((candidate): candidate is string => typeof candidate === "string") ?? null;
  const displayName =
    displayNameCandidates.find((candidate): candidate is string => typeof candidate === "string") ??
    null;

  if (!name || !displayName) {
    return null;
  }

  const logoUrlCandidate = [value.logo_url, value.logo, value.logoUrl].find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  );

  const authModeCandidate = [value.auth_mode, value.authMode, value.auth_type].find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  );

  const docsCandidate = [value.docs, value.docs_url, value.documentation_url].find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  );

  const categoriesValue = value.categories;
  const categories = Array.isArray(categoriesValue)
    ? categoriesValue.filter((category): category is string => typeof category === "string")
    : [];

  return {
    name,
    displayName,
    logoUrl: logoUrlCandidate ?? null,
    authMode: authModeCandidate ?? null,
    categories,
    docs: docsCandidate ?? null,
  };
}

export async function handleNangoProviders(request: Request): Promise<Response> {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  if (!sessionData?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nangoSecretKey = process.env.NANGO_SECRET_KEY;
  if (!nangoSecretKey) {
    return Response.json(
      {
        providers: [],
        error: "Missing NANGO_SECRET_KEY",
      },
      { status: 200 },
    );
  }

  try {
    const response = await fetch("https://api.nango.dev/providers", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${nangoSecretKey}`,
      },
    });

    if (!response.ok) {
      const details = await response.text();
      console.error("[Nango] Failed to fetch providers", response.status, details);
      return Response.json({ error: "Failed to fetch providers" }, { status: 502 });
    }

    const payload = (await response.json()) as unknown;
    const list = Array.isArray(payload)
      ? payload
      : payload &&
          typeof payload === "object" &&
          Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : [];

    const providers = list
      .map(normalizeProvider)
      .filter((provider): provider is NangoProvider => provider !== null)
      .toSorted((a, b) => a.displayName.localeCompare(b.displayName));

    return Response.json({ providers });
  } catch (error) {
    console.error("[Nango] Unexpected error while fetching providers", error);
    return Response.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}
