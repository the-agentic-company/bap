import { TemplateDeployPage } from "@/components/template-deploy-page";
import { getTemplateCatalogEntryById } from "@/server/services/template-catalog";

export default async function CoworkerTemplateDeployPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const template = await getTemplateCatalogEntryById(templateId);

  return <TemplateDeployPage template={template} />;
}
