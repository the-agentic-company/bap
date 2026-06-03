import { config } from "dotenv";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { mswServer } from "@/test/msw/server";

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
  CMDCLAW_SERVER_SECRET: "test-server-secret",
  AWS_ENDPOINT_URL: "https://s3.test.local",
  AWS_ACCESS_KEY_ID: "test-access-key",
  AWS_SECRET_ACCESS_KEY: "test-secret-key",
  NODE_ENV: "test",
} satisfies Record<string, string>;

for (const [key, value] of Object.entries(testEnvDefaults)) {
  process.env[key] ??= value;
}

const isLiveE2E = process.env.E2E_LIVE === "1";

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

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function ensureUsableLocalStorage() {
  if (typeof window === "undefined" || typeof globalThis.localStorage?.clear === "function") {
    return;
  }

  const storage = createMemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    writable: true,
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "localStorage", {
    writable: true,
    configurable: true,
    value: storage,
  });
}

beforeEach(() => {
  ensureUsableLocalStorage();
});

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

beforeAll(() => {
  if (isLiveE2E) {
    return;
  }
  mswServer.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  if (isLiveE2E) {
    return;
  }
  mswServer.resetHandlers();
});

afterAll(() => {
  if (isLiveE2E) {
    return;
  }
  mswServer.close();
});
