import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useAppLocale } from "@/components/general-translation-provider";
import { Button } from "@/components/ui/button";
import { AgentApps } from "./agent-apps";
import { ToolLogo } from "./tool-logo";
import { loc, type Localized, type Vertical } from "./use-cases-data";

/**
 * Server-rendered vertical use-case page (`/cas-usage/<slug>`). Narrative: hero → integrations →
 * agentic apps → how it works → problem → impact → FAQ → CTA. Styled after the cmdclaw audit demo
 * (warm palette, mono eyebrows/labels via Geist Mono, heavy Geist headings, macOS-deck feel).
 *
 * The agentic-apps section is rendered by `AgentApps`, whose layout varies per vertical (see
 * `agent-apps.tsx`). The FAQ is emitted as JSON-LD `FAQPage` for rich results / GEO.
 */
const UI = {
  back: { en: "All use cases", fr: "Tous les cas d'usage" },
  agentsKicker: { en: "Agentic apps", fr: "Apps agentiques" },
  agentsTitle: { en: "An agentic app for every step", fr: "Une app agentique par étape" },
  agentsSub: {
    en: "Each agent's trigger, steps and results, with a real sample of what it produces.",
    fr: "Le déclencheur, les étapes et les résultats de chaque agent, avec un exemple concret de ce qu'il produit.",
  },
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

        {/* Integrations — "works with your stack" trust band, right under the hero */}
        <section className="mt-12">
          <h2 className="font-mono text-[11px] font-medium tracking-[0.16em] text-[#6E5C53] uppercase">
            {t(vertical.integrations.title)}
          </h2>
          <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-4">
            {vertical.integrations.items.map((item) => (
              <span key={item} className="inline-flex items-center gap-2.5 text-sm font-medium text-[#3C1E0A]">
                <ToolLogo name={item} size={28} />
                {item}
              </span>
            ))}
            <span className="text-sm font-medium text-[#9C8A80]">{t(UI.moreTools)}</span>
          </div>
        </section>

        {/* Agentic apps */}
        <section className="mt-16">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#D52B0C] uppercase">
            {t(UI.agentsKicker)}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">{t(UI.agentsTitle)}</h2>
          <p className="mt-2 text-[#6E5C53]">{t(UI.agentsSub)}</p>
          <AgentApps vertical={vertical} locale={locale} />
        </section>

        {/* How it works */}
        <HowItWorks locale={locale} />

        {/* Problem */}
        <section className="mt-16 rounded-3xl border border-[#EADFD6] bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-bold tracking-tight">{t(vertical.problem.title)}</h2>
          <p className="mt-3 leading-relaxed text-[#6E5C53]">{t(vertical.problem.body)}</p>
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
