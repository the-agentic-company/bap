import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { TemplateDeployPage } from "@/components/template-deploy-page";
import { getTemplateCatalogEntryById } from "@/server/services/template-catalog";

/**
 * /agents/deploy/$templateId (was src/app/agents/deploy/[templateId]/page.tsx).
 *
 * The template catalog lookup is server-only DB work, so it stays on the server via a
 * server function invoked from the route loader. The result is small and SSR-critical for
 * the deploy page's first paint, which is exactly the selective-loader use the PRD allows;
 * ongoing product mutations remain in oRPC inside <TemplateDeployPage>.
 */
const fetchTemplate = createServerFn({ method: "GET" })
  .inputValidator((templateId: string) => templateId)
  .handler(async ({ data: templateId }) => {
    return getTemplateCatalogEntryById(templateId);
  });

export const Route = createFileRoute("/agents/deploy/$templateId")({
  loader: ({ params }) => fetchTemplate({ data: params.templateId }),
  head: () => ({ meta: [{ title: "Deploy Coworker" }] }),
  component: CoworkerTemplateDeployRoute,
});

function CoworkerTemplateDeployRoute() {
  const template = Route.useLoaderData();
  return <TemplateDeployPage template={template} />;
}
