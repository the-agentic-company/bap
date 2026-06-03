import type { TemplateCatalogTemplate } from "@cmdclaw/db/template-catalog";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { TemplateDetailContent } from "@/components/template-detail-content";
import { getTemplateCatalogEntryById } from "@/server/services/template-catalog";

/**
 * /template/$templateId — DB-backed template detail (was
 * src/app/template/[templateId]/page.tsx).
 *
 * Protected by the parent `/template` layout `beforeLoad` guard.
 *
 * The catalog entry is loaded from the database, so dynamic head metadata needs server work:
 * the loader fetches the entry once (throwing `notFound()` when it is missing) and `head`
 * derives the title/description from that loader data. The page keeps its user-facing
 * not-found behavior via a route-specific notFoundComponent.
 */
const loadTemplateById = createServerFn({ method: "GET" })
  .inputValidator((templateId: string) => templateId)
  .handler(async ({ data: templateId }): Promise<TemplateCatalogTemplate> => {
    const template = await getTemplateCatalogEntryById(templateId);
    if (!template) {
      throw notFound();
    }
    return template;
  });

export const Route = createFileRoute("/template/$templateId")({
  loader: ({ params }) => loadTemplateById({ data: params.templateId }),
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Template not found | CmdClaw" }] };
    }
    return {
      meta: [
        { title: `${loaderData.title} | CmdClaw` },
        { name: "description", content: loaderData.description },
      ],
    };
  },
  notFoundComponent: TemplateNotFound,
  component: TemplatePage,
});

function BackToTemplates() {
  return (
    <Link
      to="/templates"
      className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-xs transition-colors"
    >
      <ArrowLeft className="size-3" />
      Back to Templates
    </Link>
  );
}

function TemplateNotFound() {
  return (
    <div className="mx-auto max-w-3xl pb-8">
      <BackToTemplates />
      <p className="text-muted-foreground text-sm">Template not found.</p>
    </div>
  );
}

function TemplatePage() {
  const template = Route.useLoaderData();

  return (
    <div className="mx-auto max-w-3xl pb-8">
      <BackToTemplates />
      <TemplateDetailContent template={template} />
    </div>
  );
}
