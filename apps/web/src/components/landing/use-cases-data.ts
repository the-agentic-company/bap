/**
 * Vertical use-case content for the public SEO pages under `/_public/cas-usage`.
 *
 * Each vertical renders one dedicated, server-rendered page (`/cas-usage/<slug>`) that is its
 * own SEO target — e.g. `/cas-usage/notaires` ranks for "Agent IA Notaire". The content is
 * intentionally data-driven so non-engineers can extend it: add a `Vertical` entry here and a
 * new page exists, fully localized and with structured data.
 *
 * Copy is bilingual (EN default + FR) via the `{ en, fr }` shape; render with `loc(locale, …)`.
 *
 * TODO(lubin): the `notaires` entry below is a strawman placeholder. Replace its copy with the
 * real GTM content from the Notion notes (verticals / ICP / tools) once exported. `bpo-sales`
 * is real, lifted from the HeyBap deck.
 */

export interface Localized {
  en: string;
  fr: string;
}

export function loc(locale: string, value: Localized): string {
  return locale === "fr" ? value.fr : value.en;
}

export interface UseCaseAgent {
  /** Short agent name, e.g. "Daily Plan". */
  name: Localized;
  /** One-sentence description of what the agent does and the output the human approves. */
  description: Localized;
}

export interface UseCaseStat {
  /** Headline figure, e.g. "1.5h" or "+32%". Kept as a string to allow units. */
  value: string;
  label: Localized;
}

export interface UseCaseFaq {
  question: Localized;
  answer: Localized;
}

export interface Vertical {
  /** URL slug — keep it keyword-rich and stable. */
  slug: string;
  /** Display name of the profession / segment, e.g. "Notaires". */
  name: Localized;
  /** Emoji used as a lightweight visual until Claude Design assets land. */
  emoji: string;
  /** SEO <title>. Front-load the target keyword. */
  seoTitle: Localized;
  /** SEO meta description (~150 chars). */
  seoDescription: Localized;
  hero: {
    eyebrow: Localized;
    title: Localized;
    subtitle: Localized;
  };
  problem: {
    title: Localized;
    body: Localized;
  };
  /** 2–4 high-value agentic apps for this vertical. */
  agents: UseCaseAgent[];
  integrations: {
    title: Localized;
    /** Brand names of the métier tools — not localized. */
    items: string[];
  };
  /** Impact figures (indicative). */
  stats: UseCaseStat[];
  /** FAQ — also emitted as JSON-LD FAQPage for rich results / GEO. */
  faq: UseCaseFaq[];
}

const notaires: Vertical = {
  slug: "notaires",
  name: { en: "Notaries", fr: "Notaires" },
  emoji: "⚖️",
  seoTitle: {
    en: "AI Agent for Notaries — HeyBap",
    fr: "Agent IA pour Notaires — HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for notarial offices: deed preparation, client intake, document gathering and follow-ups — across your existing tools, with human approval on every step.",
    fr: "HeyBap déploie des agents IA pour les études notariales : préparation des actes, qualification client, collecte de pièces et relances — à travers vos outils existants, avec validation humaine à chaque étape.",
  },
  hero: {
    eyebrow: { en: "For notarial offices", fr: "Pour les études notariales" },
    title: { en: "The AI agent for notaries", fr: "L'agent IA pour les notaires" },
    subtitle: {
      en: "From client intake to the signing appointment, an agentic app for every step of the notarial workflow. The agent does the thinking, your clerks do the work — and approve every action.",
      fr: "De la qualification du dossier au rendez-vous de signature, une app agentique pour chaque étape du flux notarial. L'agent réfléchit, vos clercs travaillent — et valident chaque action.",
    },
  },
  problem: {
    title: { en: "The cost of a fragmented office", fr: "Le coût d'une étude fragmentée" },
    body: {
      en: "A notarial file runs across the drafting software, the GED, e-mail, the land registry and a dozen administrations that don't talk to each other. Clerks lose hours chasing missing documents and re-keying the same data — time that should be spent on the act itself.",
      fr: "Un dossier notarial circule entre le logiciel de rédaction, la GED, la messagerie, le service de publicité foncière et une dizaine d'administrations qui ne se parlent pas. Les clercs perdent des heures à relancer les pièces manquantes et à ressaisir les mêmes données — du temps qui devrait aller à l'acte lui-même.",
    },
  },
  agents: [
    {
      name: { en: "File opener", fr: "Ouverture de dossier" },
      description: {
        en: "Qualifies the incoming request, opens the file in your software, and produces the checklist of documents to collect from each party.",
        fr: "Qualifie la demande entrante, ouvre le dossier dans votre logiciel et produit la liste des pièces à collecter auprès de chaque partie.",
      },
    },
    {
      name: { en: "Document chaser", fr: "Relance des pièces" },
      description: {
        en: "Tracks which documents are still missing and drafts the follow-up e-mail to each party — you review and send in one click.",
        fr: "Suit les pièces encore manquantes et rédige la relance à chaque partie — vous relisez et envoyez en un clic.",
      },
    },
    {
      name: { en: "Deed prep brief", fr: "Brief de préparation d'acte" },
      description: {
        en: "Gathers the file data, flags inconsistencies, and assembles a prep brief for the clerk before drafting the deed.",
        fr: "Rassemble les données du dossier, signale les incohérences et assemble un brief de préparation pour le clerc avant la rédaction de l'acte.",
      },
    },
  ],
  integrations: {
    title: { en: "Connected to your office tools", fr: "Connecté aux outils de l'étude" },
    // TODO(lubin): replace with the real notarial stack from the Notion ICP notes.
    items: ["GenApi", "Fiducial", "iNot", "GED", "Gmail / Outlook", "Télé@ctes"],
  },
  stats: [
    { value: "—", label: { en: "hours given back per clerk", fr: "heures rendues par clerc" } },
    { value: "—", label: { en: "faster file completion", fr: "dossiers bouclés plus vite" } },
    {
      value: "—",
      label: { en: "fewer missing-document loops", fr: "boucles de pièces manquantes en moins" },
    },
  ],
  faq: [
    {
      question: {
        en: "Does the agent act on its own?",
        fr: "L'agent agit-il de lui-même ?",
      },
      answer: {
        en: "No. Nothing is sent or changed on its own — the agent proposes, and a human reviews, edits and approves every action, with a full audit trail.",
        fr: "Non. Rien n'est envoyé ni modifié de façon autonome — l'agent propose, et un humain relit, modifie et valide chaque action, avec une piste d'audit complète.",
      },
    },
    {
      question: {
        en: "Where does my client data live?",
        fr: "Où sont hébergées les données de mes clients ?",
      },
      answer: {
        en: "HeyBap can be self-hosted on your own servers, with role-based access and sandboxed environments. You can bring your own LLM or use ours.",
        fr: "HeyBap peut être auto-hébergé sur vos propres serveurs, avec accès par rôle et environnements isolés. Vous pouvez utiliser votre propre LLM ou le nôtre.",
      },
    },
  ],
};

const bpoSales: Vertical = {
  slug: "bpo-sales",
  name: { en: "BPO sales teams", fr: "Équipes commerciales BPO" },
  emoji: "📞",
  seoTitle: {
    en: "AI Agent for BPO Sales Teams — HeyBap",
    fr: "Agent IA pour les équipes commerciales BPO — HeyBap",
  },
  seoDescription: {
    en: "HeyBap gives every advisor a daily AI assistant — from call prep to follow-ups to the manager's weekly client report — across your 10–15 sales tools, with approval on every step.",
    fr: "HeyBap donne à chaque conseiller un assistant IA quotidien — de la préparation d'appel aux relances jusqu'au rapport client hebdomadaire du manager — à travers vos 10–15 outils, avec validation à chaque étape.",
  },
  hero: {
    eyebrow: { en: "For BPO sales floors", fr: "Pour les plateaux commerciaux BPO" },
    title: {
      en: "The daily AI assistant for BPO sales teams",
      fr: "L'assistant IA quotidien des équipes commerciales BPO",
    },
    subtitle: {
      en: "From the advisor's calls to the manager's weekly client report — an agentic app per workflow, shaped to how your floor actually works.",
      fr: "Des appels du conseiller au rapport client hebdomadaire du manager — une app agentique par workflow, façonnée à la réalité de votre plateau.",
    },
  },
  problem: {
    title: { en: "The cost of a disconnected sales floor", fr: "Le coût d'un plateau déconnecté" },
    body: {
      en: "BPO sales runs on 10 to 15 tools that don't talk to each other. The advisor loses hours jumping between them to prep calls and write follow-ups; the manager flies half-blind across five dashboards and a manual Friday report.",
      fr: "Le commercial BPO repose sur 10 à 15 outils qui ne se parlent pas. Le conseiller perd des heures à jongler pour préparer ses appels et écrire ses relances ; le manager pilote à l'aveugle entre cinq dashboards et un rapport manuel du vendredi.",
    },
  },
  agents: [
    {
      name: { en: "Daily Plan", fr: "Plan du jour" },
      description: {
        en: "A prep brief for every lead: who to call, their LinkedIn profile, company news, ICP fit, and the angle to open with.",
        fr: "Un brief de préparation pour chaque lead : qui appeler, son profil LinkedIn, l'actu de l'entreprise, l'adéquation ICP et l'angle d'ouverture.",
      },
    },
    {
      name: { en: "Follow-Up Analyzer", fr: "Analyseur de relance" },
      description: {
        en: "Diagnoses the deal from the call transcript and drafts the tailored follow-up email — you edit and send in one click.",
        fr: "Diagnostique le deal à partir du transcript d'appel et rédige la relance sur-mesure — vous éditez et envoyez en un clic.",
      },
    },
    {
      name: { en: "Weekly client report", fr: "Rapport client hebdomadaire" },
      description: {
        en: "The reporting chore the BPO owes its client, auto-generated and exported as a deck (.pptx).",
        fr: "La corvée de reporting que le BPO doit à son client, auto-générée et exportée en présentation (.pptx).",
      },
    },
  ],
  integrations: {
    title: { en: "Across all your sales tools", fr: "À travers tous vos outils commerciaux" },
    items: ["Salesforce", "HubSpot", "LinkedIn", "Gmail / Outlook", "SharePoint", "Any API / MCP"],
  },
  stats: [
    {
      value: "1.5h",
      label: {
        en: "given back to each advisor, every day",
        fr: "rendues à chaque conseiller, chaque jour",
      },
    },
    {
      value: "+32%",
      label: {
        en: "more conversations per rep each week",
        fr: "de conversations par commercial chaque semaine",
      },
    },
    {
      value: "<2 wks",
      label: {
        en: "from kickoff to agents live in production",
        fr: "du lancement aux agents en production",
      },
    },
  ],
  faq: [
    {
      question: {
        en: "How is this different from a chatbot or AI inside one tool?",
        fr: "En quoi est-ce différent d'un chatbot ou d'une IA dans un seul outil ?",
      },
      answer: {
        en: "A chatbot only acts when you prompt it; an in-tool agent only acts inside that one tool. HeyBap delivers agentic apps that run across all your tools and show every step for review before acting.",
        fr: "Un chatbot n'agit que si vous le sollicitez ; une IA intégrée n'agit que dans son outil. HeyBap livre des apps agentiques qui agissent à travers tous vos outils et montrent chaque étape pour validation avant d'agir.",
      },
    },
    {
      question: {
        en: "How long until agents are live?",
        fr: "Combien de temps avant que les agents soient en production ?",
      },
      answer: {
        en: "Pilots typically go from kickoff to agents live in production in under two weeks, measured against your own baseline.",
        fr: "Les pilotes passent généralement du lancement aux agents en production en moins de deux semaines, mesurés contre votre propre référence.",
      },
    },
  ],
};

export const VERTICALS: Vertical[] = [notaires, bpoSales];

export function getVertical(slug: string): Vertical | undefined {
  return VERTICALS.find((v) => v.slug === slug);
}
