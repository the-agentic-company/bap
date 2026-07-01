import { Workflow } from "lucide-react";
import { type ComponentType, useCallback, useMemo, useState } from "react";
import { buildAgentPreviews, getAgentSpec } from "./agent-specs";
import { OutputPreview } from "./output-preview";
import { ToolLogo } from "./tool-logo";
import { loc, type Localized, type UseCaseAgent, type Vertical } from "./use-cases-data";

/**
 * Agentic-apps section, rendered in one of several layouts so we can compare dispositions across
 * the vertical pages (assigned per slug in LAYOUT_BY_SLUG). All layouts reuse the same building
 * blocks — AgentInfo (trigger / actions / outputs bullets + tool chips) and AgentOutputs (framed
 * previews) — so they stay visually consistent and DRY.
 */
type LayoutProps = { vertical: Vertical; locale: string };
type LayoutKey = "stack" | "split" | "grid" | "tabs" | "featured";

const CARD = "rounded-3xl border border-[#EADFD6] bg-white p-6 shadow-sm";
const NO_TOOLS: string[] = [];
const SAMPLE = { en: "Sample output", fr: "Exemple de sortie" };
const SPEC_LABELS = {
  trigger: { en: "Trigger", fr: "Déclencheur" },
  does: { en: "What it does", fr: "Ce qu'il fait" },
  outputs: { en: "You get", fr: "Vous obtenez" },
};

// The agent's own tools first, then the rest of the vertical's stack (deduped).
function mergeTools(primary: string[], extra: string[]): string[] {
  const seen = new Set(primary);
  return [...primary, ...extra.filter((tool) => !seen.has(tool))];
}

function SpecLabel({ children }: { children: string }) {
  return <p className="font-mono text-[10px] font-semibold tracking-[0.12em] text-[#9C8A80] uppercase">{children}</p>;
}

function AgentSpecSummary({ slug, index, locale }: { slug: string; index: number; locale: string }) {
  const spec = getAgentSpec(slug, index);
  if (!spec) {
    return null;
  }
  const t = (value: Localized) => loc(locale, value);
  const actions = spec.actions.slice(0, 3);
  const outputs = spec.outputs.map((output) => t(output.label)).join(", ");
  const trigger = spec.triggers[0];
  return (
    <div className="mt-4 space-y-3">
      {trigger ? (
        <div>
          <SpecLabel>{t(SPEC_LABELS.trigger)}</SpecLabel>
          <p className="mt-1 text-sm leading-snug text-[#6E5C53]">{t(trigger)}</p>
        </div>
      ) : null}
      <div>
        <SpecLabel>{t(SPEC_LABELS.does)}</SpecLabel>
        <ul className="mt-1.5 space-y-1">
          {actions.map((action) => (
            <li key={action.en} className="flex gap-2 text-sm leading-snug text-[#6E5C53]">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[#D52B0C]" />
              {t(action)}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <SpecLabel>{t(SPEC_LABELS.outputs)}</SpecLabel>
        <p className="mt-1 text-sm leading-snug text-[#6E5C53]">{outputs}</p>
      </div>
    </div>
  );
}

function ToolChipRow({ tools }: { tools: string[] }) {
  if (tools.length === 0) {
    return null;
  }
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {tools.map((tool) => (
        <span
          key={tool}
          className="inline-flex items-center gap-2 rounded-full border border-[#EADFD6] bg-[#FBF5F0] py-1 pr-3.5 pl-2 text-[13px] font-medium text-[#3C1E0A]"
        >
          <ToolLogo name={tool} size={22} />
          {tool}
        </span>
      ))}
    </div>
  );
}

function AgentInfo({
  agent,
  slug,
  index,
  locale,
  verticalTools,
}: {
  agent: UseCaseAgent;
  slug: string;
  index: number;
  locale: string;
  verticalTools: string[];
}) {
  const chipTools = mergeTools(getAgentSpec(slug, index)?.tools ?? NO_TOOLS, verticalTools).slice(0, 6);
  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#F3E9E1]">
          <Workflow className="size-[22px] text-[#D52B0C]" />
        </div>
        <h3 className="text-lg font-bold tracking-tight">{loc(locale, agent.name)}</h3>
      </div>
      <AgentSpecSummary slug={slug} index={index} locale={locale} />
      <ToolChipRow tools={chipTools} />
    </div>
  );
}

function AgentOutputs({
  slug,
  index,
  locale,
  max,
}: {
  slug: string;
  index: number;
  locale: string;
  max: number;
}) {
  const spec = getAgentSpec(slug, index);
  const tools = spec?.tools ?? NO_TOOLS;
  const actions = useMemo(() => (spec?.actions ?? []).map((value) => loc(locale, value)), [spec, locale]);
  const previews = useMemo(() => buildAgentPreviews(spec, locale, actions, max), [spec, locale, actions, max]);
  if (previews.length === 0) {
    return null;
  }
  return (
    <div className="space-y-4">
      {previews.map((preview) => (
        <OutputPreview
          key={preview.key}
          label={preview.label}
          sampleLabel={loc(locale, SAMPLE)}
          locale={locale}
          lines={preview.lines}
          tools={tools}
        />
      ))}
    </div>
  );
}

// One agent block: info, then (optionally) its output previews.
function AgentCard({
  agent,
  slug,
  index,
  locale,
  verticalTools,
  outputMax,
}: {
  agent: UseCaseAgent;
  slug: string;
  index: number;
  locale: string;
  verticalTools: string[];
  outputMax: number;
}) {
  return (
    <div className={CARD}>
      <AgentInfo agent={agent} slug={slug} index={index} locale={locale} verticalTools={verticalTools} />
      {outputMax > 0 ? (
        <div className="mt-5">
          <AgentOutputs slug={slug} index={index} locale={locale} max={outputMax} />
        </div>
      ) : null}
    </div>
  );
}

// Shared list used by the stack and grid layouts (differ only by container + preview count).
function AgentCardList({
  vertical,
  locale,
  outputMax,
  className,
}: LayoutProps & { outputMax: number; className: string }) {
  return (
    <div className={className}>
      {vertical.agents.map((agent, index) => (
        <AgentCard
          key={agent.name.en}
          agent={agent}
          slug={vertical.slug}
          index={index}
          locale={locale}
          verticalTools={vertical.integrations.items}
          outputMax={outputMax}
        />
      ))}
    </div>
  );
}

function AgentStack({ vertical, locale }: LayoutProps) {
  return <AgentCardList vertical={vertical} locale={locale} outputMax={2} className="mt-6 space-y-5" />;
}

function AgentGrid({ vertical, locale }: LayoutProps) {
  return (
    <AgentCardList vertical={vertical} locale={locale} outputMax={1} className="mt-6 grid gap-4 md:grid-cols-2" />
  );
}

function AgentSplit({ vertical, locale }: LayoutProps) {
  return (
    <div className="mt-6 space-y-5">
      {vertical.agents.map((agent, index) => (
        <div key={agent.name.en} className={CARD}>
          <div className="grid items-start gap-6 md:grid-cols-2">
            <AgentInfo
              agent={agent}
              slug={vertical.slug}
              index={index}
              locale={locale}
              verticalTools={vertical.integrations.items}
            />
            <AgentOutputs slug={vertical.slug} index={index} locale={locale} max={1} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentFeatured({ vertical, locale }: LayoutProps) {
  const first = vertical.agents[0];
  const rest = vertical.agents.slice(1);
  return (
    <div className="mt-6 space-y-4">
      {first ? (
        <AgentCard
          agent={first}
          slug={vertical.slug}
          index={0}
          locale={locale}
          verticalTools={vertical.integrations.items}
          outputMax={1}
        />
      ) : null}
      {rest.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-3">
          {rest.map((agent, i) => (
            <AgentCard
              key={agent.name.en}
              agent={agent}
              slug={vertical.slug}
              index={i + 1}
              locale={locale}
              verticalTools={vertical.integrations.items}
              outputMax={0}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  label,
  index,
  active,
  onSelect,
}: {
  label: string;
  index: number;
  active: boolean;
  onSelect: (index: number) => void;
}) {
  const handleClick = useCallback(() => onSelect(index), [onSelect, index]);
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={active}
      className={[
        "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "border-[#D52B0C] bg-[#D52B0C] text-white"
          : "border-[#E0D2C7] bg-white text-[#6E5C53] hover:border-[#D52B0C] hover:text-[#241712]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function AgentTabs({ vertical, locale }: LayoutProps) {
  const [active, setActive] = useState(0);
  const agent = vertical.agents[active];
  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-2">
        {vertical.agents.map((item, i) => (
          <TabButton key={item.name.en} label={loc(locale, item.name)} index={i} active={i === active} onSelect={setActive} />
        ))}
      </div>
      {agent ? (
        <div className="mt-5">
          <AgentCard
            agent={agent}
            slug={vertical.slug}
            index={active}
            locale={locale}
            verticalTools={vertical.integrations.items}
            outputMax={2}
          />
        </div>
      ) : null}
    </div>
  );
}

const LAYOUTS: Record<LayoutKey, ComponentType<LayoutProps>> = {
  stack: AgentStack,
  split: AgentSplit,
  grid: AgentGrid,
  tabs: AgentTabs,
  featured: AgentFeatured,
};

// One layout per vertical so each page can be reviewed and compared. Each of the five layouts is
// used by two verticals; the first five slugs below cover all five layouts.
const LAYOUT_BY_SLUG: Record<string, LayoutKey> = {
  notaires: "featured",
  "services-a-la-personne": "split",
  "courtiers-assurance": "grid",
  "experts-comptables": "tabs",
  ehpad: "stack",
  veterinaires: "split",
  pharmacies: "grid",
  "syndics-copropriete": "featured",
  "artisans-batiment": "tabs",
  hotellerie: "stack",
};

export function AgentApps({ vertical, locale }: LayoutProps) {
  const Body = LAYOUTS[LAYOUT_BY_SLUG[vertical.slug] ?? "stack"];
  return <Body vertical={vertical} locale={locale} />;
}
