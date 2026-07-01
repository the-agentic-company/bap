import { Check, Mail, Zap } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

/**
 * Dense, real-looking output previews for the agent modal, in the HeyBap palette and inspired by
 * the CmdClaw mini-apps: a window frame wrapping a multi-section "brief" (score gauge, stat strip,
 * verdict rows, two-column review), a drafted-email card, a detailed table, a schedule grid, etc.
 * The kind is inferred from the output label. Text is intentionally small, the point is to convey
 * a complete, app-grade output. Sample data is illustrative; the agent's own steps/tools seed it.
 */
type Kind = "brief" | "table" | "list" | "letter" | "schedule";

type BodyProps = { locale: string; lines: string[]; tools: string[] };

function tr(locale: string, en: string, fr: string): string {
  return locale === "fr" ? fr : en;
}

function pick(lines: string[], samples: string[]): string[] {
  const cleaned = lines.flatMap((line) => {
    const trimmed = line.trim();
    return trimmed ? [trimmed] : [];
  });
  return cleaned.length > 0 ? cleaned : samples;
}

const KIND_RULES: [RegExp, Kind][] = [
  [
    /courrier|lettre|letter|reply|réponse|email|message|convocation|welcome|bienvenue|accusé|acknowledg|relance|brouillon|draft/i,
    "letter",
  ],
  [/schedule|planning|agenda|arrival|arrivée|calendar|créneau|tournée|semaine/i, "schedule"],
  [
    /summary|synthèse|résumé|report|rapport|bilan|profil|score|analy|dashboard|tableau de bord|état|statut/i,
    "brief",
  ],
  [
    /devis|quote|invoice|facture|order|commande|entries|écriture|quittance|avis|bon|stock|montant/i,
    "table",
  ],
  [
    /list|liste|checklist|queue|reminder|rappel|renewal|renouvellement|alert|alerte|recap|récap|pièce|digest|segment|missing|manquant|todo|tâche/i,
    "list",
  ],
];

function previewKind(label: string): Kind {
  return KIND_RULES.find(([re]) => re.test(label))?.[1] ?? "brief";
}

const STATS = [
  { id: "s1", v: "128", en: "Processed", fr: "Traités" },
  { id: "s2", v: "12", en: "To review", fr: "À revoir" },
  { id: "s3", v: "98%", en: "Clean", fr: "Conformes" },
];

const VERDICTS = [
  { en: "Done", fr: "OK", cls: "bg-[#D52B0C] text-white" },
  { en: "Review", fr: "À voir", cls: "bg-[#FAE5DF] text-[#B0240A]" },
  { en: "Done", fr: "OK", cls: "bg-[#E6F2EB] text-[#2E8B57]" },
];

const TONE: Record<string, string> = {
  verm: "bg-[#D52B0C]",
  green: "bg-[#2E8B57]",
  amber: "bg-[#E8A33D]",
};
const CELLS = [
  { col: 0, row: 0, tone: "verm" },
  { col: 1, row: 1, tone: "green" },
  { col: 2, row: 0, tone: "amber" },
  { col: 3, row: 2, tone: "verm" },
  { col: 4, row: 1, tone: "green" },
];
const DAYS = [
  { id: "d1", en: "M", fr: "L" },
  { id: "d2", en: "T", fr: "M" },
  { id: "d3", en: "W", fr: "M" },
  { id: "d4", en: "T", fr: "J" },
  { id: "d5", en: "F", fr: "V" },
];
const ROWS = ["r0", "r1", "r2"];

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="mt-3 mb-1.5 flex items-center gap-2">
      <Icon className="size-3 text-[#D52B0C]" />
      <span className="font-mono text-[8px] font-semibold tracking-[0.14em] text-[#6E5C53] uppercase">
        {children}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-[#E0D2C7] to-transparent" />
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#E0D2C7] bg-white">{children}</div>
  );
}

function Ring({ value }: { value: number }) {
  return (
    <div className="relative size-11 shrink-0">
      <svg viewBox="0 0 36 36" className="size-full -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r="15.915" fill="none" stroke="#EADFD6" strokeWidth="3.6" />
        <circle
          cx="18"
          cy="18"
          r="15.915"
          fill="none"
          stroke="#D52B0C"
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeDasharray={`${value} 100`}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-bold text-[#241712] tabular-nums">
        {value}
      </span>
    </div>
  );
}

function StatStrip({ locale }: { locale: string }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {STATS.map((s) => (
        <div key={s.id} className="rounded-lg border border-[#EADFD6] bg-[#FBF5F0] px-2.5 py-1.5">
          <p className="text-[14px] font-bold tracking-tight text-[#241712] tabular-nums">{s.v}</p>
          <p className="font-mono text-[7px] tracking-wide text-[#9C8A80] uppercase">
            {tr(locale, s.en, s.fr)}
          </p>
        </div>
      ))}
    </div>
  );
}

function VerdictRows({ lines, locale }: { lines: string[]; locale: string }) {
  const rows = pick(lines, [
    "Item reviewed",
    "Cross-checked against file",
    "Flagged for review",
    "Prepared draft",
  ]).slice(0, 4);
  return (
    <Card>
      {rows.map((row, i) => {
        const v = VERDICTS[i % VERDICTS.length];
        return (
          <div
            key={row}
            className="flex items-center gap-2 border-b border-[#F3E9E1] px-2.5 py-1.5 last:border-b-0"
          >
            <span className="size-1 shrink-0 rounded-full bg-[#D52B0C]" />
            <span className="flex-1 truncate text-[9.5px] text-[#3C1E0A]">{row}</span>
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[7px] font-semibold uppercase ${v.cls}`}
            >
              {tr(locale, v.en, v.fr)}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

function ReviewCol({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return (
    <Card>
      <p
        className={`border-b border-[#F3E9E1] px-2.5 py-1.5 font-mono text-[7px] font-semibold tracking-wide uppercase ${tone}`}
      >
        {title}
      </p>
      <div className="space-y-1 p-2.5">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-1.5">
            <span className="mt-1 size-1 shrink-0 rounded-full bg-[#9C8A80]" />
            <span className="text-[9px] leading-snug text-[#6E5C53]">{item}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BriefBody({ locale, lines }: BodyProps) {
  const all = pick(lines, [
    "Reviewed the file",
    "Cross-checked data",
    "Prepared the draft",
    "Flagged anomalies",
  ]);
  const verified = all.slice(0, 2);
  const toConfirm = all.slice(2, 4);
  return (
    <div>
      <div className="flex items-center gap-3 rounded-lg border border-[#EADFD6] bg-[#FBF5F0] p-2.5">
        <Ring value={78} />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[7px] tracking-wide text-[#9C8A80] uppercase">
            {tr(locale, "Overall score", "Score global")}
          </p>
          <p className="text-[12px] font-bold tracking-tight text-[#241712]">
            {tr(locale, "On track", "En bonne voie")} <span className="text-[#2E8B57]">+5</span>
          </p>
        </div>
        <span className="rounded-full bg-[#FAE5DF] px-2 py-0.5 font-mono text-[7px] font-semibold text-[#B0240A] uppercase">
          {tr(locale, "Ready", "Prêt")}
        </span>
      </div>
      <SectionLabel icon={Zap}>
        {tr(locale, "Checks · 3 of 4 clear", "Contrôles · 3 sur 4 OK")}
      </SectionLabel>
      <VerdictRows lines={lines} locale={locale} />
      <SectionLabel icon={Check}>{tr(locale, "Review", "Revue")}</SectionLabel>
      <div className="grid grid-cols-2 gap-1.5">
        <ReviewCol
          title={tr(locale, "Verified", "Vérifié")}
          tone="text-[#2E8B57]"
          items={verified}
        />
        <ReviewCol
          title={tr(locale, "To confirm", "À confirmer")}
          tone="text-[#B0240A]"
          items={toConfirm}
        />
      </div>
    </div>
  );
}

function ListBody({ locale, lines }: BodyProps) {
  return (
    <div>
      <StatStrip locale={locale} />
      <SectionLabel icon={Zap}>{tr(locale, "Items to handle", "Éléments à traiter")}</SectionLabel>
      <VerdictRows lines={lines} locale={locale} />
    </div>
  );
}

function TableBody({ locale, tools }: BodyProps) {
  const rows = pick(tools, ["Référence A", "Référence B", "Référence C", "Référence D"]).slice(
    0,
    4,
  );
  return (
    <div>
      <StatStrip locale={locale} />
      <SectionLabel icon={Zap}>{tr(locale, "Line items", "Lignes")}</SectionLabel>
      <Card>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-[#EADFD6] bg-[#F3E9E1] px-2.5 py-1.5 font-mono text-[7px] tracking-wide text-[#9C8A80] uppercase">
          <span>{tr(locale, "Item", "Élément")}</span>
          <span className="text-right">{tr(locale, "Qty", "Qté")}</span>
          <span className="text-right">{tr(locale, "Amount", "Montant")}</span>
        </div>
        {rows.map((row, i) => (
          <div
            key={row}
            className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-[#F3E9E1] px-2.5 py-1.5 text-[9.5px] text-[#3C1E0A] last:border-b-0"
          >
            <span className="truncate">{row}</span>
            <span className="text-right text-[#6E5C53] tabular-nums">{(i + 1) * 3}</span>
            <span className="text-right tabular-nums">{(i + 1) * 120} €</span>
          </div>
        ))}
      </Card>
      <div className="mt-1.5 flex justify-between px-1 text-[9.5px] font-semibold">
        <span className="text-[#6E5C53]">Total</span>
        <span className="text-[#D52B0C] tabular-nums">1 200 €</span>
      </div>
    </div>
  );
}

function LetterBody({ locale, lines }: BodyProps) {
  const body = pick(lines, [
    tr(
      locale,
      "As discussed, here is the summary and the next step.",
      "Comme convenu, voici la synthèse et la prochaine étape.",
    ),
    tr(
      locale,
      "Let me know if anything needs adjusting.",
      "Dites-moi si quelque chose doit être ajusté.",
    ),
  ]).slice(0, 2);
  return (
    <Card>
      <div className="flex items-center gap-1.5 border-b border-[#EADFD6] bg-[#F3E9E1] px-3 py-1.5">
        <Mail className="size-3 text-[#B0240A]" />
        <span className="font-mono text-[7.5px] font-semibold tracking-wide text-[#B0240A] uppercase">
          {tr(locale, "Drafted", "Brouillon")}
        </span>
        <span className="ml-auto font-mono text-[7.5px] text-[#9C8A80]">
          {tr(locale, "Ready to send", "Prêt à envoyer")}
        </span>
      </div>
      <div className="border-b border-[#F3E9E1] px-3 py-2 text-[10.5px] font-semibold text-[#241712]">
        <span className="mr-1.5 font-mono text-[7.5px] text-[#9C8A80] uppercase">
          {tr(locale, "Subject", "Objet")}
        </span>
        {tr(locale, "Following up on your file", "Suite à votre dossier")}
      </div>
      <div className="space-y-1.5 px-3 py-2.5 text-[9.5px] leading-relaxed text-[#6E5C53]">
        <p>{tr(locale, "Hello,", "Bonjour,")}</p>
        {body.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p className="text-[#9C8A80]">{tr(locale, "Kind regards,", "Cordialement,")}</p>
      </div>
      <div className="flex gap-1.5 border-t border-[#F3E9E1] px-3 py-2">
        <span className="rounded-md bg-[#D52B0C] px-2 py-1 font-mono text-[7.5px] font-semibold text-white">
          {tr(locale, "Send", "Envoyer")}
        </span>
        <span className="rounded-md border border-[#E0D2C7] px-2 py-1 font-mono text-[7.5px] font-semibold text-[#6E5C53]">
          {tr(locale, "Edit", "Éditer")}
        </span>
      </div>
    </Card>
  );
}

function ScheduleBody({ locale }: BodyProps) {
  return (
    <div>
      <StatStrip locale={locale} />
      <SectionLabel icon={Zap}>{tr(locale, "This week", "Cette semaine")}</SectionLabel>
      <Card>
        <div className="p-2.5">
          <div className="mb-1 grid grid-cols-5 gap-1 font-mono text-[7px] tracking-wide text-[#9C8A80] uppercase">
            {DAYS.map((day) => (
              <span key={day.id} className="text-center">
                {tr(locale, day.en, day.fr)}
              </span>
            ))}
          </div>
          <div className="space-y-1">
            {ROWS.map((rowId, row) => (
              <div key={rowId} className="grid grid-cols-5 gap-1">
                {DAYS.map((day, col) => {
                  const cell = CELLS.find((item) => item.col === col && item.row === row);
                  return (
                    <div
                      key={day.id}
                      className={`h-3 rounded-sm ${cell ? TONE[cell.tone] : "bg-[#F3E9E1]"}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

const BODIES: Record<Kind, ComponentType<BodyProps>> = {
  brief: BriefBody,
  table: TableBody,
  list: ListBody,
  letter: LetterBody,
  schedule: ScheduleBody,
};

export function OutputPreview({
  label,
  sampleLabel,
  locale,
  lines,
  tools,
}: {
  label: string;
  sampleLabel: string;
  locale: string;
  lines: string[];
  tools: string[];
}) {
  const Body = BODIES[previewKind(label)];
  return (
    <figure className="overflow-hidden rounded-xl border border-[#E0D2C7] bg-white shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-[#EADFD6] bg-[#F3E9E1] px-3 py-2">
        <span className="size-2 rounded-full bg-[#FF5F57]" />
        <span className="size-2 rounded-full bg-[#FEBC2E]" />
        <span className="size-2 rounded-full bg-[#28C840]" />
        <span className="ml-1.5 truncate font-mono text-[10px] text-[#9C8A80]">{label}</span>
        <span className="ml-auto rounded-full bg-white px-1.5 py-0.5 font-mono text-[8.5px] tracking-wide text-[#9C8A80] uppercase">
          {sampleLabel}
        </span>
      </div>
      <div className="bg-[#FBF5F0] p-3">
        <p className="mb-2 text-[12px] font-bold tracking-tight text-[#241712]">{label}</p>
        <Body locale={locale} lines={lines} tools={tools} />
      </div>
    </figure>
  );
}
