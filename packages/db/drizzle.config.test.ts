import { describe, expect, it } from "vitest";

describe("drizzle config", () => {
  it("ignores legacy workspace audit tables during db push", async () => {
    process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/bap_test";

    const { default: config } = await import("./drizzle.config");

    expect(config.tablesFilter).toEqual(["*", "!legacy_*"]);
  });
});
