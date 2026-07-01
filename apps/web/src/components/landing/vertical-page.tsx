import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Workflow } from "lucide-react";
import { useMemo } from "react";
import { useAppLocale } from "@/components/general-translation-provider";
import { Button } from "@/components/ui/button";
import { buildAgentPreviews, getAgentSpec } from "./agent-specs";
import { OutputPreview } from "./output-preview";
import { ToolLogo } from "./tool-logo";
import { loc, type Localized, type UseCaseAgent, type Vertical } from "./use-cases-data";

/**
 * Server-rendered vertical use-case page (`/cas-usage/<slug>`). Narrative: hero → problem →
 * agentic apps → integrations → impact → FAQ → CTA. Styled after the cmdclaw audit demo (warm
 * palette, mono eyebrows/labels via Geist Mono, heavy Geist headings, macOS-deck feel).
 *
 * Each "agentic app" block lays out its trigger / actions / outputs as concise bullets plus an
 * inline preview of the real output. The FAQ is emitted as JSON-LD `FAQPage` for rich results / GEO.
 */
const UI = {
  back: { en: "All use cases", fr: "Tous les cas d'usage" },
  agentsKicker: { en: "Agentic apps", fr: "Apps agentiques" },
  agentsTitle: { en: "An agentic app for every step", fr: "Une app agentique par étape" },
  agentsSub: {
    en: "Each agent's trigger, steps and results, with a real sample of what it produces.",
    fr: "Le déclencheur, les étapes et les résultats de chaque agent, avec un exemple concret de ce qu'il produit.",
  },
  sample: { en: "Sample output", fr: "Exemple de sortie" },
  howKicker: { en: "How it works", fr: "Comment ça marche" },
  howTitle: {
    en: "From your tools to a working agent, in three steps",
    fr: "De vos outils à un agent au travail, en trois étapes",
  },
  cta: { en: "Book a demo", fr: "Réserver une démo" },
  ctaTitle: {
    en: "Deploy your first agents in under two weeks",
    fr: "Déployez vos premiers agents en moins de deux semaines",
  },
  ctaBody: {
    en: "Connect your tools once. Your agents start delivering, with a human approving every step.",
    fr: "Connectez vos outils une fois. Vos agents se mettent au travail, avec un humain qui valide chaque étape.",
  },
  deployCta: { en: "Deploy on HeyBap", fr: "Déployer sur HeyBap" },
  moreTools: { en: "and many more tools", fr: "et bien d'autres outils" },
};

const NO_TOOLS: string[] = [];

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

// The agent's page-type outputs, rendered inline on the page (not hidden in the modal) so the
// real, app-grade output is the visual centerpiece of each agent block.
function AgentOutputs({
  slug,
  index,
  locale,
  sampleLabel,
}: {
  slug: string;
  index: number;
  locale: string;
  sampleLabel: string;
}) {
  const spec = getAgentSpec(slug, index);
  const tools = spec?.tools ?? NO_TOOLS;
  const actions = useMemo(() => (spec?.actions ?? []).map((value) => loc(locale, value)), [spec, locale]);
  const previews = useMemo(() => buildAgentPreviews(spec, locale, actions, 2), [spec, locale, actions]);

  if (previews.length === 0) {
    return null;
  }
  return (
    <div className="mt-5 space-y-4">
      {previews.map((preview) => (
        <OutputPreview
          key={preview.key}
          label={preview.label}
          sampleLabel={sampleLabel}
          locale={locale}
          lines={preview.lines}
          tools={tools}
        />
      ))}
    </div>
  );
}

const SPEC_LABELS = {
  trigger: { en: "Trigger", fr: "Déclencheur" },
  does: { en: "What it does", fr: "Ce qu'il fait" },
  outputs: { en: "You get", fr: "Vous obtenez" },
};

function SpecLabel({ children }: { children: string }) {
  return <p className="font-mono text-[10px] font-semibold tracking-[0.12em] text-[#9C8A80] uppercase">{children}</p>;
}

// Concise, bulleted breakdown of an agent's trigger / actions / outputs, straight from its spec.
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

// The agent's own tools first, then the rest of the vertical's stack (deduped), so each block
// shows a fuller set of connected tools without repeating any.
function mergeTools(primary: string[], extra: string[]): string[] {
  const seen = new Set(primary);
  return [...primary, ...extra.filter((tool) => !seen.has(tool))];
}

function AgentShowcase({
  agent,
  slug,
  locale,
  index,
  verticalTools,
}: {
  agent: UseCaseAgent;
  slug: string;
  locale: string;
  index: number;
  verticalTools: string[];
}) {
  const t = (value: Localized) => loc(locale, value);
  const chipTools = mergeTools(getAgentSpec(slug, index)?.tools ?? NO_TOOLS, verticalTools).slice(0, 6);
  return (
    <div className="rounded-3xl border border-[#EADFD6] bg-white p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#F3E9E1]">
          <Workflow className="size-[22px] text-[#D52B0C]" />
        </div>
        <h3 className="text-lg font-bold tracking-tight">{t(agent.name)}</h3>
      </div>
      <AgentSpecSummary slug={slug} index={index} locale={locale} />
      <ToolChipRow tools={chipTools} />
      <AgentOutputs slug={slug} index={index} locale={locale} sampleLabel={t(UI.sample)} />
    </div>
  );
}

// A real sequence (connect → review → deploy), so numbered markers carry meaning here.
const STEPS = [
  {
    n: "01",
    title: { en: "Connect your tools", fr: "Connectez vos outils" },
    body: {
      en: "Connect your existing tools once. Any tool with an MCP server works out of the box.",
      fr: "Connectez vos outils existants une fois. Tout outil disposant d'un serveur MCP marche directement.",
    },
  },
  {
    n: "02",
    title: { en: "The agent proposes, you approve", fr: "L'agent propose, vous validez" },
    body: {
      en: "It drafts the work; a human reviews, edits and approves every action, with a full audit trail.",
      fr: "Il prépare le travail ; un humain relit, modifie et valide chaque action, avec une piste d'audit complète.",
    },
  },
  {
    n: "03",
    title: { en: "Deploy and let it run", fr: "Déployez et laissez tourner" },
    body: {
      en: "Once you trust it, let the agent run the steps you choose on its own. You decide where the line sits.",
      fr: "Une fois en confiance, laissez l'agent exécuter seul les étapes que vous choisissez. Vous fixez la limite.",
    },
  },
];

function HowItWorks({ locale }: { locale: string }) {
  const t = (value: Localized) => loc(locale, value);
  return (
    <section className="mt-16">
      <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#D52B0C] uppercase">{t(UI.howKicker)}</p>
      <h2 className="mt-2 text-2xl font-bold tracking-tight">{t(UI.howTitle)}</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.n} className="rounded-3xl border border-[#EADFD6] bg-white p-6 shadow-sm">
            <p className="font-mono text-sm font-semibold tracking-[0.05em] text-[#D52B0C]">{step.n}</p>
            <h3 className="mt-2.5 text-base font-bold tracking-tight">{t(step.title)}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-[#6E5C53]">{t(step.body)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function VerticalPage({ vertical }: { vertical: Vertical }) {
  const { locale } = useAppLocale();
  const t = (value: Localized) => loc(locale, value);

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: vertical.faq.map((item) => ({
      "@type": "Question",
      name: t(item.question),
      acceptedAnswer: { "@type": "Answer", text: t(item.answer) },
    })),
  };
  return (
    <main className="min-h-screen bg-[#FBF5F0] font-sans text-[#241712]">
      <script
        type="application/ld+json"
        // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <div className="mx-auto max-w-3xl px-6 pt-14 pb-24 sm:pt-20">
        <Link
          to="/cas-usage"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.08em] text-[#6E5C53] uppercase transition-colors hover:text-[#241712]"
        >
          <ArrowLeft className="size-3.5" />
          {t(UI.back)}
        </Link>

        {/* Hero */}
        <header className="mt-9">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#D52B0C] uppercase">
            {t(vertical.hero.eyebrow)}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-balance sm:text-[52px] sm:leading-[1.04]">
            {t(vertical.hero.title)}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#6E5C53]">
            {t(vertical.hero.subtitle)}
          </p>
          <div className="mt-8">
            <Button
              asChild
              size="lg"
              className="bg-[#D52B0C] px-7 text-white shadow-[0_4px_14px_-4px_rgba(213,43,12,0.5)] hover:bg-[#B0240A]"
            >
              <a href="https://cal.com/hyperstack/try-bap" target="_blank" rel="noopener noreferrer">
                {t(UI.cta)}
              </a>
            </Button>
          </div>
        </header>

        {/* Agentic apps */}
        <section className="mt-16">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#D52B0C] uppercase">
            {t(UI.agentsKicker)}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">{t(UI.agentsTitle)}</h2>
          <p className="mt-2 text-[#6E5C53]">{t(UI.agentsSub)}</p>
          <div className="mt-6 space-y-5">
            {vertical.agents.map((agent, index) => (
              <AgentShowcase
                key={agent.name.en}
                agent={agent}
                slug={vertical.slug}
                locale={locale}
                index={index}
                verticalTools={vertical.integrations.items}
              />
            ))}
          </div>
        </section>

        {/* How it works */}
        <HowItWorks locale={locale} />

        {/* Problem */}
        <section className="mt-16 rounded-3xl border border-[#EADFD6] bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-bold tracking-tight">{t(vertical.problem.title)}</h2>
          <p className="mt-3 leading-relaxed text-[#6E5C53]">{t(vertical.problem.body)}</p>
        </section>

        {/* Integrations */}
        <section className="mt-16">
          <h2 className="text-2xl font-bold tracking-tight">{t(vertical.integrations.title)}</h2>
          <div className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-4">
            {vertical.integrations.items.map((item) => (
              <span key={item} className="inline-flex items-center gap-2.5 text-sm font-medium text-[#3C1E0A]">
                <ToolLogo name={item} size={28} />
                {item}
              </span>
            ))}
            <span className="text-sm font-medium text-[#9C8A80]">{t(UI.moreTools)}</span>
          </div>
        </section>

        {/* Impact */}
        <section className="mt-16 grid gap-4 sm:grid-cols-3">
          {vertical.stats.map((stat) => (
            <div
              key={stat.label.en}
              className="rounded-3xl border border-[#E0D2C7] bg-[#F3E9E1] p-6 text-center"
            >
              <p className="text-3xl font-bold tracking-tight text-[#D52B0C] tabular-nums">
                {stat.value}
              </p>
              <p className="mt-1.5 text-sm leading-snug text-[#6E5C53]">{t(stat.label)}</p>
            </div>
          ))}
        </section>

        {/* FAQ */}
        <section className="mt-16">
          <h2 className="text-2xl font-bold tracking-tight">FAQ</h2>
          <dl className="mt-5 space-y-4">
            {vertical.faq.map((item) => (
              <div
                key={item.question.en}
                className="rounded-3xl border border-[#EADFD6] bg-white p-6 shadow-sm"
              >
                <dt className="flex items-start gap-2.5 font-semibold">
                  <Check className="mt-0.5 size-4 shrink-0 text-[#2E8B57]" />
                  {t(item.question)}
                </dt>
                <dd className="mt-2 pl-7 text-sm leading-relaxed text-[#6E5C53]">{t(item.answer)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* CTA block */}
        <section className="mt-16 overflow-hidden rounded-3xl bg-[#241712] px-8 py-10 text-white sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div>
            <strong className="block text-xl font-bold tracking-tight">{t(UI.ctaTitle)}</strong>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-white/70">{t(UI.ctaBody)}</p>
          </div>
          <Button
            asChild
            size="lg"
            className="mt-5 shrink-0 bg-[#D52B0C] px-6 text-white hover:bg-[#B0240A] sm:mt-0"
          >
            <Link to="/login">
              {t(UI.deployCta)}
              <ArrowRight className="ml-1.5 size-4" />
            </Link>
          </Button>
        </section>
      </div>
    </main>
  );
}
