/**
 * Vertical use-case content for the public SEO pages under `/_public/cas-usage`.
 *
 * Each vertical renders one dedicated, server-rendered page (`/cas-usage/<slug>`) that is its
 * own SEO target, e.g. `/cas-usage/notaires` ranks for "Agent IA Notaire". The content is
 * intentionally data-driven so non-engineers can extend it: add a `Vertical` entry here and a
 * new page exists, fully localized and with structured data.
 *
 * Copy is bilingual (EN default + FR) via the `{ en, fr }` shape; render with `loc(locale, …)`.
 *
 * Content is grounded in the GTM / ICP Notion notes (verticals, métier tools, pain points,
 * personas). Copy is a reviewable first draft, figures are factual market context, not invented
 * ROI. The vertical set below is curated (6 of ~35 ICPs in the base); extend as needed.
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
  /** Headline figure, e.g. "40 000" or "< 2 sem.". Kept as a string to allow units. */
  value: string;
  label: Localized;
}

export interface UseCaseFaq {
  question: Localized;
  answer: Localized;
}

export interface Vertical {
  /** URL slug, keep it keyword-rich and stable. */
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
    /** Brand names of the métier tools, not localized. */
    items: string[];
  };
  /** Indicative / factual context figures. */
  stats: UseCaseStat[];
  /** FAQ, also emitted as JSON-LD FAQPage for rich results / GEO. */
  faq: UseCaseFaq[];
}

// Shared FAQs reused across every vertical (the message is the same everywhere).
const AUTONOMY_FAQ: UseCaseFaq = {
  question: { en: "Does the agent act on its own?", fr: "L'agent agit-il de lui-même ?" },
  answer: {
    en: "It is your choice. By default the agent proposes and a human reviews, edits and approves every action, with a full audit trail. If you prefer, you can let it run trusted steps on its own, you decide where the line sits.",
    fr: "C'est vous qui décidez. Par défaut, l'agent propose et un humain relit, modifie et valide chaque action, avec une piste d'audit complète. Si vous le souhaitez, vous pouvez le laisser exécuter seul les étapes de confiance : vous fixez la limite.",
  },
};

const INTEGRATIONS_FAQ: UseCaseFaq = {
  question: { en: "What if a tool we use isn't listed?", fr: "Et si un de nos outils n'est pas listé ?" },
  answer: {
    en: "Any tool with an MCP server connects out of the box, and we build any missing integration ourselves. Your existing stack is never a blocker.",
    fr: "Tout outil disposant d'un serveur MCP se connecte directement, et nous développons nous-mêmes toute intégration manquante. Votre stack existant n'est jamais un frein.",
  },
};

const notaires: Vertical = {
  slug: "notaires",
  name: { en: "Notaries", fr: "Notaires" },
  emoji: "⚖️",
  seoTitle: {
    en: "AI Agent for Notaries · HeyBap",
    fr: "Agent IA pour notaires · HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for notarial offices: normalized deed summaries, accounting-document filing, reconciliation and email drafting, across Genapi/iNot and your existing tools, with human approval on every action.",
    fr: "HeyBap déploie des agents IA pour les études notariales : résumés normalisés des actes, classement des pièces comptables, pointage et rédaction d'e-mails, à travers Genapi/iNot et vos outils existants, avec validation humaine sur chaque action.",
  },
  hero: {
    eyebrow: { en: "For notarial offices", fr: "Pour les études notariales" },
    title: { en: "The AI agent for notaries", fr: "L'agent IA pour les notaires" },
    subtitle: {
      en: "For every document-heavy task of the office, an agent works across your tools and prepares the output, your clerks review, edit and approve. The agent proposes, you decide.",
      fr: "Pour chaque tâche documentaire de l'étude, un agent travaille à travers vos outils et prépare le résultat, vos clercs relisent, corrigent et valident. L'agent propose, vous décidez.",
    },
  },
  problem: {
    title: {
      en: "Hours lost to document handling",
      fr: "Des heures perdues sur le traitement des pièces",
    },
    body: {
      en: "Notarial work is overwhelmingly document-heavy: deeds to pre-review, accounting documents to classify, signatures and registrations to reconcile across Yousign, Infogreffe and Comedec. Your clerks spend hours on this manual handling instead of on the legal substance of the file.",
      fr: "Le travail notarial est massivement documentaire : actes à pré-relire, pièces comptables à classer, signatures et formalités à pointer entre Yousign, Infogreffe et Comedec. Vos clercs passent des heures sur ce traitement manuel au lieu du fond juridique du dossier.",
    },
  },
  agents: [
    {
      name: { en: "Normalized deed summary", fr: "Résumé normalisé des actes" },
      description: {
        en: "Reads each deed and produces a standardized summary highlighting key clauses and parties, the clerk reviews and validates it before it goes in the file.",
        fr: "Lit chaque acte et produit un résumé standardisé mettant en avant les clauses clés et les parties, le clerc le relit et le valide avant versement au dossier.",
      },
    },
    {
      name: { en: "Accounting-document filing", fr: "Classement des pièces comptables" },
      description: {
        en: "Classifies incoming accounting documents and files them in the right place in your software, you approve the classification in one click.",
        fr: "Classe les pièces comptables entrantes et les range au bon endroit dans votre logiciel, vous validez le classement en un clic.",
      },
    },
    {
      name: {
        en: "Yousign / Infogreffe / Comedec reconciliation",
        fr: "Pointage Yousign / Infogreffe / Comedec",
      },
      description: {
        en: "Reconciles signatures and formalities across Yousign, Infogreffe and Comedec, flags what is missing, and presents the result for your review.",
        fr: "Pointe les signatures et formalités entre Yousign, Infogreffe et Comedec, signale ce qui manque et présente le résultat pour votre validation.",
      },
    },
    {
      name: { en: "Email reply drafting", fr: "Reformulation des réponses e-mail" },
      description: {
        en: "Drafts clear, on-tone replies to client and counterparty e-mails from the file context, you edit and send in one click.",
        fr: "Rédige des réponses claires et au bon ton aux e-mails des clients et confrères à partir du contexte du dossier, vous éditez et envoyez en un clic.",
      },
    },
  ],
  integrations: {
    title: { en: "Connected to your office tools", fr: "Connecté aux outils de l'étude" },
    items: ["Genapi (iNot)", "Fichorga", "Fiducial", "Yousign", "Infogreffe", "Comedec"],
  },
  stats: [
    { value: "17 000", label: { en: "notarial offices in France", fr: "études notariales en France" } },
    {
      value: "16",
      label: {
        en: "agents in build at our pilot office, C&C Notaires",
        fr: "agents en construction chez notre étude pilote, C&C Notaires",
      },
    },
    { value: "< 2 sem.", label: { en: "from kickoff to agents live", fr: "du lancement aux agents en production" } },
  ],
  faq: [
    AUTONOMY_FAQ,
    {
      question: {
        en: "Is it compatible with notarial secrecy and our data?",
        fr: "Est-ce compatible avec le secret notarial et nos données ?",
      },
      answer: {
        en: "Yes. HeyBap can be self-hosted on your own servers, with role-based access and a full audit trail, built to respect notarial confidentiality.",
        fr: "Oui. HeyBap peut être auto-hébergé sur vos propres serveurs, avec accès par rôle et piste d'audit complète, pensé pour respecter le secret notarial.",
      },
    },
    INTEGRATIONS_FAQ,
  ],
};

const servicesALaPersonne: Vertical = {
  slug: "services-a-la-personne",
  name: { en: "Home-care & personal services", fr: "Services à la personne" },
  emoji: "🏠",
  seoTitle: {
    en: "AI Agent for Home-Care Providers · HeyBap",
    fr: "Agent IA pour les services à la personne · HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for home-care providers: scheduling and replacements, family follow-ups, URSSAF/CAF contracts and clocking reconciliation, across Ogust and your existing tools, with human approval on every action.",
    fr: "HeyBap déploie des agents IA pour les structures de services à la personne : planning et remplacements, suivi des familles, contrats URSSAF/CAF et rapprochement de la télégestion, à travers Ogust et vos outils existants, avec validation humaine sur chaque action.",
  },
  hero: {
    eyebrow: {
      en: "For home-care & personal-services providers",
      fr: "Pour les structures de services à la personne",
    },
    title: {
      en: "The AI agent for home-care providers",
      fr: "L'agent IA pour les services à la personne",
    },
    subtitle: {
      en: "From the schedule to the call to the family, an agentic app for every administrative task that eats your days. The agent proposes, your coordinators decide, and approve every action.",
      fr: "Du planning à l'appel aux familles, une app agentique pour chaque tâche administrative qui dévore vos journées. L'agent propose, vos coordinateurs décident, et valident chaque action.",
    },
  },
  problem: {
    title: {
      en: "Admin is swallowing your coordinators",
      fr: "L'administratif engloutit vos coordinateurs",
    },
    body: {
      en: "Last-minute caregiver replacements, mandatory clocking to reconcile, APA-PCH funding to track and families to keep informed: every hour your coordinators spend chasing this is an hour away from the field. And it all lives in tools that barely talk to each other.",
      fr: "Remplacements d'intervenants en dernière minute, télégestion obligatoire à rapprocher, financements APA-PCH à suivre et familles à tenir informées : chaque heure que vos coordinateurs y passent est une heure de moins sur le terrain. Et tout cela vit dans des outils qui se parlent à peine.",
    },
  },
  agents: [
    {
      name: { en: "Scheduling & replacements", fr: "Planning & remplacements" },
      description: {
        en: "When a caregiver cancels, it finds the available replacements, proposes the best fit and drafts the reshuffled schedule, your coordinator validates before anything moves.",
        fr: "Quand un intervenant se décommande, il identifie les remplaçants disponibles, propose le meilleur profil et prépare le planning réajusté, votre coordinateur valide avant tout changement.",
      },
    },
    {
      name: { en: "Family follow-ups", fr: "Appels aux familles" },
      description: {
        en: "It prepares the calls and messages owed to families, drafts each update from the file, and logs the outcome once your coordinator has reviewed and sent it.",
        fr: "Il prépare les appels et messages dus aux familles, rédige chaque point à partir du dossier et consigne le suivi une fois que votre coordinateur a relu et envoyé.",
      },
    },
    {
      name: { en: "URSSAF/CAF contracts", fr: "Contrats URSSAF/CAF" },
      description: {
        en: "It assembles the contract and compliance paperwork from the client file and flags what's missing, you review and approve before any document goes out.",
        fr: "Il assemble les contrats et les pièces de conformité à partir du dossier client et signale ce qui manque, vous relisez et validez avant tout envoi.",
      },
    },
    {
      name: { en: "Clocking reconciliation", fr: "Télégestion & pointage" },
      description: {
        en: "It cross-checks remote clocking against the planned schedule, flags the gaps to correct, and prepares the reconciliation, your office approves each adjustment.",
        fr: "Il rapproche les pointages de la télégestion avec le planning prévu, signale les écarts à corriger et prépare le rapprochement, votre bureau valide chaque ajustement.",
      },
    },
  ],
  integrations: {
    title: { en: "Connected to your home-care tools", fr: "Connecté à vos outils métier" },
    items: ["Ogust", "Apologic", "Ximi", "Domatel"],
  },
  stats: [
    {
      value: "40 000",
      label: {
        en: "home-care providers in France",
        fr: "structures de services à la personne en France",
      },
    },
    {
      value: "⌀ 25",
      label: { en: "employees per provider on average", fr: "salariés par structure en moyenne" },
    },
    { value: "< 2 sem.", label: { en: "from kickoff to agents live", fr: "du lancement aux agents en production" } },
  ],
  faq: [
    AUTONOMY_FAQ,
    INTEGRATIONS_FAQ,
  ],
};

const courtiersAssurance: Vertical = {
  slug: "courtiers-assurance",
  name: { en: "Insurance Brokers", fr: "Courtiers en assurance" },
  emoji: "🛡️",
  seoTitle: {
    en: "AI Agent for Insurance Brokers · HeyBap",
    fr: "Agent IA pour courtiers en assurance · HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for insurance brokerage firms: claims intake, quote prep and follow-ups, document tracking and ACPR compliance, across your existing tools, with human approval on every step.",
    fr: "HeyBap déploie des agents IA pour les cabinets de courtage en assurance : création de sinistres, préparation des devis et relances, suivi des pièces et conformité ACPR, à travers vos outils existants, avec validation humaine à chaque étape.",
  },
  hero: {
    eyebrow: { en: "For insurance brokerage firms", fr: "Pour les cabinets de courtage" },
    title: {
      en: "The AI agent for insurance brokers",
      fr: "L'agent IA pour les courtiers en assurance",
    },
    subtitle: {
      en: "From a claim reported on WhatsApp to the quote sent to your client, an agentic app for every step of your firm's workflow. The agent proposes, you decide, and approve every action.",
      fr: "D'un sinistre déclaré sur WhatsApp au devis envoyé à votre client, une app agentique pour chaque étape du flux de votre cabinet. L'agent propose, vous décidez, et validez chaque action.",
    },
  },
  problem: {
    title: { en: "The cost of a fragmented firm", fr: "Le coût d'un cabinet fragmenté" },
    body: {
      en: "Your CRM, contracts, document management, insurer extranets and claims handling all live in separate tools that don't talk to each other. Your team loses hours re-keying the same data and chasing documents, time that should go to your clients and to staying ACPR-compliant.",
      fr: "Votre CRM, les contrats, la GED, les extranets assureurs et la gestion des sinistres vivent dans des outils séparés qui ne se parlent pas. Votre équipe perd des heures à ressaisir les mêmes données et à relancer les pièces, du temps qui devrait aller à vos clients et au respect de la conformité ACPR.",
    },
  },
  agents: [
    {
      name: { en: "Claims intake & creation", fr: "Création de sinistres" },
      description: {
        en: "Collects a claim reported by WhatsApp or email, builds the document checklist and drafts the claim in your software, you review and validate the creation.",
        fr: "Recueille un sinistre déclaré par WhatsApp ou email, établit la liste des pièces à fournir et prépare la création du sinistre dans votre logiciel, vous relisez et validez la création.",
      },
    },
    {
      name: { en: "Quote prep & follow-ups", fr: "Préparation des devis & relances" },
      description: {
        en: "Assembles the data for a quote and drafts the client follow-ups, you review, adjust and send in one click.",
        fr: "Rassemble les données d'un devis et rédige les relances client, vous relisez, ajustez et envoyez en un clic.",
      },
    },
    {
      name: { en: "Document & ACPR tracking", fr: "Suivi des pièces & conformité ACPR" },
      description: {
        en: "Tracks which documents are still missing across each file and flags compliance gaps for ACPR, you approve every reminder before it goes out.",
        fr: "Suit les pièces encore manquantes dossier par dossier et signale les manques de conformité ACPR, vous validez chaque relance avant l'envoi.",
      },
    },
    {
      name: { en: "Client request triage", fr: "Tri & réponse aux demandes clients" },
      description: {
        en: "Sorts incoming client requests by priority and drafts a reply for each one, you review and approve before anything is sent.",
        fr: "Trie les demandes clients entrantes par priorité et rédige une réponse pour chacune, vous relisez et validez avant tout envoi.",
      },
    },
  ],
  integrations: {
    title: { en: "Connected to your brokerage tools", fr: "Connecté aux outils de votre cabinet" },
    items: ["CourtiGo", "Antenia", "EDI Courtage NEO", "WhatsApp", "Gmail / Outlook", "Any API / MCP"],
  },
  stats: [
    { value: "25 000", label: { en: "brokerage firms in France", fr: "cabinets de courtage en France" } },
    { value: "90%", label: { en: "of firms under 11 employees", fr: "des cabinets de moins de 11 salariés" } },
    {
      value: "POC",
      label: {
        en: "claims agent live in pilot at Assurhélium",
        fr: "agent sinistres en pilote chez Assurhélium",
      },
    },
  ],
  faq: [
    AUTONOMY_FAQ,
    INTEGRATIONS_FAQ,
    {
      question: {
        en: "Is it compliant for a regulated activity?",
        fr: "Est-ce conforme pour une activité réglementée ?",
      },
      answer: {
        en: "HeyBap can be self-hosted on your own servers, with role-based access and a full audit trail of every action, built for an ACPR-regulated activity. You can bring your own LLM or use ours.",
        fr: "HeyBap peut être auto-hébergé sur vos propres serveurs, avec accès par rôle et une piste d'audit complète de chaque action, pensé pour une activité réglementée par l'ACPR. Vous pouvez utiliser votre propre LLM ou le nôtre.",
      },
    },
  ],
};

const expertsComptables: Vertical = {
  slug: "experts-comptables",
  name: { en: "Accounting Firms", fr: "Experts-comptables" },
  emoji: "🧮",
  seoTitle: {
    en: "AI Agent for Accounting Firms · HeyBap",
    fr: "Agent IA pour experts-comptables · HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for accounting firms: document collection and chasing, data pre-entry, bank reconciliation and client replies, across Sage, Cegid and Pennylane, with human approval on every step.",
    fr: "HeyBap déploie des agents IA pour les cabinets d'expertise comptable : collecte et relance des pièces, pré-saisie, rapprochement bancaire et réponses clients, à travers Sage, Cegid et Pennylane, avec validation humaine à chaque étape.",
  },
  hero: {
    eyebrow: { en: "For accounting firms", fr: "Pour les cabinets d'expertise comptable" },
    title: {
      en: "The AI agent for accounting firms",
      fr: "L'agent IA pour les experts-comptables",
    },
    subtitle: {
      en: "From chasing client documents to the year-end review, an agentic app for every recurring task in the firm. The agent does the legwork, your team reviews and approves every action.",
      fr: "De la relance des pièces clients au rendez-vous bilan, une app agentique pour chaque tâche récurrente du cabinet. L'agent fait le travail de fond, votre équipe relit et valide chaque action.",
    },
  },
  problem: {
    title: { en: "The cost of administrative overload", fr: "Le coût de la surcharge administrative" },
    body: {
      en: "Your collaborators spend their days chasing missing client documents, pre-entering data and reconciling bank statements by hand, and answering the same recurring questions. That is time taken away from advising clients and growing the firm.",
      fr: "Vos collaborateurs passent leurs journées à relancer les pièces manquantes, à pré-saisir les écritures et rapprocher les relevés bancaires à la main, et à répondre aux mêmes questions récurrentes. Autant de temps soustrait au conseil client et au développement du cabinet.",
    },
  },
  agents: [
    {
      name: { en: "Document collection & chasing", fr: "Collecte & relance des pièces" },
      description: {
        en: "Tracks which documents each client still owes and drafts the personalized follow-up, you review and send in one click.",
        fr: "Suit les pièces que chaque client doit encore fournir et rédige la relance personnalisée, vous relisez et envoyez en un clic.",
      },
    },
    {
      name: { en: "Data pre-entry & bank reconciliation", fr: "Pré-saisie & rapprochement bancaire" },
      description: {
        en: "Reads the invoices and bank statements, proposes the accounting entries and matches transactions, your collaborator checks and validates before posting.",
        fr: "Lit les factures et relevés bancaires, propose les écritures comptables et rapproche les opérations, votre collaborateur contrôle et valide avant comptabilisation.",
      },
    },
    {
      name: { en: "Client question replies", fr: "Réponses aux questions clients" },
      description: {
        en: "Drafts answers to recurring client questions from the file data, you review, adjust and send.",
        fr: "Rédige les réponses aux questions clients récurrentes à partir des données du dossier, vous relisez, ajustez et envoyez.",
      },
    },
    {
      name: { en: "Year-end review prep", fr: "Préparation du rendez-vous bilan" },
      description: {
        en: "Gathers the file data, flags anomalies and assembles a review brief for the partner before the year-end client meeting.",
        fr: "Rassemble les données du dossier, signale les anomalies et assemble un brief pour l'expert avant le rendez-vous bilan.",
      },
    },
  ],
  integrations: {
    title: { en: "Connected to your accounting tools", fr: "Connecté à vos outils comptables" },
    items: ["Sage Coala", "Cegid Expert", "ACD (Cador)", "Agiris", "RCA", "Pennylane"],
  },
  stats: [
    {
      value: "22 000",
      label: { en: "accounting firms in France", fr: "cabinets d'expertise comptable en France" },
    },
    {
      value: "< 2 sem.",
      label: { en: "from kickoff to agents live in production", fr: "du lancement aux agents en production" },
    },
  ],
  faq: [
    AUTONOMY_FAQ,
    INTEGRATIONS_FAQ,
    {
      question: { en: "Where does my client data live?", fr: "Où sont hébergées les données de mes clients ?" },
      answer: {
        en: "HeyBap can be self-hosted on your own servers, with role-based access and a full audit trail. You can bring your own LLM or use ours.",
        fr: "HeyBap peut être auto-hébergé sur vos propres serveurs, avec accès par rôle et piste d'audit complète. Vous pouvez utiliser votre propre LLM ou le nôtre.",
      },
    },
  ],
};

const ehpad: Vertical = {
  slug: "ehpad",
  name: { en: "Nursing Homes (EHPAD)", fr: "EHPAD" },
  emoji: "🧓",
  seoTitle: {
    en: "AI Agent for Nursing Homes (EHPAD) · HeyBap",
    fr: "Agent IA pour les EHPAD · HeyBap",
  },
  seoDescription: {
    en: "An AI agent that works across your NetSoins and existing tools to handle admissions, family communication and resident paperwork. It proposes, your team decides. Live in under 2 weeks.",
    fr: "Un agent IA qui travaille à travers NetSoins et vos outils existants pour gérer les admissions, la communication aux familles et le suivi administratif des résidents. Il propose, votre équipe décide. En production en moins de 2 semaines.",
  },
  hero: {
    eyebrow: { en: "For nursing home directors", fr: "Pour les directeurs d'établissement" },
    title: {
      en: "The AI agent for nursing homes (EHPAD)",
      fr: "L'agent IA pour les EHPAD",
    },
    subtitle: {
      en: "HeyBap deploys an AI agent shaped to your facility's workflow. It drafts the admission replies, the family updates and the aid follow-ups; your staff reviews and approves every action before anything goes out.",
      fr: "HeyBap déploie un agent IA façonné sur le fonctionnement de votre établissement. Il prépare les réponses aux demandes d'admission, les nouvelles aux familles et le suivi des aides ; vos équipes relisent et valident chaque action avant tout envoi.",
    },
  },
  problem: {
    title: {
      en: "Your teams are caregivers, not administrators",
      fr: "Vos équipes sont soignantes, pas administratives",
    },
    body: {
      en: "Admission requests, family messages and resident paperwork (APA, public aids) eat hours that should go to residents. The information already lives in NetSoins and your other tools, but assembling it falls back on people.",
      fr: "Les demandes d'admission, les messages aux familles et les dossiers des résidents (APA, aides publiques) absorbent des heures qui devraient aller aux résidents. L'information est déjà dans NetSoins et vos autres outils, mais c'est à vos équipes de la rassembler.",
    },
  },
  agents: [
    {
      name: { en: "Admission requests handling", fr: "Gestion des demandes d'admission" },
      description: {
        en: "Reads each incoming admission request, checks availability and the resident's profile across your tools, and drafts a complete reply that your team reviews and approves before sending.",
        fr: "Lit chaque demande d'admission entrante, vérifie la disponibilité et le profil du résident à travers vos outils, et prépare une réponse complète que votre équipe relit et valide avant l'envoi.",
      },
    },
    {
      name: { en: "Family communication", fr: "Communication aux familles" },
      description: {
        en: "Prepares clear, personalised updates to families about their relative based on the file in NetSoins, ready for a caregiver to review, adjust and approve before it is sent.",
        fr: "Prépare des nouvelles claires et personnalisées aux familles sur leur proche à partir du dossier NetSoins, prêtes à être relues, ajustées et validées par un soignant avant l'envoi.",
      },
    },
    {
      name: { en: "Resident admin follow-up", fr: "Suivi administratif résidents" },
      description: {
        en: "Tracks each resident's APA and public-aid status, flags renewals and missing documents, and assembles the paperwork for your team to check and approve.",
        fr: "Suit le statut APA et les aides publiques de chaque résident, signale les renouvellements et les pièces manquantes, et assemble les dossiers que votre équipe vérifie et valide.",
      },
    },
  ],
  integrations: {
    title: { en: "Works with the tools you already use", fr: "Fonctionne avec les outils que vous utilisez déjà" },
    items: ["NetSoins", "Orisha Socialcare", "Ségur", "Posos", "Titan", "Teranga", "MedgicNet"],
  },
  stats: [
    { value: "7 500", label: { en: "nursing homes (EHPAD) in France", fr: "EHPAD en France" } },
    { value: "< 2 sem.", label: { en: "to go live", fr: "pour être en production" } },
    { value: "100 %", label: { en: "of actions reviewed by your team", fr: "des actions validées par votre équipe" } },
  ],
  faq: [
    AUTONOMY_FAQ,
    {
      question: {
        en: "What about resident data confidentiality?",
        fr: "Qu'en est-il de la confidentialité des données des résidents ?",
      },
      answer: {
        en: "HeyBap can be self-hosted so your data stays under your control, with role-based access so each person only sees what they should, and a full audit trail of every action taken.",
        fr: "HeyBap peut être auto-hébergé pour que vos données restent sous votre contrôle, avec des accès par rôle pour que chacun ne voie que ce qui le concerne, et une traçabilité complète de chaque action.",
      },
    },
    INTEGRATIONS_FAQ,
  ],
};

const veterinaires: Vertical = {
  slug: "veterinaires",
  name: { en: "Veterinary Clinics", fr: "Vétérinaires" },
  emoji: "🐾",
  seoTitle: {
    en: "AI Agent for Veterinary Clinics · HeyBap",
    fr: "Agent IA pour vétérinaires · HeyBap",
  },
  seoDescription: {
    en: "An AI agent that handles your clinic's phone calls, appointments, vaccine reminders and reports across your existing tools. The agent proposes, you approve every action.",
    fr: "Un agent IA qui gère le standard, les RDV, les rappels vaccins et les comptes-rendus de votre clinique, à travers vos outils existants. L'agent propose, vous validez chaque action.",
  },
  hero: {
    eyebrow: { en: "For veterinary clinics", fr: "Pour les cliniques vétérinaires" },
    title: {
      en: "The AI agent for veterinary clinics",
      fr: "L'agent IA pour les vétérinaires",
    },
    subtitle: {
      en: "HeyBap deploys an AI agent that fields calls, books appointments and drafts your reports across the tools you already use. Nothing goes out until you approve it.",
      fr: "HeyBap déploie un agent IA qui répond au téléphone, prend les RDV et rédige vos comptes-rendus à travers les outils que vous utilisez déjà. Rien ne part sans votre validation.",
    },
  },
  problem: {
    title: {
      en: "The phone never stops, and the admin piles up",
      fr: "Le téléphone n'arrête pas, et l'administratif s'accumule",
    },
    body: {
      en: "Between non-stop calls, appointment booking, vaccine reminders and consultation reports, your team spends hours on tasks that pull them away from animals. HeyBap takes on this repetitive workload and hands you back the time, while keeping you in control of every decision.",
      fr: "Entre les appels incessants, la prise de RDV, les rappels de vaccins et les comptes-rendus, votre équipe passe des heures sur des tâches qui l'éloignent des animaux. HeyBap prend en charge cette charge répétitive et vous rend du temps, tout en vous laissant maître de chaque décision.",
    },
  },
  agents: [
    {
      name: { en: "Phone reception & booking", fr: "Standard téléphonique & RDV" },
      description: {
        en: "Answers incoming calls, qualifies the request and proposes appointment slots that you confirm before anything is booked.",
        fr: "Répond aux appels entrants, qualifie la demande et propose des créneaux de RDV que vous confirmez avant toute prise.",
      },
    },
    {
      name: { en: "Vaccine & follow-up reminders", fr: "Rappels vaccins & suivis" },
      description: {
        en: "Spots animals due for a vaccine or follow-up and drafts the reminder messages for you to review and send.",
        fr: "Repère les animaux dont le vaccin ou le suivi arrive à échéance et rédige les messages de rappel que vous relisez avant envoi.",
      },
    },
    {
      name: { en: "Reports & prescriptions", fr: "Comptes-rendus & ordonnances" },
      description: {
        en: "Drafts consultation reports and prescriptions from your notes, which you check and validate before they are finalised.",
        fr: "Rédige les comptes-rendus de consultation et les ordonnances à partir de vos notes, que vous vérifiez et validez avant finalisation.",
      },
    },
    {
      name: { en: "Drug stock & ordering", fr: "Stocks médicaments & commandes" },
      description: {
        en: "Tracks medication levels and prepares supplier orders that you approve before they are placed.",
        fr: "Suit les niveaux de médicaments et prépare les commandes fournisseurs que vous approuvez avant passation.",
      },
    },
  ],
  integrations: {
    title: { en: "Works with your existing tools", fr: "Compatible avec vos outils existants" },
    items: ["Vetocom", "Bourgelat", "Vetup", "DrVeto", "VetoPartner"],
  },
  stats: [
    { value: "25 000", label: { en: "veterinary clinics in France", fr: "cliniques vétérinaires en France" } },
    { value: "< 2 sem.", label: { en: "to go live", fr: "pour être opérationnel" } },
    {
      value: "~50%",
      label: { en: "of the market on Vetocom & Bourgelat", fr: "du marché sur Vetocom & Bourgelat" },
    },
  ],
  faq: [
    AUTONOMY_FAQ,
    INTEGRATIONS_FAQ,
    {
      question: { en: "Where does my clinic's data go?", fr: "Où vont les données de ma clinique ?" },
      answer: {
        en: "You stay in control of your data. HeyBap can be self-hosted for full data sovereignty, with role-based access so each member of the team sees only what they should.",
        fr: "Vous gardez la maîtrise de vos données. HeyBap peut être auto-hébergé pour une souveraineté totale, avec des accès par rôle pour que chaque membre de l'équipe ne voie que ce qui le concerne.",
      },
    },
  ],
};

const pharmacies: Vertical = {
  slug: "pharmacies",
  name: { en: "Pharmacies", fr: "Pharmacies" },
  emoji: "💊",
  seoTitle: {
    en: "AI Agent for Pharmacies · HeyBap",
    fr: "Agent IA pour pharmacies · HeyBap",
  },
  seoDescription: {
    en: "HeyBap gives pharmacy owners an AI agent that works across LGPI, Winpharma and your wholesalers. It handles stock-outs, prescription renewals and supplier messages, and you approve every action.",
    fr: "HeyBap donne au pharmacien titulaire un agent IA qui travaille avec LGPI, Winpharma et vos grossistes. Il gère les ruptures, les renouvellements d'ordonnances et les messages labos, et vous validez chaque action.",
  },
  hero: {
    eyebrow: { en: "For community pharmacies", fr: "Pour les officines" },
    title: {
      en: "The AI agent for pharmacies",
      fr: "L'agent IA pour les pharmacies",
    },
    subtitle: {
      en: "HeyBap puts an agent to work across your existing tools (LGPI, Winpharma, your wholesalers) to take the administrative load off your team. The agent proposes, you decide.",
      fr: "HeyBap met un agent au travail à travers vos outils existants (LGPI, Winpharma, vos grossistes) pour décharger votre équipe des tâches administratives. L'agent propose, vous décidez.",
    },
  },
  problem: {
    title: { en: "Too much time lost on the back office", fr: "Trop de temps perdu sur l'administratif" },
    body: {
      en: "Between chasing stock-outs, placing wholesaler orders, reminding patients about renewals and sorting through lab and supplier messages, your team spends hours away from the counter every week. These tasks are repetitive, scattered across several tools, and never stop piling up.",
      fr: "Entre la gestion des ruptures, les commandes grossistes, les rappels de renouvellement aux patients et le tri des messages labos et fournisseurs, votre équipe passe chaque semaine des heures loin du comptoir. Ces tâches sont répétitives, éclatées entre plusieurs logiciels, et ne cessent de s'accumuler.",
    },
  },
  agents: [
    {
      name: { en: "Stock-outs & wholesaler orders", fr: "Ruptures & commandes grossistes" },
      description: {
        en: "Tracks stock-outs across your stock and prepares the wholesaler orders to fill them, which you review and approve before anything is sent.",
        fr: "Suit les ruptures dans votre stock et prépare les commandes grossistes pour les combler, que vous relisez et validez avant tout envoi.",
      },
    },
    {
      name: { en: "Prescription renewals", fr: "Renouvellement d'ordonnances" },
      description: {
        en: "Spots patients due for a renewal and drafts the reminders to send them, which you check and approve before they go out.",
        fr: "Repère les patients dont l'ordonnance arrive à échéance et rédige les rappels à leur envoyer, que vous contrôlez et validez avant l'envoi.",
      },
    },
    {
      name: { en: "Lab & supplier triage", fr: "Tri des communications labos" },
      description: {
        en: "Sorts and summarizes incoming lab and supplier messages so you only read what matters, with the agent's suggested actions left for you to approve.",
        fr: "Trie et résume les messages entrants des labos et fournisseurs pour que vous ne lisiez que l'essentiel, les actions suggérées par l'agent restant à votre validation.",
      },
    },
  ],
  integrations: {
    title: { en: "Works with the tools you already use", fr: "Fonctionne avec les outils que vous utilisez déjà" },
    items: ["LGPI", "Winpharma", "Smart RX", "LEO", "Pharmaland"],
  },
  stats: [
    { value: "22 000", label: { en: "community pharmacies in France", fr: "officines en France" } },
    { value: "< 2 sem.", label: { en: "to go live", fr: "pour démarrer" } },
    { value: "76%", label: { en: "of the market on LGPI & Winpharma", fr: "du marché sur LGPI & Winpharma" } },
  ],
  faq: [
    AUTONOMY_FAQ,
    {
      question: {
        en: "What about patient-data confidentiality?",
        fr: "Qu'en est-il de la confidentialité des données patients ?",
      },
      answer: {
        en: "HeyBap can be self-hosted so your data stays under your roof, with role-based access controlling who sees what and an audit trail logging every action. Confidentiality stays in your hands.",
        fr: "HeyBap peut être auto-hébergé pour que vos données restent chez vous, avec des accès par rôle qui contrôlent qui voit quoi et un historique qui trace chaque action. La confidentialité reste entre vos mains.",
      },
    },
    INTEGRATIONS_FAQ,
  ],
};

const syndicsCopropriete: Vertical = {
  slug: "syndics-copropriete",
  name: { en: "Property Management (Syndics)", fr: "Syndics de copropriété" },
  emoji: "🏢",
  seoTitle: {
    en: "AI Agent for Property Management (Syndics) · HeyBap",
    fr: "Agent IA pour syndics de copropriété · HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for property-management firms (syndics): general-meeting prep, calls for funds and charge reminders, rent invoicing and tenant requests, across Gercop, Vilogi and your existing tools, with human approval on every action.",
    fr: "HeyBap déploie des agents IA pour les cabinets de syndic : préparation des AG, appels de fonds et relances de charges, quittancement et demandes locataires, à travers Gercop, Vilogi et vos outils existants, avec validation humaine sur chaque action.",
  },
  hero: {
    eyebrow: { en: "For property-management firms", fr: "Pour les cabinets de syndic" },
    title: {
      en: "The AI agent for property managers",
      fr: "L'agent IA pour les syndics de copropriété",
    },
    subtitle: {
      en: "From general-meeting prep to calls for funds and tenant requests, an agentic app for every administrative task that overloads your firm. The agent proposes, your managers decide, and approve every action.",
      fr: "De la préparation des AG aux appels de fonds et aux demandes locataires, une app agentique pour chaque tâche administrative qui surcharge votre cabinet. L'agent propose, vos gestionnaires décident, et valident chaque action.",
    },
  },
  problem: {
    title: { en: "Too many lots, too much admin", fr: "Trop de lots, trop d'administratif" },
    body: {
      en: "General meetings to prepare, calls for funds and charge reminders to send, rent invoicing to issue and a constant flow of tenant requests: your managers spend their days on repetitive paperwork instead of on the buildings and the co-owners. And it all lives in tools that barely talk to each other.",
      fr: "Des AG à préparer, des appels de fonds et des relances de charges à envoyer, du quittancement à émettre et un flux continu de demandes locataires : vos gestionnaires passent leurs journées sur de l'administratif répétitif au lieu des immeubles et des copropriétaires. Et tout cela vit dans des outils qui se parlent à peine.",
    },
  },
  agents: [
    {
      name: { en: "General-meeting prep", fr: "Préparation des AG" },
      description: {
        en: "Assembles the convocation, the agenda and the supporting documents for each general meeting from the building file, your manager reviews and approves before anything is sent to the co-owners.",
        fr: "Assemble la convocation, l'ordre du jour et les pièces jointes de chaque assemblée générale à partir du dossier de la copropriété, votre gestionnaire relit et valide avant tout envoi aux copropriétaires.",
      },
    },
    {
      name: { en: "Calls for funds & charge reminders", fr: "Appels de fonds & relances de charges" },
      description: {
        en: "Prepares the calls for funds and drafts the personalized charge reminders for unpaid balances, you review and approve each batch before it goes out.",
        fr: "Prépare les appels de fonds et rédige les relances de charges personnalisées pour les impayés, vous relisez et validez chaque lot avant l'envoi.",
      },
    },
    {
      name: { en: "Rent invoicing & reminders", fr: "Quittancement & relances loyers" },
      description: {
        en: "Issues the rent invoicing and drafts the reminders for late payments from each tenant's file, your team checks and validates before posting or sending.",
        fr: "Établit le quittancement et rédige les relances de loyers en retard à partir du dossier de chaque locataire, votre équipe contrôle et valide avant comptabilisation ou envoi.",
      },
    },
    {
      name: { en: "Tenant requests & maintenance", fr: "Demandes locataires & maintenance" },
      description: {
        en: "Sorts incoming tenant requests, drafts a reply for each and prepares the maintenance coordination with providers, you approve every message and work order before it is sent.",
        fr: "Trie les demandes locataires entrantes, rédige une réponse pour chacune et prépare la coordination de la maintenance avec les prestataires, vous validez chaque message et ordre de service avant l'envoi.",
      },
    },
  ],
  integrations: {
    title: { en: "Connected to your property-management tools", fr: "Connecté à vos outils de gestion" },
    items: ["Gercop", "ICS", "Vilogi", "Thetrawin", "Powimo", "Seiitra", "Even", "Gimini"],
  },
  stats: [
    {
      value: "12 000",
      label: { en: "property-management firms (syndics) in France", fr: "syndics de copropriété en France" },
    },
    { value: "< 2 sem.", label: { en: "from kickoff to agents live", fr: "du lancement aux agents en production" } },
  ],
  faq: [
    AUTONOMY_FAQ,
    INTEGRATIONS_FAQ,
    {
      question: {
        en: "What about co-owner and tenant data confidentiality?",
        fr: "Qu'en est-il de la confidentialité des données des copropriétaires et locataires ?",
      },
      answer: {
        en: "HeyBap can be self-hosted on your own servers, with role-based access so each person sees only what they should, and a full audit trail of every action taken.",
        fr: "HeyBap peut être auto-hébergé sur vos propres serveurs, avec des accès par rôle pour que chacun ne voie que ce qui le concerne, et une piste d'audit complète de chaque action.",
      },
    },
  ],
};

const artisansBatiment: Vertical = {
  slug: "artisans-batiment",
  name: { en: "Building Trades", fr: "Artisans du bâtiment" },
  emoji: "🛠️",
  seoTitle: {
    en: "AI Agent for Building Trades · HeyBap",
    fr: "Agent IA pour artisans du bâtiment · HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for building-trade businesses: priced quotes from a site visit, quote and unpaid-invoice follow-ups, job-site scheduling and site-visit reports, across Batappli, Obat and your existing tools, with human approval on every action.",
    fr: "HeyBap déploie des agents IA pour les artisans du bâtiment : devis chiffrés depuis un relevé, relance des devis et impayés, planning des chantiers et comptes-rendus de visite, à travers Batappli, Obat et vos outils existants, avec validation humaine sur chaque action.",
  },
  hero: {
    eyebrow: { en: "For building-trade businesses", fr: "Pour les artisans et TPE du bâtiment" },
    title: {
      en: "The AI agent for building trades",
      fr: "L'agent IA pour les artisans du bâtiment",
    },
    subtitle: {
      en: "From a site visit dictated on the road to the quote sent to your client, an agentic app for every task that keeps you off the tools. The agent prepares the work, you review and approve every action.",
      fr: "D'une visite dictée sur la route au devis envoyé à votre client, une app agentique pour chaque tâche qui vous tient loin du chantier. L'agent prépare le travail, vous relisez et validez chaque action.",
    },
  },
  problem: {
    title: { en: "The paperwork piles up after the job", fr: "La paperasse s'accumule après le chantier" },
    body: {
      en: "Drafting priced quotes, chasing the ones that go unanswered, juggling job-site scheduling and writing up each site visit eat your evenings and weekends. Every hour spent on this paperwork is an hour off the job or away from your family.",
      fr: "Rédiger les devis chiffrés, relancer ceux qui restent sans réponse, jongler avec le planning des chantiers et rédiger chaque compte-rendu de visite dévorent vos soirées et vos week-ends. Chaque heure passée sur cette paperasse est une heure de moins sur le chantier ou en famille.",
    },
  },
  agents: [
    {
      name: { en: "Quote from a site visit", fr: "Devis depuis un relevé" },
      description: {
        en: "Turns a dictated or measured site visit into a priced, itemized quote in your software, you review the lines and prices and validate before it goes to the client.",
        fr: "Transforme une visite dictée ou un relevé de mesures en devis chiffré et détaillé dans votre logiciel, vous relisez les lignes et les prix et validez avant l'envoi au client.",
      },
    },
    {
      name: { en: "Quote & unpaid follow-ups", fr: "Relance devis & impayés" },
      description: {
        en: "Tracks quotes left unanswered and invoices left unpaid, drafts the right follow-up for each one, you review and send in one click.",
        fr: "Suit les devis sans réponse et les factures impayées, rédige la relance adaptée à chacun, vous relisez et envoyez en un clic.",
      },
    },
    {
      name: { en: "Job-site & appointment scheduling", fr: "Planning chantiers & RDV" },
      description: {
        en: "Organizes your job sites and appointments, proposes the schedule and the client confirmations, you approve before anything is booked.",
        fr: "Organise vos chantiers et rendez-vous, propose le planning et les confirmations client, vous validez avant toute prise de RDV.",
      },
    },
    {
      name: { en: "Site-visit report", fr: "Compte-rendu de visite" },
      description: {
        en: "Writes up a clean site-visit report from your dictation, ready for you to check and approve before it is filed or sent.",
        fr: "Rédige un compte-rendu de visite propre à partir de votre dictée, prêt à être vérifié et validé avant classement ou envoi.",
      },
    },
  ],
  integrations: {
    title: { en: "Works with your trade software", fr: "Compatible avec vos logiciels métier" },
    items: ["Batappli", "Obat", "EBP Bâtiment", "Sage Batigest", "Codial", "Tolteck", "Extrabat"],
  },
  stats: [
    {
      value: "600 000",
      label: { en: "craftsmen & small businesses in France", fr: "artisans & TPE du bâtiment en France" },
    },
    { value: "< 2 sem.", label: { en: "to go live", fr: "pour être opérationnel" } },
    { value: "100 %", label: { en: "of actions reviewed by you", fr: "des actions validées par vous" } },
  ],
  faq: [
    AUTONOMY_FAQ,
    INTEGRATIONS_FAQ,
    {
      question: { en: "Where does my data go?", fr: "Où vont mes données ?" },
      answer: {
        en: "You stay in control of your data. HeyBap can be self-hosted for full data sovereignty, with role-based access so each person sees only what they should.",
        fr: "Vous gardez la maîtrise de vos données. HeyBap peut être auto-hébergé pour une souveraineté totale, avec des accès par rôle pour que chacun ne voie que ce qui le concerne.",
      },
    },
  ],
};

const hotellerie: Vertical = {
  slug: "hotellerie",
  name: { en: "Independent Hotels", fr: "Hôtellerie indépendante" },
  emoji: "🏨",
  seoTitle: {
    en: "AI Agent for Independent Hotels · HeyBap",
    fr: "Agent IA pour l'hôtellerie indépendante · HeyBap",
  },
  seoDescription: {
    en: "An AI agent that works across your PMS and booking channels to handle direct bookings, rate sync and guest follow-ups. It proposes, you approve every action.",
    fr: "Un agent IA qui travaille à travers votre PMS et vos canaux de réservation pour gérer les réservations directes, la synchro tarifaire et les relances client. Il propose, vous validez chaque action.",
  },
  hero: {
    eyebrow: {
      en: "For independent hotel owners & managers",
      fr: "Pour propriétaires et directeurs d'hôtel indépendant",
    },
    title: {
      en: "The AI agent for independent hotels",
      fr: "L'agent IA pour l'hôtellerie indépendante",
    },
    subtitle: {
      en: "HeyBap connects to your PMS and booking channels to handle direct bookings, rate synchronisation and guest follow-ups. The agent prepares every action, you review and approve it in one click.",
      fr: "HeyBap se connecte à votre PMS et à vos canaux de réservation pour gérer les réservations directes, la synchronisation tarifaire et les relances client. L'agent prépare chaque action, vous la validez en un clic.",
    },
  },
  problem: {
    title: {
      en: "Running a hotel front desk shouldn't mean re-typing the same data everywhere",
      fr: "Gérer la réception ne devrait pas vous obliger à ressaisir les mêmes données partout",
    },
    body: {
      en: "Between direct bookings, syncing rates and availability across every portal, review follow-ups and pre-arrival emails, the admin work piles up and no-shows cost you. HeyBap takes on this repetitive work across your existing tools, while you keep the final say on every action.",
      fr: "Entre les réservations directes, la synchro des tarifs et disponibilités sur chaque portail, les relances avis et les emails de pré-arrivée, l'administratif s'accumule et les no-shows vous coûtent cher. HeyBap prend en charge ce travail répétitif à travers vos outils existants, pendant que vous gardez le dernier mot sur chaque action.",
    },
  },
  agents: [
    {
      name: { en: "Direct bookings & messaging", fr: "Réservations directes & messagerie" },
      description: {
        en: "Captures direct booking requests and drafts guest replies across your channels, ready for you to review and send.",
        fr: "Capte les demandes de réservation directe et rédige les réponses client sur vos canaux, prêtes à être relues et envoyées par vous.",
      },
    },
    {
      name: { en: "Rate & availability sync", fr: "Synchro tarifs & disponibilités" },
      description: {
        en: "Prepares rate and availability updates across your booking portals, which you approve before they go live.",
        fr: "Prépare les mises à jour de tarifs et de disponibilités sur vos portails de réservation, que vous validez avant publication.",
      },
    },
    {
      name: { en: "Review & loyalty follow-ups", fr: "Relances avis & fidélisation" },
      description: {
        en: "Drafts personalised review requests and loyalty messages after each stay, sent only once you approve them.",
        fr: "Rédige des demandes d'avis et des messages de fidélisation personnalisés après chaque séjour, envoyés seulement après votre validation.",
      },
    },
    {
      name: { en: "Pre-arrival & anti no-show", fr: "Pré-arrivée & anti no-show" },
      description: {
        en: "Prepares pre-arrival emails and confirmation reminders to cut no-shows, with every message left for you to approve.",
        fr: "Prépare les emails de pré-arrivée et les rappels de confirmation pour réduire les no-shows, chaque message restant soumis à votre validation.",
      },
    },
  ],
  integrations: {
    title: { en: "Works with the tools you already use", fr: "Compatible avec les outils que vous utilisez déjà" },
    items: ["Mews", "Medialog", "Reservit", "D-EDGE", "Septeo Hospitality"],
  },
  stats: [
    { value: "18 000", label: { en: "independent hotels in France", fr: "hôtels indépendants en France" } },
    { value: "< 2 sem.", label: { en: "to go live", fr: "pour être opérationnel" } },
  ],
  faq: [
    AUTONOMY_FAQ,
    INTEGRATIONS_FAQ,
    {
      question: { en: "Where does my guest data live?", fr: "Où sont stockées les données de mes clients ?" },
      answer: {
        en: "Your data stays yours. HeyBap can be self-hosted for full data sovereignty, with role-based access so each team member only sees what they should.",
        fr: "Vos données restent les vôtres. HeyBap peut être auto-hébergé pour une pleine souveraineté des données, avec des accès par rôle pour que chaque membre de l'équipe ne voie que ce qui le concerne.",
      },
    },
  ],
};

export const VERTICALS: Vertical[] = [
  notaires,
  servicesALaPersonne,
  courtiersAssurance,
  expertsComptables,
  pharmacies,
  ehpad,
  syndicsCopropriete,
  hotellerie,
  artisansBatiment,
  veterinaires,
];

export function getVertical(slug: string): Vertical | undefined {
  return VERTICALS.find((v) => v.slug === slug);
}
