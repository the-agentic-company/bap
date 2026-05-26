import { afterEach, describe, expect, it, vi } from "vitest";

process.env.BETTER_AUTH_SECRET ??= "test-secret";
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/cmdclaw_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
process.env.SANDBOX_DEFAULT ??= "docker";
process.env.ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CMDCLAW_SERVER_SECRET ??= "test-server-secret";
process.env.AWS_ENDPOINT_URL ??= "http://localhost:9000";
process.env.AWS_ACCESS_KEY_ID ??= "test-access-key";
process.env.AWS_SECRET_ACCESS_KEY ??= "test-secret-key";

const {
  decodeGalienCurrentUserFromBearerToken,
  GalienCredentialValidationError,
  normalizeGalienAccessEmail,
  validateGalienCredentials,
} = await import("./service");

describe("Galien service helpers", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("normalizes access emails", () => {
    expect(normalizeGalienAccessEmail("  USER@Example.COM ")).toBe("user@example.com");
  });

  it("decodes the Galien login JWT current user", () => {
    const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "RS256" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({
        id: "42",
        role: "ROLE_USER",
        firstName: "Ada",
        lastName: "Lovelace",
        username: "ada@example.com",
      }),
    ).toString("base64url");

    expect(decodeGalienCurrentUserFromBearerToken(`Bearer ${header}.${payload}.signature`)).toEqual(
      {
        id: 42,
        role: "ROLE_USER",
        firstName: "Ada",
        lastName: "Lovelace",
        username: "ada@example.com",
        iat: undefined,
        exp: undefined,
      },
    );
  });

  it("validates credentials by posting to Galien login", async () => {
    const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "RS256" })).toString(
      "base64url",
    );
    const payload = Buffer.from(JSON.stringify({ id: 7, username: "rep@example.com" })).toString(
      "base64url",
    );
    const bearerToken = `Bearer ${header}.${payload}.signature`;

    globalThis.fetch = vi.fn(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        username: "rep@example.com",
        password: "secret",
      });

      return new Response("[]", {
        status: 200,
        headers: {
          authorization: bearerToken,
        },
      });
    }) as unknown as typeof fetch;

    await expect(
      validateGalienCredentials({
        username: "rep@example.com",
        password: "secret",
      }),
    ).resolves.toMatchObject({
      id: 7,
      username: "rep@example.com",
    });
  });

  it("exposes Galien login rejection details as a credential validation error", async () => {
    globalThis.fetch = vi.fn(async () => {
      return Response.json(
        { message: "Bad credentials.", code: 1003 },
        {
          status: 401,
          statusText: "Unauthorized",
        },
      );
    }) as unknown as typeof fetch;

    await expect(
      validateGalienCredentials({
        username: "rep@example.com",
        password: "wrong",
      }),
    ).rejects.toThrow(GalienCredentialValidationError);

    await expect(
      validateGalienCredentials({
        username: "rep@example.com",
        password: "wrong",
      }),
    ).rejects.toThrow(
      'Galien login failed (401 Unauthorized): {"message":"Bad credentials.","code":1003}',
    );
  });

  it("exposes changed Galien error bodies without depending on content type", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("Account temporarily locked", {
        status: 423,
        statusText: "Locked",
        headers: {
          "content-type": "application/octet-stream",
        },
      });
    }) as unknown as typeof fetch;

    await expect(
      validateGalienCredentials({
        username: "rep@example.com",
        password: "secret",
      }),
    ).rejects.toThrow("Galien login failed (423 Locked): Account temporarily locked");
  });

  it("exposes Galien transport failures as credential validation errors", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(
      validateGalienCredentials({
        username: "rep@example.com",
        password: "secret",
      }),
    ).rejects.toThrow(GalienCredentialValidationError);

    await expect(
      validateGalienCredentials({
        username: "rep@example.com",
        password: "secret",
      }),
    ).rejects.toThrow("Galien login request failed: fetch failed");
  });
});
