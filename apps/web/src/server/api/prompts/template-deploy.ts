import { readFile } from "node:fs/promises";
import path from "node:path";

const TEMPLATE_DEPLOY_PROMPT_PATH = path.join(process.cwd(), "prompts", "template-deploy.txt");

/**
 * Framework-neutral handler for `GET /api/prompts/template-deploy`.
 *
 * Returns the template deployment prompt as plain text with a public, cacheable response.
 * The endpoint is intentionally unauthenticated (public template content). On read failure
 * it returns a 500 with a plain-text body, matching the original Next route contract.
 */
export async function getTemplateDeployPrompt(): Promise<Response> {
  try {
    const prompt = await readFile(TEMPLATE_DEPLOY_PROMPT_PATH, "utf8");

    return new Response(prompt, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Failed to load template deploy prompt:", error);
    return new Response("Failed to load template deploy prompt", { status: 500 });
  }
}
