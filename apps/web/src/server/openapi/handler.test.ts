import { describe, expect, it } from "vitest";
import { handleOpenApi } from "./handler";

describe("handleOpenApi", () => {
  it("returns 200 JSON with the CmdClaw OpenAPI document", async () => {
    const res = await handleOpenApi();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string; version: string; description: string };
      servers: { url: string }[];
      paths: Record<string, unknown>;
    };

    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info).toEqual({
      title: "CmdClaw API",
      version: "0.1.0",
      description: "API for CmdClaw server",
    });
    expect(spec.servers).toEqual([{ url: "/api/rpc" }]);
    // The product API exposes routes; the document should not be empty.
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(0);
  });
});
