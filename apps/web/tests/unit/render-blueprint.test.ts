import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const blueprint = readFileSync(new URL("../../../../render.yaml", import.meta.url), "utf8");

function countMcpBaseUrl(value: string): number {
  return (
    blueprint.match(new RegExp(`key: APP_MCP_BASE_URL\\n\\s+value: ${value}`, "g"))?.length ?? 0
  );
}

describe("Render Blueprint MCP origins", () => {
  test("uses the public MCP domain for web and worker in every environment", () => {
    expect(countMcpBaseUrl("https://mcp\\.staging\\.heybap\\.com")).toBe(2);
    expect(countMcpBaseUrl("https://mcp\\.heybap\\.com")).toBe(2);
  });

  test("does not derive the public MCP origin from Render's native service URL", () => {
    expect(blueprint).not.toMatch(
      /key: APP_MCP_BASE_URL\n\s+fromService:\n\s+type: web\n\s+name: bap-mcp-(?:staging|prod)\n\s+envVarKey: RENDER_EXTERNAL_URL/,
    );
  });
});
