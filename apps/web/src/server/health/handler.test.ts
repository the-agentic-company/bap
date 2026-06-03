import { describe, expect, it } from "vitest";
import { handleHealth, type HealthDeps } from "./handler";

function deps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    pingDatabase: async () => {},
    pingRedis: async () => true,
    ...overrides,
  };
}

describe("handleHealth", () => {
  it("returns 200 with ok:true and both checks passing", async () => {
    const res = await handleHealth(deps());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({
      ok: true,
      checks: { database: true, redis: true },
    });
  });

  it("reports redis:false when ping does not return PONG but database is healthy", async () => {
    const res = await handleHealth(deps({ pingRedis: async () => false }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      checks: { database: true, redis: false },
    });
  });

  it("returns 503 with ok:false and the error message when the database check throws", async () => {
    const res = await handleHealth(
      deps({
        pingDatabase: async () => {
          throw new Error("db down");
        },
      }),
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      checks: { database: false, redis: false },
      error: "db down",
    });
  });

  it("returns 503 and keeps database:true when only the redis check throws", async () => {
    const res = await handleHealth(
      deps({
        pingRedis: async () => {
          throw new Error("redis down");
        },
      }),
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      checks: { database: true, redis: false },
      error: "redis down",
    });
  });

  it("returns a generic message for non-Error throws", async () => {
    const res = await handleHealth(
      deps({
        pingDatabase: async () => {
          throw "boom";
        },
      }),
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: "unknown error" });
  });
});
