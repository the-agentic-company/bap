// oxlint-disable jsx-a11y/control-has-associated-label

import type {
  TemplateCatalogTemplate,
  TemplateIntegrationType,
} from "@cmdclaw/db/template-catalog";
import { Link, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ArrowUp, Search, SlidersHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetClose } from "@/components/animate-ui/components/radix/sheet";
import { TemplatePreviewModal } from "@/components/template-preview-modal";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { INTEGRATION_DISPLAY_NAMES, INTEGRATION_LOGOS } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import { filterTemplates, toggleMultiSelect, type TemplateItem } from "./templates-filters";

const INDUSTRIES = [
  "Sales",
  "Marketing",
  "Customer Success",
  "Operations",
  "Finance",
  "HR",
  "Engineering",
] as const;

const USE_CASES = [
  "Lead Generation",
  "Follow-ups",
  "Meeting Prep",
  "Data Enrichment",
  "Reporting",
  "CRM Sync",
  "Notifications",
] as const;

const TEMPLATE_INTEGRATION_DISPLAY_NAMES: Record<TemplateIntegrationType, string> = {
  ...INTEGRATION_DISPLAY_NAMES,
  linear: "Linear",
};

const TEMPLATE_INTEGRATION_LOGOS: Record<TemplateIntegrationType, string> = {
  ...INTEGRATION_LOGOS,
  linear: "/integrations/linear.svg",
};

const INTEGRATIONS_FILTER: TemplateIntegrationType[] = [
  "google_gmail",
  "hubspot",
  "slack",
  "linkedin",
  "salesforce",
  "google_sheets",
  "google_calendar",
  "notion",
  "github",
  "linear",
  "airtable",
] as const;

const FILTER_PILL_TRANSITION = { type: "spring", duration: 0.4, bounce: 0.15 } as const;
const TEMPLATE_CARD_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: "easeOut" },
} as const;
const ACTIVE_PILL_MOTION = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.92 },
} as const;
const FADE_IN_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
} as const;
const FILTER_PANEL_TRANSITION = { duration: 0.2, ease: "easeInOut" } as const;
const FILTER_PANEL_INITIAL = { height: 0, opacity: 0 } as const;
const FILTER_PANEL_ANIMATE = { height: "auto", opacity: 1 } as const;

function getTriggerLabel(triggerType: string) {
  const map: Record<string, string> = {
    manual: "Manual",
    schedule: "Scheduled",
    email: "Email",
    webhook: "Webhook",
  };
  return map[triggerType] ?? triggerType;
}

function IntegrationLogos({ integrations }: { integrations: TemplateItem["integrations"] }) {
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
            width={20}
            height={20}
            loading="lazy"
            decoding="async"
            className="size-5 shrink-0"
          />
        );
      })}
    </div>
  );
}

type FilterPillProps<T extends string> = {
  value: T;
  label: string;
  active: boolean;
  onSelect: (value: T) => void;
  iconSrc?: string;
};

function FilterPill<T extends string>({
  value,
  label,
  active,
  onSelect,
  iconSrc,
}: FilterPillProps<T>) {
  const handleClick = useCallback(() => {
    onSelect(value);
  }, [onSelect, value]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={active}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-[border-color,color,background-color] duration-200",
        active
          ? "border-border/70 bg-muted text-foreground"
          : "border-transparent text-muted-foreground hover:border-border/50 hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <AnimatePresence initial={false}>
        {active ? (
          <motion.span
            initial={ACTIVE_PILL_MOTION.initial}
            animate={ACTIVE_PILL_MOTION.animate}
            exit={ACTIVE_PILL_MOTION.exit}
            transition={FILTER_PILL_TRANSITION}
            className="bg-muted absolute inset-0 rounded-full"
          />
        ) : null}
      </AnimatePresence>
      {iconSrc ? (
        <span className="relative">
          <img
            src={iconSrc}
            alt={value}
            width={14}
            height={14}
            loading="lazy"
            decoding="async"
            className="size-3.5"
          />
        </span>
      ) : null}
      <span className="relative">{label}</span>
    </button>
  );
}

export function TemplatesPageClient({
  templates,
  previewId,
}: {
  templates: TemplateCatalogTemplate[];
  previewId: string | null;
}) {
  const t = useGT();

  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const previewTemplate = useMemo(
    () => templates.find((template) => template.id === previewId) ?? null,
    [previewId, templates],
  );

  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeIndustries, setActiveIndustries] = useState<string[]>([]);
  const [activeUseCases, setActiveUseCases] = useState<string[]>([]);
  const [activeIntegrations, setActiveIntegrations] = useState<TemplateIntegrationType[]>([]);

  const activeFilterCount =
    activeIndustries.length + activeUseCases.length + activeIntegrations.length;

  const clearFilters = useCallback(() => {
    setActiveIndustries([]);
    setActiveUseCases([]);
    setActiveIntegrations([]);
  }, []);

  const toggleIndustry = useCallback((industry: string) => {
    setActiveIndustries((prev) => toggleMultiSelect(prev, industry));
  }, []);

  const toggleUseCase = useCallback((useCase: string) => {
    setActiveUseCases((prev) => toggleMultiSelect(prev, useCase));
  }, []);

  const toggleIntegration = useCallback((integration: TemplateIntegrationType) => {
    setActiveIntegrations((prev) => toggleMultiSelect(prev, integration));
  }, []);

  const filtered = useMemo(
    () =>
      filterTemplates(templates, {
        search,
        industries: activeIndustries,
        useCases: activeUseCases,
        integrations: activeIntegrations,
      }),
    [templates, search, activeIndustries, activeUseCases, activeIntegrations],
  );

  const hasActiveFilter = activeFilterCount > 0;
  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
  }, []);

  const toggleFilters = useCallback(() => {
    setFiltersOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!isMobile || !previewId) {
      return;
    }

    void navigate({
      to: "/template/$templateId",
      params: { templateId: previewId },
      replace: true,
    });
  }, [isMobile, previewId, navigate]);

  return (
    <>
      <div className="bg-background min-h-screen">
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-4 pb-16 md:px-8 md:pt-10">
          <div className="mb-4 flex items-center gap-3 md:mb-8">
            <div className="border-border flex h-11 flex-1 items-center gap-3 rounded-xl border px-4 md:max-w-xl">
              <Search className="text-muted-foreground/60 size-4 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={handleSearchChange}
                placeholder={t("Search templates…")}
                className="placeholder:text-muted-foreground/40 w-full bg-transparent text-sm outline-none"
              />
            </div>

            <Button
              variant="outline"
              onClick={toggleFilters}
              aria-expanded={filtersOpen}
              className={cn("h-11 gap-2 rounded-xl px-4", filtersOpen && "bg-muted border-border")}
            >
              <SlidersHorizontal className="size-3.5" />
              <span className="hidden sm:inline">
                <T>Filters</T>
              </span>
              {activeFilterCount > 0 && (
                <span className="bg-foreground text-background inline-flex size-4.5 items-center justify-center rounded-full text-[10px] leading-none font-semibold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          {/* Desktop: collapsible filter panel */}
          <AnimatePresence initial={false}>
            {filtersOpen && !isMobile && (
              <motion.div
                initial={FILTER_PANEL_INITIAL}
                animate={FILTER_PANEL_ANIMATE}
                exit={FILTER_PANEL_INITIAL}
                transition={FILTER_PANEL_TRANSITION}
                className="overflow-hidden"
              >
                <div className="mb-3 space-y-1.5 md:mb-10 md:space-y-4">
                  <div className="flex [scrollbar-width:none] items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden">
                    <span className="text-muted-foreground/50 mr-2 hidden w-16 shrink-0 text-[11px] font-medium tracking-wider uppercase md:block">
                      <T>Industry</T>
                    </span>
                    {INDUSTRIES.map((industry) => (
                      <FilterPill
                        key={industry}
                        value={industry}
                        label={industry}
                        active={activeIndustries.includes(industry)}
                        onSelect={toggleIndustry}
                      />
                    ))}
                  </div>

                  <div className="flex [scrollbar-width:none] items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden">
                    <span className="text-muted-foreground/50 mr-2 hidden w-16 shrink-0 text-[11px] font-medium tracking-wider uppercase md:block">
                      <T>Use case</T>
                    </span>
                    {USE_CASES.map((useCase) => (
                      <FilterPill
                        key={useCase}
                        value={useCase}
                        label={useCase}
                        active={activeUseCases.includes(useCase)}
                        onSelect={toggleUseCase}
                      />
                    ))}
                  </div>

                  <div className="flex [scrollbar-width:none] items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden">
                    <span className="text-muted-foreground/50 mr-2 hidden w-16 shrink-0 text-[11px] font-medium tracking-wider uppercase md:block">
                      <T>App</T>
                    </span>
                    {INTEGRATIONS_FILTER.map((integration) => (
                      <FilterPill
                        key={integration}
                        value={integration}
                        label={TEMPLATE_INTEGRATION_DISPLAY_NAMES[integration]}
                        active={activeIntegrations.includes(integration)}
                        onSelect={toggleIntegration}
                        iconSrc={TEMPLATE_INTEGRATION_LOGOS[integration]}
                      />
                    ))}
                  </div>

                  {hasActiveFilter && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="text-muted-foreground hover:text-foreground text-xs transition-colors"
                      >
                        <T>Clear all filters</T>
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mobile: bottom sheet with filters */}
          {isMobile && (
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetContent
                side="bottom"
                title={t("Filters")}
                showCloseButton={false}
                className="h-auto max-h-[80vh] rounded-t-2xl"
              >
                <div className="flex items-center justify-between border-b px-5 py-4">
                  <span className="text-sm font-semibold">
                    <T>Filters</T>
                  </span>
                  <SheetClose className="text-muted-foreground hover:text-foreground text-xs transition-colors">
                    <T>Done</T>
                  </SheetClose>
                </div>

                <div className="space-y-5 overflow-y-auto px-5 py-4">
                  <div>
                    <span className="text-muted-foreground/50 mb-2 block text-[11px] font-medium tracking-wider uppercase">
                      <T>Industry</T>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {INDUSTRIES.map((industry) => (
                        <FilterPill
                          key={industry}
                          value={industry}
                          label={industry}
                          active={activeIndustries.includes(industry)}
                          onSelect={toggleIndustry}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-muted-foreground/50 mb-2 block text-[11px] font-medium tracking-wider uppercase">
                      <T>Use case</T>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {USE_CASES.map((useCase) => (
                        <FilterPill
                          key={useCase}
                          value={useCase}
                          label={useCase}
                          active={activeUseCases.includes(useCase)}
                          onSelect={toggleUseCase}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-muted-foreground/50 mb-2 block text-[11px] font-medium tracking-wider uppercase">
                      <T>App</T>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {INTEGRATIONS_FILTER.map((integration) => (
                        <FilterPill
                          key={integration}
                          value={integration}
                          label={TEMPLATE_INTEGRATION_DISPLAY_NAMES[integration]}
                          active={activeIntegrations.includes(integration)}
                          onSelect={toggleIntegration}
                          iconSrc={TEMPLATE_INTEGRATION_LOGOS[integration]}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 border-t px-5 py-4">
                  {hasActiveFilter && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      className="text-muted-foreground"
                    >
                      <T>Clear all</T>
                    </Button>
                  )}
                  <SheetClose asChild>
                    <Button variant="default" size="sm" className="ml-auto">
                      <T>Show</T> {filtered.length} <T>template</T>
                      {filtered.length !== 1 ? "s" : ""}
                    </Button>
                  </SheetClose>
                </div>
              </SheetContent>
            </Sheet>
          )}

          <div className="mb-3 flex items-center justify-between md:mb-5">
            <p className="text-muted-foreground text-xs">
              {filtered.length} <T>template</T>
              {filtered.length !== 1 ? "s" : ""}
            </p>
            {hasActiveFilter && !filtersOpen && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                {activeFilterCount} <T>filter</T>
                {activeFilterCount !== 1 ? "s" : ""} <T>active</T>
                {" · "}
                <span className="underline">
                  <T>Clear</T>
                </span>
              </button>
            )}
          </div>

          <motion.div layout className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((template) => (
                <motion.div
                  key={template.id}
                  layout
                  initial={TEMPLATE_CARD_MOTION.initial}
                  animate={TEMPLATE_CARD_MOTION.animate}
                  exit={TEMPLATE_CARD_MOTION.exit}
                  transition={TEMPLATE_CARD_MOTION.transition}
                >
                  {isMobile ? (
                    <Link
                      to="/template/$templateId"
                      // TanStack Router params/search are objects by design; this per-card
                      // value depends on template.id and cannot be hoisted out of the map.
                      // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
                      params={{ templateId: template.id }}
                      resetScroll={false}
                      className="border-border bg-card hover:border-foreground/30 hover:bg-muted/30 group relative flex h-full w-full flex-col rounded-xl border p-5 transition-all duration-150"
                    >
                      <TemplateCardContent template={template} />
                    </Link>
                  ) : (
                    <Link
                      to="/templates"
                      // See note above: typed search params are objects by design.
                      // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
                      search={{ preview: template.id }}
                      resetScroll={false}
                      className="border-border bg-card hover:border-foreground/30 hover:bg-muted/30 group relative flex h-full w-full flex-col rounded-xl border p-5 transition-all duration-150"
                    >
                      <TemplateCardContent template={template} />
                    </Link>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>

          {filtered.length === 0 ? (
            <motion.div
              initial={FADE_IN_MOTION.initial}
              animate={FADE_IN_MOTION.animate}
              className="py-20 text-center"
            >
              <p className="text-muted-foreground text-sm">
                <T>No templates match your filters.</T>
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="text-muted-foreground hover:text-foreground mt-2 text-xs underline transition-colors"
              >
                <T>Clear all filters</T>
              </button>
            </motion.div>
          ) : null}
        </div>
      </div>
      {!isMobile ? <TemplatePreviewModal template={previewTemplate} /> : null}
    </>
  );
}

function TemplateCardContent({ template }: { template: TemplateItem }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-snug font-medium">{template.title}</p>
        <ArrowUp className="text-muted-foreground/30 group-hover:text-muted-foreground mt-0.5 size-3.5 shrink-0 rotate-45 transition-colors" />
      </div>

      <span className="bg-muted text-muted-foreground mt-2.5 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
        {getTriggerLabel(template.triggerType)}
      </span>

      <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-relaxed">
        {template.description}
      </p>

      <div className="mt-auto pt-4">
        <IntegrationLogos integrations={template.integrations} />
      </div>
    </>
  );
}
