import { Link } from "@tanstack/react-router";
import { Download, Workflow, Wrench, X, Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { loc, type Localized, type UseCaseAgent, type Vertical } from "./use-cases-data";

/**
 * Agent detail popup for the vertical use-case pages, styled after the cmdclaw audit demo
 * (warm card, mono labels, espresso "Deploy" button). Read-only: it expands one agentic app
 * with its description, how it runs, the connected tools, and a "Deploy to HeyBap" CTA.
 *
 * Uses the native <dialog> element (`showModal`) so Escape, focus trapping and the backdrop are
 * handled by the platform. Only mounts client-side (opens on a card click). The "how it runs"
 * copy is the brand promise that holds for every HeyBap agent (propose → review → approve, audit
 * trail), not a per-agent invented metric.
 */
const M = {
  badge: { en: "Agentic app", fr: "App agentique" },
  how: { en: "How it runs", fr: "Comment ça marche" },
  howBody: {
    en: "The agent proposes, you decide. It runs on demand or on a schedule, prepares the work across your tools, and waits for your review, edit and approval before anything is sent. Every action is logged in a full audit trail.",
    fr: "L'agent propose, vous décidez. Il tourne à la demande ou planifié, prépare le travail à travers vos outils, et attend votre relecture, correction et validation avant tout envoi. Chaque action est tracée dans une piste d'audit complète.",
  },
  tools: { en: "Connected tools", fr: "Outils connectés" },
  deploy: { en: "Deploy to HeyBap", fr: "Déployer sur HeyBap" },
  close: { en: "Close", fr: "Fermer" },
};

export function AgentModal({
  agent,
  vertical,
  locale,
  onClose,
}: {
  agent: UseCaseAgent;
  vertical: Vertical;
  locale: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const t = (value: Localized) => loc(locale, value);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-label={t(agent.name)}
      className="relative m-auto w-[calc(100%-2.5rem)] max-w-lg rounded-3xl bg-white p-7 text-[#241712] shadow-2xl backdrop:bg-[#241712]/55"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t(M.close)}
        className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-full text-[#9C8A80] transition-colors hover:bg-[#F3E9E1] hover:text-[#241712]"
      >
        <X className="size-4" />
      </button>

      <div className="flex items-center gap-3.5 pr-8">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#F3E9E1]">
          <Workflow className="size-6 text-[#D52B0C]" />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-medium tracking-[0.14em] text-[#D52B0C] uppercase">
            {t(M.badge)}
          </p>
          <h3 className="text-xl font-bold tracking-tight text-[#241712]">{t(agent.name)}</h3>
        </div>
      </div>

      <p className="mt-4 leading-relaxed text-[#6E5C53]">{t(agent.description)}</p>

      <div className="mt-6">
        <p className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium tracking-[0.1em] text-[#9C8A80] uppercase">
          <Zap className="size-3.5 text-[#D52B0C]" /> {t(M.how)}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[#6E5C53]">{t(M.howBody)}</p>
      </div>

      <div className="mt-6">
        <p className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium tracking-[0.1em] text-[#9C8A80] uppercase">
          <Wrench className="size-3.5 text-[#D52B0C]" /> {t(M.tools)}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {vertical.integrations.items.map((item) => (
            <span
              key={item}
              className="rounded-full border border-[#E7D9D2] bg-[#FBF5F0] px-3 py-1 text-xs font-medium text-[#3C1E0A]"
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-7">
        <Button asChild className="h-11 w-full bg-[#241712] text-white hover:bg-[#3C1E0A]">
          <Link to="/login">
            <Download className="mr-1.5 size-4" />
            {t(M.deploy)}
          </Link>
        </Button>
      </div>
    </dialog>
  );
}
