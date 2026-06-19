import { config } from "dotenv";
import { createElement, Fragment, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

const passthroughTranslation = (message: string | string[] | null | undefined) => message ?? "";

vi.mock("gt-react", async (importActual) => {
  const actual = await importActual<typeof import("gt-react")>();

  return {
    ...actual,
    msg: passthroughTranslation,
    T: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
    useGT: () => passthroughTranslation,
    useMessages: () => passthroughTranslation,
  };
});

for (const envFile of [".env.test.local", ".env.test", "../../.env"]) {
  config({ path: envFile, override: false });
}

const testEnvDefaults = {
  BETTER_AUTH_SECRET: "test-better-auth-secret",
  DATABASE_URL: "https://db.test.local",
  REDIS_URL: "https://redis.test.local",
  OPENAI_API_KEY: "test-openai-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  SANDBOX_DEFAULT: "e2b",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  APP_SERVER_SECRET: "test-server-secret",
  AWS_ENDPOINT_URL: "https://s3.test.local",
  AWS_ACCESS_KEY_ID: "test-access-key",
  AWS_SECRET_ACCESS_KEY: "test-secret-key",
  NODE_ENV: "test",
} satisfies Record<string, string>;

for (const [key, value] of Object.entries(testEnvDefaults)) {
  process.env[key] ??= value;
}

const isLiveE2E = process.env.E2E_LIVE === "1";
let mswServerPromise: Promise<typeof import("@/test/msw/server").mswServer> | null = null;

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: createMemoryStorage(),
  writable: true,
});

function loadMswServer(): Promise<typeof import("@/test/msw/server").mswServer> {
  mswServerPromise ??= import("@/test/msw/server").then((module) => module.mswServer);
  return mswServerPromise;
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    callback?: ResizeObserverCallback;

    constructor(callback?: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(_target: Element) {}
    unobserve(_target: Element) {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
}

beforeAll(async () => {
  if (isLiveE2E) {
    return;
  }
  const mswServer = await loadMswServer();
  mswServer.listen({ onUnhandledRequest: "error" });
});

afterEach(async () => {
  if (isLiveE2E) {
    return;
  }
  const mswServer = await loadMswServer();
  mswServer.resetHandlers();
});

afterAll(async () => {
  if (isLiveE2E) {
    return;
  }
  const mswServer = await loadMswServer();
  mswServer.close();
});
