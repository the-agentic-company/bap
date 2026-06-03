import { createFileRoute } from "@tanstack/react-router";
import { getTemplateDeployPrompt } from "@/server/api/prompts/template-deploy";

/**
 * Server route adapter preserving the public `GET /api/prompts/template-deploy` URL. The
 * file read, plain-text body, and cache headers all live in the framework-neutral handler.
 */
export const Route = createFileRoute("/api/prompts/template-deploy")({
  server: {
    handlers: {
      GET: () => getTemplateDeployPrompt(),
    },
  },
});
