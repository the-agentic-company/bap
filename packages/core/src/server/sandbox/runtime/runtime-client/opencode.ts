import {
  createOpencodeClient as createOpencodeV2Client,
  type OpencodeClient,
} from "@opencode-ai/sdk/v2/client";
import type { SandboxRuntimeAdapterOptions, SandboxRuntimeClientImplementation } from "../types";

const OPENCODE_HTTP_PREVIEW_LIMIT = 2_000;
const REDACTED_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "proxy-authorization",
]);

function truncatePreview(value: string, maxLength = OPENCODE_HTTP_PREVIEW_LIMIT): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try {
    const serialized = JSON.stringify(error);
    return typeof serialized === "string" ? serialized : String(error);
  } catch {
    return String(error);
  }
}

function getHeadersObject(headers?: HeadersInit | Headers): Record<string, string> | null {
  if (!headers) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of new Headers(headers).entries()) {
    out[key] = REDACTED_HEADER_NAMES.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function resolveFetchUrl(input: Parameters<typeof fetch>[0]): URL | null {
  try {
    if (input instanceof Request) {
      return new URL(input.url);
    }
    if (input instanceof URL) {
      return input;
    }
    if (typeof input === "string") {
      return new URL(input);
    }
  } catch {
    return null;
  }
  return null;
}

function shouldTraceOpencodeFetch(url: URL | null): boolean {
  if (!url) {
    return false;
  }
  const isSessionPromptRoute = /\/session\/[^/]+\/(?:message|prompt_async)$/.test(url.pathname);
  return (
    url.pathname.endsWith("/session/prompt") ||
    isSessionPromptRoute ||
    url.pathname.endsWith("/session/messages") ||
    url.pathname.endsWith("/session/get") ||
    url.pathname.endsWith("/event/subscribe")
  );
}

function summarizePromptModel(model: unknown): string | null {
  if (typeof model === "string") {
    return model;
  }
  if (!model || typeof model !== "object") {
    return null;
  }
  const parsed = model as Record<string, unknown>;
  const providerID = parsed.providerID;
  const modelID = parsed.modelID;
  if (typeof providerID === "string" && typeof modelID === "string") {
    return `${providerID}/${modelID}`;
  }
  if (typeof modelID === "string") {
    return modelID;
  }
  return null;
}

function summarizeJsonBody(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    const model =
      parsed && typeof parsed === "object"
        ? summarizePromptModel((parsed as Record<string, unknown>).model)
        : null;
    return model ? `json(${text.length}, model=${model})` : `json(${text.length})`;
  } catch {
    return `string(${text.length})`;
  }
}

async function getRequestBodySummary(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<string | null> {
  const body = init?.body;
  if (typeof body === "string") {
    return summarizeJsonBody(body);
  }
  if (body instanceof URLSearchParams) {
    return `urlsearchparams(${body.toString().length})`;
  }
  if (body instanceof Uint8Array) {
    return `uint8array(${body.byteLength})`;
  }
  if (body instanceof ArrayBuffer) {
    return `arraybuffer(${body.byteLength})`;
  }

  if (input instanceof Request && !init?.body) {
    try {
      const text = await input.clone().text();
      return summarizeJsonBody(text);
    } catch {
      return "request(unreadable)";
    }
  }

  return body ? "unknown" : null;
}

async function getResponseBodyPreview(response: Response, url: URL | null): Promise<string | null> {
  if (!url || url.pathname.endsWith("/event/subscribe")) {
    return null;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return null;
  }
  try {
    const text = await response.clone().text();
    return truncatePreview(text);
  } catch {
    return null;
  }
}

function getFetchPreconnect(
  fetchImpl: typeof fetch,
): ((...args: unknown[]) => unknown) | undefined {
  const preconnect = Reflect.get(fetchImpl as object, "preconnect");
  return typeof preconnect === "function" ? preconnect.bind(fetchImpl) : undefined;
}

function createLoggingFetch(fetchImpl: typeof fetch): typeof fetch {
  const preconnect = getFetchPreconnect(fetchImpl) ?? getFetchPreconnect(fetch);
  const wrappedFetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = resolveFetchUrl(input);
      const shouldTrace = shouldTraceOpencodeFetch(url);
      const startedAt = Date.now();
      const method = init?.method ?? (input instanceof Request ? input.method : undefined) ?? "GET";
      const requestHeaders =
        getHeadersObject(init?.headers) ??
        (input instanceof Request ? getHeadersObject(input.headers) : null);
      const requestBodySummary = shouldTrace ? await getRequestBodySummary(input, init) : null;

      try {
        const response = await fetchImpl(input, init);
        if (shouldTrace) {
          console.info("[SandboxRuntime][fetch]", {
            method,
            url: url?.toString() ?? "unknown",
            status: response.status,
            durationMs: Date.now() - startedAt,
            requestHeaders,
            requestBodySummary,
            responseHeaders: getHeadersObject(response.headers),
            responseBodyPreview: await getResponseBodyPreview(response, url),
          });
        }
        return response;
      } catch (error) {
        if (shouldTrace) {
          console.error("[SandboxRuntime][fetch] request failed", {
            method,
            url: url?.toString() ?? "unknown",
            durationMs: Date.now() - startedAt,
            requestHeaders,
            requestBodySummary,
            error: summarizeUnknownError(error),
          });
        }
        throw error;
      }
    },
    preconnect ? { preconnect } : {},
  );

  return wrappedFetch as typeof fetch;
}

export function createSandboxOpencodeClient(options: {
  baseUrl: string;
  fetch?: typeof fetch;
}): OpencodeClient {
  return createOpencodeV2Client({
    ...options,
    fetch: createLoggingFetch(options.fetch ?? fetch),
  });
}

export const opencodeRuntimeClientImplementation: SandboxRuntimeClientImplementation = {
  createRuntimeClient: async (options: SandboxRuntimeAdapterOptions) => {
    console.info("[SandboxRuntime] Using opencode runtime client");
    return createSandboxOpencodeClient({
      baseUrl: options.opencodeBaseUrl,
      fetch: options.fetch,
    });
  },
};
