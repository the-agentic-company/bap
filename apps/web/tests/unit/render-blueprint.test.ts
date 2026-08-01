import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const blueprint = readFileSync(new URL("../../../../render.yaml", import.meta.url), "utf8");

function countStaticEnvUrl(key: string, value: string): number {
  return blueprint.match(new RegExp(`key: ${key}\\n\\s+value: ${value}`, "g"))?.length ?? 0;
}

describe("Render Blueprint MCP origins", () => {
  test("uses the public MCP domain for web, worker, and MCP in every environment", () => {
    expect(countStaticEnvUrl("APP_MCP_BASE_URL", "https://mcp\\.staging\\.heybap\\.com")).toBe(3);
    expect(countStaticEnvUrl("APP_MCP_BASE_URL", "https://mcp\\.heybap\\.com")).toBe(3);
  });

  test("points each MCP service at its public web API", () => {
    expect(countStaticEnvUrl("APP_SERVER_URL", "https://staging\\.heybap\\.com")).toBe(1);
    expect(countStaticEnvUrl("APP_SERVER_URL", "https://heybap\\.com")).toBe(1);
  });

  test("does not derive the public MCP origin from Render's native service URL", () => {
    expect(blueprint).not.toMatch(
      /key: APP_MCP_BASE_URL\n\s+fromService:\n\s+type: web\n\s+name: bap-mcp-(?:staging|prod)\n\s+envVarKey: RENDER_EXTERNAL_URL/,
    );
  });
});
