import { Workflow } from "lucide-react";
import { type ComponentType, useCallback, useState } from "react";
import { buildAgentPreviews, getAgentSpec, type AgentOutput } from "./agent-specs";
import { OutputPreview } from "./output-preview";
import { loc, type Localized, type UseCaseAgent, type Vertical } from "./use-cases-data";

/**
 * Agentic-apps section, rendered in one of several layouts so we can compare dispositions across
 * the vertical pages (assigned per slug in LAYOUT_BY_SLUG). All layouts reuse the same building
 * blocks — AgentInfo (trigger / actions / outputs bullets) and AgentOutputs (framed previews).
 * Per-agent tool chips are intentionally omitted here: the tools live once in the page's
 * "connected tools" band, so repeating the same métier software on every agent added noise.
 */
type LayoutProps = { vertical: Vertical; locale: string };
type LayoutKey = "stack" | "split" | "tabs" | "wide-grid";

const CARD = "rounded-3xl border border-[#EADFD6] bg-white p-6 shadow-sm";
const SAMPLE = { en: "Sample output", fr: "Exemple de sortie" };
const SPEC_LABELS = {
  trigger: { en: "Trigger", fr: "Déclencheur" },
  does: { en: "What it does", fr: "Ce qu'il fait" },
  outputs: { en: "You get", fr: "Vous obtenez" },
};

function SpecLabel({ children }: { children: string }) {
  return (
    <p className="font-mono text-[10px] font-semibold tracking-[0.12em] text-[#9C8A80] uppercase">
      {children}
    </p>
  );
}

function LocalizedBulletList({
  items,
  locale,
  max,
}: {
  items: Localized[];
  locale: string;
  max?: number;
}) {
  const visibleItems = max ? items.slice(0, max) : items;
  return (
    <ul className="mt-1.5 space-y-1">
      {visibleItems.map((item) => (
        <li key={item.en} className="flex gap-2 text-sm leading-snug text-[#6E5C53]">
          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[#D52B0C]" />
          {loc(locale, item)}
        </li>
      ))}
    </ul>
  );
}

function OutputBulletList({ outputs, locale }: { outputs: AgentOutput[]; locale: string }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {outputs.map((output) => (
        <li key={output.label.en} className="flex gap-2 text-sm leading-snug text-[#6E5C53]">
          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[#D52B0C]" />
          {loc(locale, output.label)}
        </li>
      ))}
    </ul>
  );
}

// Concise breakdown of an agent's trigger / actions / outputs, straight from its spec — all bulleted.
function AgentSpecSummary({
  slug,
  index,
  locale,
}: {
  slug: string;
  index: number;
  locale: string;
}) {
  const spec = getAgentSpec(slug, index);
  if (!spec) {
    return null;
  }
  const trigger = spec.triggers[0];
  return (
    <div className="mt-4 space-y-3">
      {trigger ? (
        <div>
          <SpecLabel>{loc(locale, SPEC_LABELS.trigger)}</SpecLabel>
          <p className="mt-1 text-sm leading-snug text-[#6E5C53]">{loc(locale, trigger)}</p>
        </div>
      ) : null}
      <div>
        <SpecLabel>{loc(locale, SPEC_LABELS.does)}</SpecLabel>
        <LocalizedBulletList items={spec.actions} locale={locale} max={3} />
      </div>
      <div>
        <SpecLabel>{loc(locale, SPEC_LABELS.outputs)}</SpecLabel>
        <OutputBulletList outputs={spec.outputs} locale={locale} />
      </div>
    </div>
  );
}

function AgentInfo({
  agent,
  slug,
  index,
  locale,
}: {
  agent: UseCaseAgent;
  slug: string;
  index: number;
  locale: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#F3E9E1]">
          <Workflow className="size-[22px] text-[#D52B0C]" />
        </div>
        <h3 className="text-lg font-bold tracking-tight">{loc(locale, agent.name)}</h3>
      </div>
      <AgentSpecSummary slug={slug} index={index} locale={locale} />
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
  if (!spec) {
    return null;
  }
  const actions = spec.actions.map((value) => loc(locale, value));
  const previews = buildAgentPreviews(spec, locale, actions, max);
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
          tools={spec.tools}
        />
      ))}
    </div>
  );
}

function AgentCard({
  agent,
  slug,
  index,
  locale,
  outputMax,
}: {
  agent: UseCaseAgent;
  slug: string;
  index: number;
  locale: string;
  outputMax: number;
}) {
  return (
    <div className={CARD}>
      <AgentInfo agent={agent} slug={slug} index={index} locale={locale} />
      {outputMax > 0 ? (
        <div className="mt-5">
          <AgentOutputs slug={slug} index={index} locale={locale} max={outputMax} />
        </div>
      ) : null}
    </div>
  );
}

// Shared list used by stacked layouts.
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
          outputMax={outputMax}
        />
      ))}
    </div>
  );
}

function AgentStack({ vertical, locale }: LayoutProps) {
  return (
    <AgentCardList vertical={vertical} locale={locale} outputMax={2} className="mt-6 space-y-5" />
  );
}

function AgentSplit({ vertical, locale }: LayoutProps) {
  return (
    <div className="mt-6 space-y-5">
      {vertical.agents.map((agent, index) => (
        <div key={agent.name.en} className={CARD}>
          <div className="grid items-start gap-6 md:grid-cols-2">
            <AgentInfo agent={agent} slug={vertical.slug} index={index} locale={locale} />
            <AgentOutputs slug={vertical.slug} index={index} locale={locale} max={1} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentWideGrid({ vertical, locale }: LayoutProps) {
  return (
    <div className="relative left-1/2 mt-6 w-[min(calc(100vw-3rem),1120px)] -translate-x-1/2">
      <AgentCardList
        vertical={vertical}
        locale={locale}
        outputMax={1}
        className="grid gap-5 lg:grid-cols-2"
      />
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
          <TabButton
            key={item.name.en}
            label={loc(locale, item.name)}
            index={i}
            active={i === active}
            onSelect={setActive}
          />
        ))}
      </div>
      {agent ? (
        <div className="mt-5">
          <AgentCard
            agent={agent}
            slug={vertical.slug}
            index={active}
            locale={locale}
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
  tabs: AgentTabs,
  "wide-grid": AgentWideGrid,
};

// Keep the first four use cases on different layouts for quick demo comparisons.
const LAYOUT_BY_SLUG: Record<string, LayoutKey> = {
  notaires: "tabs",
  "services-a-la-personne": "split",
  "courtiers-assurance": "stack",
  "experts-comptables": "wide-grid",
  ehpad: "stack",
  veterinaires: "split",
  pharmacies: "stack",
  "syndics-copropriete": "tabs",
  "artisans-batiment": "tabs",
  hotellerie: "stack",
};

export function AgentApps({ vertical, locale }: LayoutProps) {
  const Body = LAYOUTS[LAYOUT_BY_SLUG[vertical.slug] ?? "stack"];
  return <Body vertical={vertical} locale={locale} />;
}
