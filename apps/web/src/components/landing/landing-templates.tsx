import type { TemplateCatalogTemplate, TemplateIntegrationType } from "@bap/db/template-catalog";
import { Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INTEGRATION_LOGOS } from "@/lib/integration-icons";

const TEMPLATE_INTEGRATION_LOGOS: Record<TemplateIntegrationType, string> = {
  ...INTEGRATION_LOGOS,
  linear: "/integrations/linear.svg",
};

function getTriggerLabel(triggerType: string, gt: ReturnType<typeof useGT>) {
  const map: Record<string, string> = {
    manual: gt("Manual"),
    schedule: gt("Scheduled"),
    email: gt("Email"),
    webhook: gt("Webhook"),
  };
  return map[triggerType] ?? triggerType;
}

function IntegrationLogos({ integrations }: { integrations: TemplateIntegrationType[] }) {
  return (
    <div className="flex items-center gap-1">
      {integrations.map((key) => {
        const logo = TEMPLATE_INTEGRATION_LOGOS[key];
        if (!logo) {
          return null;
        }
        return (
          <img
            key={key}
            src={logo}
            alt={key}
            width={16}
            height={16}
            loading="lazy"
            decoding="async"
            className="size-4 shrink-0"
          />
        );
      })}
    </div>
  );
}

function TemplateCard({
  template,
  isMobile,
}: {
  template: TemplateCatalogTemplate;
  isMobile: boolean;
}) {
  const gt = useGT();

  return (
    <Link
      to={isMobile ? "/template/$templateId" : "/"}
      // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop -- TanStack Router params require an inline object
      params={isMobile ? { templateId: template.id } : {}}
      // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop -- TanStack Router search requires an inline object
      search={isMobile ? {} : { preview: template.id }}
      resetScroll={false}
      className="group border-border/60 bg-card relative flex min-h-[170px] w-full flex-col gap-3 rounded-xl border p-5 text-left shadow-sm transition-all duration-150 hover:border-slate-300 hover:bg-slate-100"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm leading-tight font-medium text-slate-900">{template.title}</p>
          <span className="mt-1 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">
            {getTriggerLabel(template.triggerType, gt)}
          </span>
        </div>
        <ArrowUp className="mt-0.5 size-3.5 shrink-0 rotate-45 text-slate-500 transition-colors group-hover:text-slate-700" />
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed text-slate-700">{template.description}</p>
      <div className="mt-auto pt-1">
        <IntegrationLogos integrations={template.integrations} />
      </div>
    </Link>
  );
}

export function LandingTemplatesSection({
  featuredTemplates,
  isMobile,
}: {
  featuredTemplates: TemplateCatalogTemplate[];
  isMobile: boolean;
}) {
  return (
    <section className="mt-6 pb-10 md:mt-8 md:pb-16 lg:mt-10">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">
            <T>Templates</T>
          </h2>
          <p className="mt-0.5 text-xs text-white">
            <T>Start from a pre-built coworker</T>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          asChild
          className="gap-1.5 border-white/45 bg-white/80 hover:bg-white"
        >
          <Link to="/templates">
            <T>Browse all</T>
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {featuredTemplates.map((template) => (
          <TemplateCard key={template.id} template={template} isMobile={isMobile} />
        ))}
      </div>
    </section>
  );
}
