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
 * Content is grounded in the GTM / ICP Notion notes (verticals, métier tools, pain points,
 * personas). Copy is a reviewable first draft — figures are factual market context, not invented
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
  /** Indicative / factual context figures. */
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
    fr: "Agent IA pour notaires — HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for notarial offices: normalized deed summaries, accounting-document filing, reconciliation and email drafting — across Genapi/iNot and your existing tools, with human approval on every action.",
    fr: "HeyBap déploie des agents IA pour les études notariales : résumés normalisés des actes, classement des pièces comptables, pointage et rédaction d'e-mails — à travers Genapi/iNot et vos outils existants, avec validation humaine sur chaque action.",
  },
  hero: {
    eyebrow: { en: "For notarial offices", fr: "Pour les études notariales" },
    title: { en: "The AI agent for notaries", fr: "L'agent IA pour les notaires" },
    subtitle: {
      en: "For every document-heavy task of the office, an agent works across your tools and prepares the output — your clerks review, edit and approve. The agent proposes, you decide.",
      fr: "Pour chaque tâche documentaire de l'étude, un agent travaille à travers vos outils et prépare le résultat — vos clercs relisent, corrigent et valident. L'agent propose, vous décidez.",
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
        en: "Reads each deed and produces a standardized summary highlighting key clauses and parties — the clerk reviews and validates it before it goes in the file.",
        fr: "Lit chaque acte et produit un résumé standardisé mettant en avant les clauses clés et les parties — le clerc le relit et le valide avant versement au dossier.",
      },
    },
    {
      name: { en: "Accounting-document filing", fr: "Classement des pièces comptables" },
      description: {
        en: "Classifies incoming accounting documents and files them in the right place in your software — you approve the classification in one click.",
        fr: "Classe les pièces comptables entrantes et les range au bon endroit dans votre logiciel — vous validez le classement en un clic.",
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
        en: "Drafts clear, on-tone replies to client and counterparty e-mails from the file context — you edit and send in one click.",
        fr: "Rédige des réponses claires et au bon ton aux e-mails des clients et confrères à partir du contexte du dossier — vous éditez et envoyez en un clic.",
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
    {
      question: { en: "Does the agent act on its own?", fr: "L'agent agit-il de lui-même ?" },
      answer: {
        en: "No. Nothing is sent, filed or registered on its own — the agent proposes, and a clerk reviews, edits and approves every action, with a full audit trail.",
        fr: "Non. Rien n'est envoyé, classé ni enregistré de façon autonome — l'agent propose, et un clerc relit, corrige et valide chaque action, avec une piste d'audit complète.",
      },
    },
    {
      question: {
        en: "Is it compatible with notarial secrecy and our data?",
        fr: "Est-ce compatible avec le secret notarial et nos données ?",
      },
      answer: {
        en: "Yes. HeyBap can be self-hosted on your own servers, with role-based access and a full audit trail — built to respect notarial confidentiality.",
        fr: "Oui. HeyBap peut être auto-hébergé sur vos propres serveurs, avec accès par rôle et piste d'audit complète — pensé pour respecter le secret notarial.",
      },
    },
    {
      question: {
        en: "Does it work with Genapi / iNot?",
        fr: "Est-ce que ça fonctionne avec Genapi / iNot ?",
      },
      answer: {
        en: "Yes. The agents work across your existing stack — Genapi (iNot), Fichorga, Fiducial and the administrations you already use — with no rip-and-replace.",
        fr: "Oui. Les agents travaillent à travers votre stack existant — Genapi (iNot), Fichorga, Fiducial et les administrations que vous utilisez déjà — sans tout remplacer.",
      },
    },
  ],
};

const servicesALaPersonne: Vertical = {
  slug: "services-a-la-personne",
  name: { en: "Home-care & personal services", fr: "Services à la personne" },
  emoji: "🏠",
  seoTitle: {
    en: "AI Agent for Home-Care Providers — HeyBap",
    fr: "Agent IA pour les services à la personne — HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for home-care providers: scheduling and replacements, family follow-ups, URSSAF/CAF contracts and clocking reconciliation — across Ogust and your existing tools, with human approval on every action.",
    fr: "HeyBap déploie des agents IA pour les structures de services à la personne : planning et remplacements, suivi des familles, contrats URSSAF/CAF et rapprochement de la télégestion — à travers Ogust et vos outils existants, avec validation humaine sur chaque action.",
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
      en: "From the schedule to the call to the family, an agentic app for every administrative task that eats your days. The agent proposes, your coordinators decide — and approve every action.",
      fr: "Du planning à l'appel aux familles, une app agentique pour chaque tâche administrative qui dévore vos journées. L'agent propose, vos coordinateurs décident — et valident chaque action.",
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
        en: "When a caregiver cancels, it finds the available replacements, proposes the best fit and drafts the reshuffled schedule — your coordinator validates before anything moves.",
        fr: "Quand un intervenant se décommande, il identifie les remplaçants disponibles, propose le meilleur profil et prépare le planning réajusté — votre coordinateur valide avant tout changement.",
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
        en: "It assembles the contract and compliance paperwork from the client file and flags what's missing — you review and approve before any document goes out.",
        fr: "Il assemble les contrats et les pièces de conformité à partir du dossier client et signale ce qui manque — vous relisez et validez avant tout envoi.",
      },
    },
    {
      name: { en: "Clocking reconciliation", fr: "Télégestion & pointage" },
      description: {
        en: "It cross-checks remote clocking against the planned schedule, flags the gaps to correct, and prepares the reconciliation — your office approves each adjustment.",
        fr: "Il rapproche les pointages de la télégestion avec le planning prévu, signale les écarts à corriger et prépare le rapprochement — votre bureau valide chaque ajustement.",
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
    {
      question: { en: "Does the agent act on its own?", fr: "L'agent agit-il de lui-même ?" },
      answer: {
        en: "No. Nothing is sent, scheduled or changed on its own — the agent proposes, and a human reviews, edits and approves every action, with a full audit trail.",
        fr: "Non. Rien n'est envoyé, planifié ni modifié de façon autonome — l'agent propose, et un humain relit, modifie et valide chaque action, avec une piste d'audit complète.",
      },
    },
    {
      question: { en: "How does it connect to Ogust?", fr: "Comment se connecte-t-il à Ogust ?" },
      answer: {
        en: "Ogust exposes an open API and a Zapier connection, so HeyBap plugs in directly — no IT project on your side. Apologic, Ximi and Domatel can be connected the same way.",
        fr: "Ogust expose une API ouverte et une connexion Zapier : HeyBap s'y branche directement, sans projet informatique de votre côté. Apologic, Ximi et Domatel se connectent de la même façon.",
      },
    },
    {
      question: {
        en: "What if my software has no open API?",
        fr: "Et si mon logiciel n'a pas d'API ouverte ?",
      },
      answer: {
        en: "The agent can start at the edges of your stack — via email, WhatsApp or voice — to handle family follow-ups and replacements before any deep integration, then connect to your software once it's ready.",
        fr: "L'agent peut démarrer en périphérie de vos outils — par email, WhatsApp ou téléphone — pour gérer le suivi des familles et les remplacements avant toute intégration profonde, puis se connecter à votre logiciel une fois prêt.",
      },
    },
  ],
};

const courtiersAssurance: Vertical = {
  slug: "courtiers-assurance",
  name: { en: "Insurance Brokers", fr: "Courtiers en assurance" },
  emoji: "🛡️",
  seoTitle: {
    en: "AI Agent for Insurance Brokers — HeyBap",
    fr: "Agent IA pour courtiers en assurance — HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for insurance brokerage firms: claims intake, quote prep and follow-ups, document tracking and ACPR compliance — across your existing tools, with human approval on every step.",
    fr: "HeyBap déploie des agents IA pour les cabinets de courtage en assurance : création de sinistres, préparation des devis et relances, suivi des pièces et conformité ACPR — à travers vos outils existants, avec validation humaine à chaque étape.",
  },
  hero: {
    eyebrow: { en: "For insurance brokerage firms", fr: "Pour les cabinets de courtage" },
    title: {
      en: "The AI agent for insurance brokers",
      fr: "L'agent IA pour les courtiers en assurance",
    },
    subtitle: {
      en: "From a claim reported on WhatsApp to the quote sent to your client, an agentic app for every step of your firm's workflow. The agent proposes, you decide — and approve every action.",
      fr: "D'un sinistre déclaré sur WhatsApp au devis envoyé à votre client, une app agentique pour chaque étape du flux de votre cabinet. L'agent propose, vous décidez — et validez chaque action.",
    },
  },
  problem: {
    title: { en: "The cost of a fragmented firm", fr: "Le coût d'un cabinet fragmenté" },
    body: {
      en: "Your CRM, contracts, document management, insurer extranets and claims handling all live in separate tools that don't talk to each other. Your team loses hours re-keying the same data and chasing documents — time that should go to your clients and to staying ACPR-compliant.",
      fr: "Votre CRM, les contrats, la GED, les extranets assureurs et la gestion des sinistres vivent dans des outils séparés qui ne se parlent pas. Votre équipe perd des heures à ressaisir les mêmes données et à relancer les pièces — du temps qui devrait aller à vos clients et au respect de la conformité ACPR.",
    },
  },
  agents: [
    {
      name: { en: "Claims intake & creation", fr: "Création de sinistres" },
      description: {
        en: "Collects a claim reported by WhatsApp or email, builds the document checklist and drafts the claim in your software — you review and validate the creation.",
        fr: "Recueille un sinistre déclaré par WhatsApp ou email, établit la liste des pièces à fournir et prépare la création du sinistre dans votre logiciel — vous relisez et validez la création.",
      },
    },
    {
      name: { en: "Quote prep & follow-ups", fr: "Préparation des devis & relances" },
      description: {
        en: "Assembles the data for a quote and drafts the client follow-ups — you review, adjust and send in one click.",
        fr: "Rassemble les données d'un devis et rédige les relances client — vous relisez, ajustez et envoyez en un clic.",
      },
    },
    {
      name: { en: "Document & ACPR tracking", fr: "Suivi des pièces & conformité ACPR" },
      description: {
        en: "Tracks which documents are still missing across each file and flags compliance gaps for ACPR — you approve every reminder before it goes out.",
        fr: "Suit les pièces encore manquantes dossier par dossier et signale les manques de conformité ACPR — vous validez chaque relance avant l'envoi.",
      },
    },
    {
      name: { en: "Client request triage", fr: "Tri & réponse aux demandes clients" },
      description: {
        en: "Sorts incoming client requests by priority and drafts a reply for each one — you review and approve before anything is sent.",
        fr: "Trie les demandes clients entrantes par priorité et rédige une réponse pour chacune — vous relisez et validez avant tout envoi.",
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
    {
      question: { en: "Does the agent act on its own?", fr: "L'agent agit-il de lui-même ?" },
      answer: {
        en: "No. The agent proposes, you decide — nothing is created or sent on its own. A human reviews, edits and approves every action, with a full audit trail.",
        fr: "Non. L'agent propose, vous décidez — rien n'est créé ni envoyé de façon autonome. Un humain relit, modifie et valide chaque action, avec une piste d'audit complète.",
      },
    },
    {
      question: {
        en: "Does it connect to my brokerage software?",
        fr: "Se connecte-t-il à mon logiciel de courtage ?",
      },
      answer: {
        en: "Yes. CourtiGo offers the best integration surface of the whole sector — a REST API and a native MCP server — so an agent can be connected in a matter of days. Antenia's open, secured APIs and EDI Courtage NEO are supported too.",
        fr: "Oui. CourtiGo offre la meilleure surface d'intégration du secteur — une API REST et un serveur MCP natif — ce qui permet de connecter un agent en quelques jours. Les API ouvertes et sécurisées d'Antenia et EDI Courtage NEO sont également prises en charge.",
      },
    },
    {
      question: {
        en: "Is it compliant for a regulated activity?",
        fr: "Est-ce conforme pour une activité réglementée ?",
      },
      answer: {
        en: "HeyBap can be self-hosted on your own servers, with role-based access and a full audit trail of every action — built for an ACPR-regulated activity. You can bring your own LLM or use ours.",
        fr: "HeyBap peut être auto-hébergé sur vos propres serveurs, avec accès par rôle et une piste d'audit complète de chaque action — pensé pour une activité réglementée par l'ACPR. Vous pouvez utiliser votre propre LLM ou le nôtre.",
      },
    },
  ],
};

const expertsComptables: Vertical = {
  slug: "experts-comptables",
  name: { en: "Accounting Firms", fr: "Experts-comptables" },
  emoji: "🧮",
  seoTitle: {
    en: "AI Agent for Accounting Firms — HeyBap",
    fr: "Agent IA pour experts-comptables — HeyBap",
  },
  seoDescription: {
    en: "HeyBap deploys AI agents for accounting firms: document collection and chasing, data pre-entry, bank reconciliation and client replies — across Sage, Cegid and Pennylane, with human approval on every step.",
    fr: "HeyBap déploie des agents IA pour les cabinets d'expertise comptable : collecte et relance des pièces, pré-saisie, rapprochement bancaire et réponses clients — à travers Sage, Cegid et Pennylane, avec validation humaine à chaque étape.",
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
        en: "Tracks which documents each client still owes and drafts the personalized follow-up — you review and send in one click.",
        fr: "Suit les pièces que chaque client doit encore fournir et rédige la relance personnalisée — vous relisez et envoyez en un clic.",
      },
    },
    {
      name: { en: "Data pre-entry & bank reconciliation", fr: "Pré-saisie & rapprochement bancaire" },
      description: {
        en: "Reads the invoices and bank statements, proposes the accounting entries and matches transactions — your collaborator checks and validates before posting.",
        fr: "Lit les factures et relevés bancaires, propose les écritures comptables et rapproche les opérations — votre collaborateur contrôle et valide avant comptabilisation.",
      },
    },
    {
      name: { en: "Client question replies", fr: "Réponses aux questions clients" },
      description: {
        en: "Drafts answers to recurring client questions from the file data — you review, adjust and send.",
        fr: "Rédige les réponses aux questions clients récurrentes à partir des données du dossier — vous relisez, ajustez et envoyez.",
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
    {
      question: { en: "Does the agent act on its own?", fr: "L'agent agit-il de lui-même ?" },
      answer: {
        en: "No. Nothing is posted, sent or changed on its own — the agent proposes, and a human reviews, edits and approves every action, with a full audit trail.",
        fr: "Non. Rien n'est comptabilisé, envoyé ni modifié de façon autonome — l'agent propose, et un humain relit, modifie et valide chaque action, avec une piste d'audit complète.",
      },
    },
    {
      question: {
        en: "Does it work with Sage, Cegid or Pennylane?",
        fr: "Est-ce compatible avec Sage, Cegid ou Pennylane ?",
      },
      answer: {
        en: "Yes. The agent works across your existing production tools — Sage Coala, Cegid Expert, ACD, Agiris, RCA, Pennylane — via their APIs and EDI, with no change to your software.",
        fr: "Oui. L'agent travaille à travers vos outils de production existants — Sage Coala, Cegid Expert, ACD, Agiris, RCA, Pennylane — via leurs API et l'EDI, sans changer de logiciel.",
      },
    },
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
    en: "AI Agent for Nursing Homes (EHPAD) — HeyBap",
    fr: "Agent IA pour les EHPAD — HeyBap",
  },
  seoDescription: {
    en: "An AI agent that works across your NetSoins and existing tools to handle admissions, family communication and resident paperwork. It proposes, your team decides. Live in under 2 weeks.",
    fr: "Un agent IA qui travaille à travers NetSoins et vos outils existants pour gérer les admissions, la communication aux familles et le suivi administratif des résidents. Il propose, votre équipe décide. En production en moins de 2 semaines.",
  },
  hero: {
    eyebrow: { en: "For nursing home directors", fr: "Pour les directeurs d'établissement" },
    title: {
      en: "Give your teams back the time they spend on paperwork",
      fr: "Rendez à vos équipes le temps perdu en administratif",
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
    {
      question: { en: "Does the agent act on its own?", fr: "L'agent agit-il tout seul ?" },
      answer: {
        en: "No. The agent proposes, your team decides. Every reply, message and file is drafted for a human to review, edit and approve before anything happens. Nothing is sent or acted on without a caregiver's validation.",
        fr: "Non. L'agent propose, votre équipe décide. Chaque réponse, message et dossier est préparé pour qu'un humain le relise, le modifie et le valide avant toute action. Rien n'est envoyé ni exécuté sans la validation d'un soignant.",
      },
    },
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
    {
      question: {
        en: "Does it integrate with NetSoins and Ségur?",
        fr: "S'intègre-t-il à NetSoins et au Ségur ?",
      },
      answer: {
        en: "Yes. The agent works across your existing tools, including NetSoins (Orisha Socialcare) and its Ségur interoperability, rather than asking you to change software.",
        fr: "Oui. L'agent travaille à travers vos outils existants, dont NetSoins (Orisha Socialcare) et son interopérabilité Ségur, sans vous demander de changer de logiciel.",
      },
    },
  ],
};

const veterinaires: Vertical = {
  slug: "veterinaires",
  name: { en: "Veterinary Clinics", fr: "Vétérinaires" },
  emoji: "🐾",
  seoTitle: {
    en: "AI Agent for Veterinary Clinics — HeyBap",
    fr: "Agent IA pour vétérinaires — HeyBap",
  },
  seoDescription: {
    en: "An AI agent that handles your clinic's phone calls, appointments, vaccine reminders and reports across your existing tools. The agent proposes, you approve every action.",
    fr: "Un agent IA qui gère le standard, les RDV, les rappels vaccins et les comptes-rendus de votre clinique, à travers vos outils existants. L'agent propose, vous validez chaque action.",
  },
  hero: {
    eyebrow: { en: "For veterinary clinics", fr: "Pour les cliniques vétérinaires" },
    title: {
      en: "Your clinic's admin, handled. You stay in control.",
      fr: "L'administratif de votre clinique, géré. Vous gardez la main.",
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
    {
      question: { en: "Does the agent act on its own?", fr: "L'agent agit-il tout seul ?" },
      answer: {
        en: "No. The agent proposes every action — a reply, an appointment, a report, an order — and you decide. Nothing is sent or finalised without your approval, and every step is logged in a full audit trail.",
        fr: "Non. L'agent propose chaque action — une réponse, un RDV, un compte-rendu, une commande — et vous décidez. Rien n'est envoyé ni finalisé sans votre validation, et chaque étape est tracée dans un historique complet.",
      },
    },
    {
      question: {
        en: "Does it need deep access to my practice software?",
        fr: "A-t-il besoin d'un accès profond à mon logiciel métier ?",
      },
      answer: {
        en: "No. The agent works at the surface — phone, email, messages — and does not need write access to your animal records or regulated drug stock. It fits alongside Vetocom, Bourgelat or your current software without touching the sensitive data inside.",
        fr: "Non. L'agent travaille en surface — téléphone, e-mail, messages — et n'a pas besoin d'un accès en écriture à vos fiches animaux ou à votre stock de médicaments réglementés. Il s'intègre à côté de Vetocom, Bourgelat ou de votre logiciel actuel sans toucher aux données sensibles.",
      },
    },
    {
      question: { en: "Where does my clinic's data go?", fr: "Où vont les données de ma clinique ?" },
      answer: {
        en: "You stay in control of your data. HeyBap can be self-hosted for full data sovereignty, with role-based access so each member of the team sees only what they should.",
        fr: "Vous gardez la maîtrise de vos données. HeyBap peut être auto-hébergé pour une souveraineté totale, avec des accès par rôle pour que chaque membre de l'équipe ne voie que ce qui le concerne.",
      },
    },
  ],
};

export const VERTICALS: Vertical[] = [
  notaires,
  servicesALaPersonne,
  courtiersAssurance,
  expertsComptables,
  ehpad,
  veterinaires,
];

export function getVertical(slug: string): Vertical | undefined {
  return VERTICALS.find((v) => v.slug === slug);
}
