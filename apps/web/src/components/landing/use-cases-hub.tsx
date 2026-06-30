import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useAppLocale } from "@/components/general-translation-provider";
import { loc, VERTICALS } from "./use-cases-data";

/**
 * Public hub page listing every vertical use-case (`/cas-usage`). Each card links to a
 * dedicated, server-rendered vertical page that is its own SEO target. Styled after the cmdclaw
 * audit demo: warm cream ground, Geist Mono eyebrows, heavy Geist headings, vermillion accent.
 */
const COPY = {
  eyebrow: { en: "Use cases", fr: "Cas d'usage" },
  title: {
    en: "AI agents, shaped to your profession",
    fr: "Des agents IA, façonnés à votre métier",
  },
  subtitle: {
    en: "HeyBap delivers an agentic app per workflow, connected across the tools your team already uses, with a human approving every step. Pick your vertical.",
    fr: "HeyBap livre une app agentique par workflow, connectée aux outils que votre équipe utilise déjà, avec un humain qui valide chaque étape. Choisissez votre verticale.",
  },
  explore: { en: "Explore", fr: "Découvrir" },
};

export function UseCasesHub() {
  const { locale } = useAppLocale();
  const t = (value: { en: string; fr: string }) => loc(locale, value);

  return (
    <main className="min-h-screen bg-[#FBF5F0] font-sans text-[#241712]">
      <div className="mx-auto max-w-5xl px-6 pt-20 pb-24 sm:pt-28">
        <header className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#D52B0C] uppercase">
            {t(COPY.eyebrow)}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-balance sm:text-5xl">
            {t(COPY.title)}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[#6E5C53]">{t(COPY.subtitle)}</p>
        </header>

        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {VERTICALS.map((vertical) => (
            <Link
              key={vertical.slug}
              to="/cas-usage/$vertical"
              // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
              params={{ vertical: vertical.slug }}
              className="group flex flex-col rounded-3xl border border-[#EADFD6] bg-white p-6 shadow-sm transition hover:border-[#E0D2C7] hover:shadow-md"
            >
              <span className="text-3xl" aria-hidden>
                {vertical.emoji}
              </span>
              <h2 className="mt-4 text-xl font-bold tracking-tight">{t(vertical.name)}</h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-[#6E5C53]">
                {t(vertical.hero.subtitle)}
              </p>
              <span className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.1em] text-[#D52B0C] uppercase">
                {t(COPY.explore)}
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
