import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Workflow } from "lucide-react";
import { useAppLocale } from "@/components/general-translation-provider";
import { Button } from "@/components/ui/button";
import { loc, type Vertical } from "./use-cases-data";

/**
 * Server-rendered vertical use-case page (`/cas-usage/<slug>`). Mirrors the HeyBap deck
 * narrative: hero → problem → agentic apps → integrations → impact → FAQ → CTA. Styled with the
 * deck palette. The FAQ is also emitted as JSON-LD `FAQPage` (see below) for rich results / GEO.
 */
const UI = {
  back: { en: "All use cases", fr: "Tous les cas d'usage" },
  agentsTitle: { en: "An agentic app for every step", fr: "Une app agentique par étape" },
  cta: { en: "Book a demo", fr: "Réserver une démo" },
  finalTitle: {
    en: "Deploy your first agents in under two weeks",
    fr: "Déployez vos premiers agents en moins de deux semaines",
  },
};

export function VerticalPage({ vertical }: { vertical: Vertical }) {
  const { locale } = useAppLocale();
  const t = (value: { en: string; fr: string }) => loc(locale, value);

  // JSON-LD FAQPage — server-rendered into the HTML so search engines and AI crawlers can read
  // the Q/A pairs as structured data.
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
    <main className="min-h-screen bg-[#FBF5F0] text-[#241712]">
      <script
        type="application/ld+json"
        // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <div className="mx-auto max-w-3xl px-6 pt-16 pb-24 sm:pt-20">
        <Link
          to="/cas-usage"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#6E5C53] transition-colors hover:text-[#241712]"
        >
          <ArrowLeft className="size-4" />
          {t(UI.back)}
        </Link>

        {/* ── Hero ── */}
        <header className="mt-10">
          <p className="text-xs font-semibold tracking-[0.18em] text-[#D52B0C] uppercase">
            {t(vertical.hero.eyebrow)}
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            {t(vertical.hero.title)}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-[#6E5C53]">{t(vertical.hero.subtitle)}</p>
          <div className="mt-8">
            <Button asChild size="lg" className="bg-[#D52B0C] px-7 text-white hover:bg-[#b8240a]">
              <a
                href="https://cal.com/hyperstack/try-bap"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t(UI.cta)}
              </a>
            </Button>
          </div>
        </header>

        {/* ── Problem ── */}
        <section className="mt-16 rounded-2xl border border-[#E0D2C7] bg-white p-7">
          <h2 className="text-2xl font-semibold tracking-tight">{t(vertical.problem.title)}</h2>
          <p className="mt-3 leading-relaxed text-[#6E5C53]">{t(vertical.problem.body)}</p>
        </section>

        {/* ── Agentic apps ── */}
        <section className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">
            {t(UI.agentsTitle)}
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {vertical.agents.map((agent) => (
              <div key={agent.name.en} className="rounded-2xl border border-[#E0D2C7] bg-white p-6">
                <Workflow className="size-5 text-[#D52B0C]" />
                <h3 className="mt-3 text-lg font-semibold">{t(agent.name)}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#6E5C53]">
                  {t(agent.description)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Integrations ── */}
        <section className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">
            {t(vertical.integrations.title)}
          </h2>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {vertical.integrations.items.map((item) => (
              <span
                key={item}
                className="rounded-full border border-[#E0D2C7] bg-white px-4 py-1.5 text-sm font-medium text-[#3C1E0A]"
              >
                {item}
              </span>
            ))}
          </div>
        </section>

        {/* ── Impact ── */}
        <section className="mt-16 grid gap-4 sm:grid-cols-3">
          {vertical.stats.map((stat) => (
            <div
              key={stat.label.en}
              className="rounded-2xl border border-[#E0D2C7] bg-[#F3E9E1] p-6 text-center"
            >
              <p className="text-3xl font-semibold tracking-tight text-[#D52B0C]">{stat.value}</p>
              <p className="mt-1.5 text-sm leading-snug text-[#6E5C53]">{t(stat.label)}</p>
            </div>
          ))}
        </section>

        {/* ── FAQ ── */}
        <section className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">FAQ</h2>
          <dl className="mt-5 space-y-4">
            {vertical.faq.map((item) => (
              <div
                key={item.question.en}
                className="rounded-2xl border border-[#E0D2C7] bg-white p-6"
              >
                <dt className="flex items-start gap-2.5 font-medium">
                  <Check className="mt-0.5 size-4 shrink-0 text-[#2E8B57]" />
                  {t(item.question)}
                </dt>
                <dd className="mt-2 pl-6.5 text-sm leading-relaxed text-[#6E5C53]">
                  {t(item.answer)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── CTA ── */}
        <section className="mt-16 rounded-2xl bg-[#241712] px-7 py-12 text-center text-white">
          <h2 className="text-2xl font-semibold tracking-tight">
            {t(UI.finalTitle)}
          </h2>
          <div className="mt-6">
            <Button asChild size="lg" className="bg-white px-7 text-[#241712] hover:bg-[#F3E9E1]">
              <a
                href="https://cal.com/hyperstack/try-bap"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t(UI.cta)}
              </a>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
