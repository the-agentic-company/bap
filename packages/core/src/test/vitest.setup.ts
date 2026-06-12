import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { afterAll, afterEach, beforeAll } from "vitest";
import { mswServer } from "./msw/server";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

for (const envFile of [".env.test.local", ".env.test"]) {
  const envFilePath = resolve(packageRoot, envFile);

  if (existsSync(envFilePath)) {
    config({ path: envFilePath, override: false });
  }
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
