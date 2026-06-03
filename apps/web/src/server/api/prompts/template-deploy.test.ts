import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTemplateDeployPrompt } from "./template-deploy";

describe("getTemplateDeployPrompt (GET /api/prompts/template-deploy)", () => {
  it("returns the template deploy prompt as cacheable plain text", async () => {
    const expected = await readFile(
      path.join(process.cwd(), "prompts", "template-deploy.txt"),
      "utf8",
    );

    const response = await getTemplateDeployPrompt();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await response.text()).toBe(expected);
  });
});
