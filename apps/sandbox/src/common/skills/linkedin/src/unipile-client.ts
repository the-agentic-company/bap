import { buildUnipileBaseUrl } from "./identifiers";

type JsonValue = ReturnType<typeof JSON.parse>;

/**
 * Environment the Unipile client is configured from. Mirrors the three env vars the
 * skill reads at startup.
 */
export type UnipileEnv = {
  apiKey: string;
  dsn: string;
  accountId: string;
};

/**
 * The transport seam for the whole skill.
 *
 * Every LinkedIn operation goes through `request`. The client hides: base-URL
 * derivation from the DSN, the `X-API-KEY` / `Accept` auth headers, JSON vs FormData
 * content-type handling, and Unipile's non-2xx error shape (status + body). It also
 * carries the `accountId`, which nearly every endpoint needs as a query param or body
 * field, so callers never reach for a global.
 *
 * Deleting this module would scatter URL building, auth headers, content-type logic
 * and error formatting across every operation — it concentrates that complexity.
 */
export type UnipileClient = {
  /** The configured LinkedIn account id, threaded into endpoint params/bodies. */
  readonly accountId: string;
  /** True when API key, DSN and account id are all present. */
  isConfigured(): boolean;
  /** Perform an authenticated Unipile request. `endpoint` may be a path or absolute URL. */
  request<T = JsonValue>(endpoint: string, options?: RequestInit): Promise<T>;
};

export function createUnipileClient(env: UnipileEnv): UnipileClient {
  const baseUrl = buildUnipileBaseUrl(env.dsn);
  const baseHeaders = {
    "X-API-KEY": env.apiKey,
    Accept: "application/json",
  };

  async function request<T = JsonValue>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;
    const requestHeaders = new Headers(baseHeaders);

    if (options?.body && !(options.body instanceof FormData)) {
      requestHeaders.set("Content-Type", "application/json");
    }

    if (options?.headers) {
      const extraHeaders = new Headers(options.headers);
      extraHeaders.forEach((value, key) => {
        requestHeaders.set(key, value);
      });
    }

    const res = await fetch(url, {
      ...options,
      headers: requestHeaders,
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Unipile API Error (${res.status}): ${error}`);
    }

    return (await res.json()) as T;
  }

  return {
    accountId: env.accountId,
    isConfigured(): boolean {
      return Boolean(env.apiKey && env.accountId && baseUrl);
    },
    request,
  };
}
