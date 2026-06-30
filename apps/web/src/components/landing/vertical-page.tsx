import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Workflow } from "lucide-react";
import { useCallback, useState } from "react";
import { useAppLocale } from "@/components/general-translation-provider";
import { Button } from "@/components/ui/button";
import { AgentModal } from "./agent-modal";
import { getAgentSpec } from "./agent-specs";
import { ToolLogo } from "./tool-logo";
import { loc, type Localized, type UseCaseAgent, type Vertical } from "./use-cases-data";

/**
 * Server-rendered vertical use-case page (`/cas-usage/<slug>`). Narrative: hero → problem →
 * agentic apps → integrations → impact → FAQ → CTA. Styled after the cmdclaw audit demo (warm
 * palette, mono eyebrows/labels via Geist Mono, heavy Geist headings, macOS-deck feel).
 *
 * The "agentic apps" cards open an `AgentModal` popup with a "Deploy to HeyBap" CTA. The FAQ is
 * emitted as JSON-LD `FAQPage` for rich results / GEO.
 */
const UI = {
  back: { en: "All use cases", fr: "Tous les cas d'usage" },
  agentsKicker: { en: "Agentic apps", fr: "Apps agentiques" },
  agentsTitle: { en: "An agentic app for every step", fr: "Une app agentique par étape" },
  agentsSub: {
    en: "Tap an agent to see how it works and deploy it to HeyBap.",
    fr: "Cliquez sur un agent pour voir comment il fonctionne et le déployer sur HeyBap.",
  },
  open: { en: "See the agent", fr: "Voir l'agent" },
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

function AgentCard({
  agent,
  slug,
  locale,
  index,
  onOpen,
}: {
  agent: UseCaseAgent;
  slug: string;
  locale: string;
  index: number;
  onOpen: (index: number) => void;
}) {
  const t = (value: Localized) => loc(locale, value);
  const handleOpen = useCallback(() => onOpen(index), [onOpen, index]);
  const tools = (getAgentSpec(slug, index)?.tools ?? []).slice(0, 3);
  return (
    <button
      type="button"
      onClick={handleOpen}
      className="group flex flex-col rounded-3xl border border-[#EADFD6] bg-white p-6 text-left shadow-sm transition hover:border-[#E0D2C7] hover:shadow-md"
    >
      <div className="flex size-11 items-center justify-center rounded-2xl bg-[#F3E9E1]">
        <Workflow className="size-[22px] text-[#D52B0C]" />
      </div>
      <h3 className="mt-4 text-lg font-bold tracking-tight">{t(agent.name)}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[#6E5C53]">{t(agent.description)}</p>
      {tools.length > 0 ? (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {tools.map((tool) => (
            <span
              key={tool}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#EADFD6] bg-[#FBF5F0] py-0.5 pr-2 pl-1.5 text-[11px] font-medium text-[#6E5C53]"
            >
              <ToolLogo name={tool} size={13} />
              {tool}
            </span>
          ))}
        </div>
      ) : null}
      <span className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.1em] text-[#D52B0C] uppercase">
        {t(UI.open)}
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

export function VerticalPage({ vertical }: { vertical: Vertical }) {
  const { locale } = useAppLocale();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const openAt = useCallback((index: number) => setOpenIndex(index), []);
  const closeModal = useCallback(() => setOpenIndex(null), []);
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

        {/* Problem */}
        <section className="mt-16 rounded-3xl border border-[#EADFD6] bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-bold tracking-tight">{t(vertical.problem.title)}</h2>
          <p className="mt-3 leading-relaxed text-[#6E5C53]">{t(vertical.problem.body)}</p>
        </section>

        {/* Agentic apps */}
        <section className="mt-16">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#D52B0C] uppercase">
            {t(UI.agentsKicker)}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">{t(UI.agentsTitle)}</h2>
          <p className="mt-2 text-[#6E5C53]">{t(UI.agentsSub)}</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {vertical.agents.map((agent, index) => (
              <AgentCard
                key={agent.name.en}
                agent={agent}
                slug={vertical.slug}
                locale={locale}
                index={index}
                onOpen={openAt}
              />
            ))}
          </div>
        </section>

        {/* Integrations */}
        <section className="mt-16">
          <h2 className="text-2xl font-bold tracking-tight">{t(vertical.integrations.title)}</h2>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {vertical.integrations.items.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-3 rounded-2xl border border-[#E0D2C7] bg-white py-3 pr-5 pl-4 text-base font-semibold text-[#3C1E0A] shadow-sm"
              >
                <ToolLogo name={item} size={30} />
                {item}
              </span>
            ))}
            <span className="inline-flex items-center rounded-2xl border border-dashed border-[#E0D2C7] px-5 py-3 text-base font-medium text-[#6E5C53]">
              {t(UI.moreTools)}
            </span>
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

      {openIndex !== null ? (
        <AgentModal
          agent={vertical.agents[openIndex]}
          vertical={vertical}
          index={openIndex}
          locale={locale}
          onClose={closeModal}
        />
      ) : null}
    </main>
  );
}
