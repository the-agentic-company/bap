import type { ComponentType } from "react";

/**
 * Miniature, real-looking output previews for the agent modal, in the HeyBap palette. Each
 * page-type output is rendered as a small dashboard / table / list / letter / schedule / document
 * inside a macOS-window frame. The kind is inferred from the output label; sample data is
 * illustrative, while the output title and the agent's own steps/tools tie it to context.
 */
type Kind = "dashboard" | "table" | "list" | "letter" | "schedule" | "document";

type BodyProps = { locale: string; lines: string[]; tools: string[] };

const KIND_RULES: [RegExp, Kind][] = [
  [/courrier|lettre|letter|reply|réponse|convocation|welcome|bienvenue/i, "letter"],
  [/dashboard|tableau de bord|board|status|statut|état|suivi|impayé|balance/i, "dashboard"],
  [/schedule|planning|agenda|arrival|arrivée|calendar|créneau|tournée|semaine/i, "schedule"],
  [/devis|quote|invoice|facture|order|commande|entries|écriture|quittance|avis|sheet|fiche|bon/i, "table"],
  [/list|liste|checklist|queue|file|reminder|rappel|renewal|renouvellement|alert|alerte|recap|récap|point|pièce|digest|segment/i, "list"],
];

function previewKind(label: string): Kind {
  return KIND_RULES.find(([re]) => re.test(label))?.[1] ?? "document";
}

const BARS = [
  { id: "b1", style: { height: "42%" } },
  { id: "b2", style: { height: "68%" } },
  { id: "b3", style: { height: "54%" } },
  { id: "b4", style: { height: "83%" } },
  { id: "b5", style: { height: "60%" } },
  { id: "b6", style: { height: "94%" } },
  { id: "b7", style: { height: "72%" } },
];

const KPIS = [
  { id: "k1", value: "128", en: "Total", fr: "Total" },
  { id: "k2", value: "12", en: "To review", fr: "À traiter" },
  { id: "k3", value: "98%", en: "On track", fr: "Conformes" },
];

const CELLS = [
  { col: 0, row: 0, tone: "verm" },
  { col: 1, row: 1, tone: "green" },
  { col: 2, row: 0, tone: "amber" },
  { col: 3, row: 2, tone: "verm" },
  { col: 4, row: 1, tone: "green" },
];

const TONE: Record<string, string> = {
  verm: "bg-[#D52B0C]",
  green: "bg-[#2E8B57]",
  amber: "bg-[#E8A33D]",
};

const SCHEDULE_DAYS = [
  { id: "d1", en: "M", fr: "L" },
  { id: "d2", en: "T", fr: "M" },
  { id: "d3", en: "W", fr: "M" },
  { id: "d4", en: "T", fr: "J" },
  { id: "d5", en: "F", fr: "V" },
];
const SCHEDULE_ROWS = ["r0", "r1", "r2"];

function pick(lines: string[], samples: string[]): string[] {
  const cleaned = lines.map((line) => line.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : samples;
}

function DashboardBody({ locale }: BodyProps) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-3 rounded-lg border border-[#EADFD6] bg-[#FBF5F0] p-2.5">
        <div className="relative size-12 shrink-0">
          <svg viewBox="0 0 36 36" className="size-full -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15.915" fill="none" stroke="#EADFD6" strokeWidth="3.4" />
            <circle
              cx="18"
              cy="18"
              r="15.915"
              fill="none"
              stroke="#D52B0C"
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeDasharray="78 100"
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-[12px] font-bold text-[#241712] tabular-nums">
            78
          </span>
        </div>
        <div>
          <p className="font-mono text-[8px] tracking-wide text-[#9C8A80] uppercase">
            {locale === "fr" ? "Score global" : "Overall score"}
          </p>
          <p className="text-[13px] font-bold tracking-tight text-[#241712]">
            {locale === "fr" ? "En bonne voie" : "On track"} <span className="text-[#2E8B57]">+5</span>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KPIS.map((kpi) => (
          <div key={kpi.id} className="rounded-lg border border-[#EADFD6] bg-[#FBF5F0] p-2">
            <p className="text-[15px] font-bold tracking-tight text-[#D52B0C] tabular-nums">
              {kpi.value}
            </p>
            <p className="mt-0.5 font-mono text-[8px] tracking-wide text-[#9C8A80] uppercase">
              {locale === "fr" ? kpi.fr : kpi.en}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex h-10 items-end gap-1.5">
        {BARS.map((bar) => (
          <div
            key={bar.id}
            style={bar.style}
            className={`flex-1 rounded-t-sm ${bar.id === "b6" ? "bg-[#241712]" : "bg-[#D52B0C]/75"}`}
          />
        ))}
      </div>
    </div>
  );
}

function TableBody({ locale, tools }: BodyProps) {
  const rows = pick(tools, ["Référence A", "Référence B", "Référence C", "Référence D"]).slice(0, 4);
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-[#EADFD6] pb-1 font-mono text-[8.5px] tracking-wide text-[#9C8A80] uppercase">
        <span>{locale === "fr" ? "Élément" : "Item"}</span>
        <span className="text-right">{locale === "fr" ? "Qté" : "Qty"}</span>
        <span className="text-right">{locale === "fr" ? "Montant" : "Amount"}</span>
      </div>
      {rows.map((row, i) => (
        <div
          key={row}
          className="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-[#F3E9E1] py-1 text-[10.5px] text-[#3C1E0A]"
        >
          <span className="truncate">{row}</span>
          <span className="text-right text-[#6E5C53] tabular-nums">{(i + 1) * 3}</span>
          <span className="text-right tabular-nums">{(i + 1) * 120} €</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between text-[10.5px] font-semibold">
        <span className="text-[#6E5C53]">Total</span>
        <span className="text-[#D52B0C] tabular-nums">1 200 €</span>
      </div>
    </div>
  );
}

function ListBody({ locale, lines }: BodyProps) {
  const items = pick(lines, ["Dossier Martin", "Dossier Bernard", "Dossier Petit", "Dossier Durand"]).slice(0, 4);
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={item} className="flex items-center gap-2">
          <span className={`size-1.5 shrink-0 rounded-full ${i % 2 === 0 ? "bg-[#E8A33D]" : "bg-[#2E8B57]"}`} />
          <span className="flex-1 truncate text-[10.5px] text-[#3C1E0A]">{item}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 font-mono text-[8px] ${
              i % 2 === 0 ? "bg-[#FAE5DF] text-[#B0240A]" : "bg-[#E6F2EB] text-[#2E8B57]"
            }`}
          >
            {i % 2 === 0 ? (locale === "fr" ? "À faire" : "To do") : locale === "fr" ? "Validé" : "Done"}
          </span>
        </div>
      ))}
    </div>
  );
}

function LetterBody({ locale, lines }: BodyProps) {
  const body = pick(lines, [
    locale === "fr" ? "Nous faisons suite à votre dossier" : "Following up on your file",
    locale === "fr" ? "Les éléments sont prêts pour validation" : "The items are ready for review",
  ]).slice(0, 2);
  return (
    <div className="space-y-1.5 text-[10.5px] leading-relaxed text-[#6E5C53]">
      <p>{locale === "fr" ? "Madame, Monsieur," : "Dear Sir or Madam,"}</p>
      {body.map((line) => (
        <p key={line}>{line}.</p>
      ))}
      <p className="pt-1 text-[#9C8A80]">{locale === "fr" ? "Cordialement," : "Kind regards,"}</p>
    </div>
  );
}

function ScheduleBody({ locale }: BodyProps) {
  return (
    <div>
      <div className="mb-1 grid grid-cols-5 gap-1 font-mono text-[8px] tracking-wide text-[#9C8A80] uppercase">
        {SCHEDULE_DAYS.map((day) => (
          <span key={day.id} className="text-center">
            {locale === "fr" ? day.fr : day.en}
          </span>
        ))}
      </div>
      <div className="space-y-1">
        {SCHEDULE_ROWS.map((rowId, row) => (
          <div key={rowId} className="grid grid-cols-5 gap-1">
            {SCHEDULE_DAYS.map((day, col) => {
              const cell = CELLS.find((item) => item.col === col && item.row === row);
              return <div key={day.id} className={`h-3.5 rounded-sm ${cell ? TONE[cell.tone] : "bg-[#F3E9E1]"}`} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DocumentBody({ lines }: BodyProps) {
  const body = pick(lines, [
    "Synthèse des éléments du dossier",
    "Points vérifiés et à valider",
    "Actions recommandées",
  ]).slice(0, 3);
  return (
    <div>
      <div className="space-y-1.5">
        {body.map((line) => (
          <div key={line} className="flex items-start gap-2">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#D52B0C]/60" />
            <span className="text-[10.5px] leading-snug text-[#6E5C53]">{line}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-8 items-end gap-1">
        {BARS.slice(0, 5).map((bar) => (
          <div key={bar.id} style={bar.style} className="flex-1 rounded-t-sm bg-[#EADFD6]" />
        ))}
      </div>
    </div>
  );
}

const BODIES: Record<Kind, ComponentType<BodyProps>> = {
  dashboard: DashboardBody,
  table: TableBody,
  list: ListBody,
  letter: LetterBody,
  schedule: ScheduleBody,
  document: DocumentBody,
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
      <div className="min-h-[150px] p-3.5">
        <p className="mb-2.5 text-[12px] font-bold tracking-tight text-[#241712]">{label}</p>
        <Body locale={locale} lines={lines} tools={tools} />
      </div>
    </figure>
  );
}
