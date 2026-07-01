import { loc, type Localized } from "./use-cases-data";

/**
 * Per-agent bespoke specs (triggers / actions / outputs / tools), grounded in the real workflows
 * of each métier. Keyed by vertical slug, in the SAME ORDER as that vertical's `agents` array in
 * `use-cases-data.ts`. Consumed by the agent modal, where every field is presented as
 * customizable (add / edit / remove) to convey that each agent is tailor-made.
 *
 * `isPage: true` marks an output that is a document/page a human opens, the modal renders a small
 * framed preview for those.
 */
export interface AgentOutput {
  label: Localized;
  isPage: boolean;
}

export interface AgentSpec {
  triggers: Localized[];
  actions: Localized[];
  outputs: AgentOutput[];
  tools: string[];
}

export const AGENT_SPECS: Record<string, AgentSpec[]> = {
  notaires: [
    {
      triggers: [
        { en: "New draft deed added to the file", fr: "Projet d'acte déposé au dossier" },
        { en: "Before a signing appointment", fr: "Avant le rendez-vous de signature" },
        { en: "On demand from the clerk", fr: "À la demande du clerc" },
      ],
      actions: [
        { en: "Read the deed and identify its nature", fr: "Lit l'acte et identifie sa nature" },
        {
          en: "Extract parties, civil status and property designation",
          fr: "Extrait parties, état civil et désignation du bien",
        },
        { en: "Pull price, charges and essential clauses", fr: "Relève prix, charges et clauses essentielles" },
        { en: "Cross-check parties against the iNot file", fr: "Recoupe les parties avec le dossier iNot" },
        {
          en: "Flag missing mentions or inconsistent figures",
          fr: "Signale mentions manquantes ou montants incohérents",
        },
        {
          en: "Draft a standardized summary sheet for validation",
          fr: "Rédige une fiche de synthèse normalisée à valider",
        },
      ],
      outputs: [
        { label: { en: "Standardized deed summary sheet", fr: "Fiche de synthèse normalisée de l'acte" }, isPage: true },
        { label: { en: "List of points to check", fr: "Liste des points à vérifier" }, isPage: true },
      ],
      tools: ["Genapi (iNot)", "Fichorga"],
    },
    {
      triggers: [
        { en: "Invoice or statement arrives in the inbox", fr: "Facture ou relevé reçu dans la boîte" },
        { en: "Daily sweep of pending documents", fr: "Balayage quotidien des pièces en attente" },
        { en: "Bank transfer notification received", fr: "Notification de virement reçue" },
      ],
      actions: [
        { en: "Read the document and detect its type", fr: "Lit la pièce et détecte son type" },
        { en: "Extract amount, date and supplier reference", fr: "Extrait montant, date et référence fournisseur" },
        { en: "Match the document to the right file", fr: "Rapproche la pièce du bon dossier" },
        { en: "Classify into the office accounting category", fr: "Classe dans la rubrique comptable de l'étude" },
        { en: "Flag duplicates or unmatched documents", fr: "Signale doublons ou pièces non rapprochées" },
        {
          en: "Prepare the filing for the accountant to confirm",
          fr: "Prépare le classement à confirmer par le comptable",
        },
      ],
      outputs: [
        { label: { en: "Filed document in the right place", fr: "Pièce classée au bon endroit" }, isPage: false },
        { label: { en: "Unmatched documents report", fr: "Rapport des pièces non rapprochées" }, isPage: true },
      ],
      tools: ["Fiducial", "Genapi (iNot)"],
    },
    {
      triggers: [
        { en: "Daily reconciliation at start of day", fr: "Pointage quotidien en début de journée" },
        { en: "Signature or formality status changes", fr: "Statut de signature ou formalité modifié" },
        { en: "Before closing a file", fr: "Avant la clôture d'un dossier" },
      ],
      actions: [
        {
          en: "Read the signature status of each Yousign request",
          fr: "Lit le statut de signature de chaque demande Yousign",
        },
        { en: "Check civil-status returns on Comedec", fr: "Vérifie les retours d'état civil sur Comedec" },
        { en: "Check company extracts and filings on Infogreffe", fr: "Contrôle extraits et dépôts sur Infogreffe" },
        {
          en: "Cross-check each item against the file checklist",
          fr: "Recoupe chaque élément avec la checklist du dossier",
        },
        {
          en: "Flag pending signatures and missing formalities",
          fr: "Signale signatures en attente et formalités manquantes",
        },
        { en: "Prepare reminders to relaunch the right contacts", fr: "Prépare les relances vers les bons interlocuteurs" },
      ],
      outputs: [
        { label: { en: "Reconciliation dashboard by file", fr: "Tableau de pointage par dossier" }, isPage: true },
        { label: { en: "Missing items to chase", fr: "Liste des éléments à relancer" }, isPage: true },
        { label: { en: "Draft reminders ready to send", fr: "Relances prêtes à envoyer" }, isPage: false },
      ],
      tools: ["Yousign", "Infogreffe", "Comedec", "Genapi (iNot)"],
    },
    {
      triggers: [
        { en: "Client or counterparty email arrives", fr: "E-mail client ou confrère reçu" },
        { en: "Reply requested by the clerk", fr: "Réponse demandée par le clerc" },
        { en: "Status update to communicate", fr: "Point d'avancement à communiquer" },
      ],
      actions: [
        { en: "Read the incoming email and identify the request", fr: "Lit l'e-mail reçu et identifie la demande" },
        { en: "Link the message to the right file", fr: "Rattache le message au bon dossier" },
        { en: "Pull the file context and current status", fr: "Récupère le contexte et l'état du dossier" },
        {
          en: "Check which documents or signatures are awaited",
          fr: "Vérifie quelles pièces ou signatures sont attendues",
        },
        {
          en: "Draft a clear, courteous reply in the office tone",
          fr: "Rédige une réponse claire et courtoise au ton de l'étude",
        },
        { en: "Flag sensitive points for the clerk to review", fr: "Signale les points sensibles à relire par le clerc" },
      ],
      outputs: [
        { label: { en: "Draft reply awaiting validation", fr: "Projet de réponse à valider" }, isPage: false },
        { label: { en: "File context note for the reply", fr: "Note de contexte du dossier" }, isPage: true },
      ],
      tools: ["Genapi (iNot)", "Yousign"],
    },
  ],

  "services-a-la-personne": [
    {
      triggers: [
        { en: "A caregiver cancels a planned shift", fr: "Une intervenante annule une vacation" },
        { en: "Sick leave reported in the morning", fr: "Arrêt maladie signalé le matin" },
        { en: "On demand from the coordinator", fr: "À la demande de la coordinatrice" },
      ],
      actions: [
        { en: "Read affected visits and client constraints", fr: "Lit les interventions touchées et contraintes bénéficiaires" },
        {
          en: "Match available caregivers by sector and skills",
          fr: "Croise les intervenantes disponibles par secteur et compétences",
        },
        { en: "Check working hours and statutory rest", fr: "Vérifie l'amplitude horaire et les repos légaux" },
        { en: "Cross-check care-plan hours (APA-PCH)", fr: "Recoupe les heures du plan d'aide (APA-PCH)" },
        { en: "Draft the reshuffled schedule for approval", fr: "Prépare le planning réajusté pour validation" },
        { en: "Flag uncovered visits and conflicts", fr: "Signale interventions non couvertes et conflits" },
      ],
      outputs: [
        { label: { en: "Reshuffled schedule sheet", fr: "Feuille de planning réajusté" }, isPage: true },
        { label: { en: "Draft message to the caregiver", fr: "Message préparé à l'intervenante" }, isPage: false },
        { label: { en: "Uncovered visits alert", fr: "Alerte interventions non couvertes" }, isPage: false },
      ],
      tools: ["Ximi", "Ogust", "Apologic"],
    },
    {
      triggers: [
        { en: "Weekly family follow-up due", fr: "Point hebdomadaire aux familles à faire" },
        { en: "Incident logged on a visit", fr: "Incident consigné sur une intervention" },
        { en: "On demand before a family call", fr: "À la demande avant un appel famille" },
      ],
      actions: [
        { en: "Read recent visit logs and transmissions", fr: "Lit les transmissions et comptes-rendus récents" },
        { en: "Identify families owed an update", fr: "Repère les familles à recontacter" },
        { en: "Cross-check the care plan and recent changes", fr: "Recoupe le plan d'aide et les changements récents" },
        { en: "Draft a tailored update per family", fr: "Rédige un point personnalisé par famille" },
        { en: "Prepare call notes and talking points", fr: "Prépare notes d'appel et points clés" },
        { en: "Flag situations needing the coordinator", fr: "Signale les situations nécessitant la coordinatrice" },
      ],
      outputs: [
        { label: { en: "Family follow-up brief", fr: "Brief de suivi familles" }, isPage: true },
        { label: { en: "Draft message to the family", fr: "Message préparé à la famille" }, isPage: false },
        { label: { en: "Escalation flag for the coordinator", fr: "Alerte à remonter à la coordinatrice" }, isPage: false },
      ],
      tools: ["Ximi", "Ogust"],
    },
    {
      triggers: [
        { en: "New client file opened", fr: "Nouveau dossier bénéficiaire ouvert" },
        { en: "Care-plan renewal received", fr: "Renouvellement de plan d'aide reçu" },
        { en: "On demand for a compliance check", fr: "À la demande pour un contrôle conformité" },
      ],
      actions: [
        { en: "Read the client file and funding details", fr: "Lit le dossier bénéficiaire et les financements" },
        { en: "Assemble the service contract from the file", fr: "Assemble le contrat de prestation depuis le dossier" },
        { en: "Cross-check URSSAF and CAF declarations", fr: "Recoupe les déclarations URSSAF et CAF" },
        { en: "Verify mandatory documents and signatures", fr: "Vérifie les pièces obligatoires et signatures" },
        { en: "Draft the cover letter and forms", fr: "Prépare le courrier d'accompagnement et les formulaires" },
        { en: "Flag missing or expired pieces", fr: "Signale les pièces manquantes ou périmées" },
      ],
      outputs: [
        { label: { en: "Contract paperwork pack", fr: "Dossier contractuel préparé" }, isPage: true },
        { label: { en: "Missing documents checklist", fr: "Checklist des pièces manquantes" }, isPage: true },
        { label: { en: "Updated client record", fr: "Fiche bénéficiaire mise à jour" }, isPage: false },
      ],
      tools: ["Ogust", "Apologic", "Ximi"],
    },
    {
      triggers: [
        { en: "Nightly clocking import completes", fr: "Import des pointages de nuit terminé" },
        { en: "End of pay period reached", fr: "Fin de période de paie atteinte" },
        { en: "On demand before a billing run", fr: "À la demande avant la facturation" },
      ],
      actions: [
        { en: "Read remote clocking against planned visits", fr: "Lit les pointages face aux interventions prévues" },
        { en: "Match each clock-in to its visit", fr: "Rapproche chaque pointage de son intervention" },
        { en: "Cross-check durations and care-plan hours", fr: "Recoupe les durées et les heures du plan d'aide" },
        {
          en: "Detect missing, short or overlapping clockings",
          fr: "Détecte pointages manquants, courts ou chevauchants",
        },
        { en: "Prepare the reconciliation for validation", fr: "Prépare le rapprochement pour validation" },
        { en: "Flag anomalies before billing and pay", fr: "Signale les anomalies avant facturation et paie" },
      ],
      outputs: [
        { label: { en: "Reconciliation report", fr: "Rapport de rapprochement" }, isPage: true },
        { label: { en: "Anomalies list to review", fr: "Liste d'anomalies à vérifier" }, isPage: true },
        { label: { en: "Updated visit records", fr: "Interventions mises à jour" }, isPage: false },
      ],
      tools: ["Domatel", "Ximi", "Ogust"],
    },
  ],

  "courtiers-assurance": [
    {
      triggers: [
        { en: "Client reports a claim by WhatsApp", fr: "Client déclare un sinistre par WhatsApp" },
        { en: "Claim email arrives in the shared inbox", fr: "Email de sinistre reçu dans la boîte partagée" },
        { en: "On demand from the broker", fr: "À la demande du courtier" },
      ],
      actions: [
        { en: "Collect the message and any photos or attachments", fr: "Collecte le message et les photos ou pièces jointes" },
        {
          en: "Extract the policy number, date and nature of the loss",
          fr: "Extrait le numéro de contrat, la date et la nature du sinistre",
        },
        { en: "Match the client to the right contract", fr: "Rapproche le client du bon contrat dans le logiciel" },
        {
          en: "Build the required document checklist for this loss type",
          fr: "Établit la liste des pièces requises pour ce type de sinistre",
        },
        {
          en: "Prepare the claim record and pre-fill the insurer declaration",
          fr: "Prépare la fiche sinistre et pré-remplit la déclaration assureur",
        },
        {
          en: "Flag missing pieces and the acknowledgement to send",
          fr: "Signale les pièces manquantes et l'accusé de réception à envoyer",
        },
      ],
      outputs: [
        { label: { en: "Claim file summary", fr: "Fiche de synthèse du sinistre" }, isPage: true },
        { label: { en: "Document checklist for the client", fr: "Liste des pièces à fournir au client" }, isPage: true },
        { label: { en: "Draft acknowledgement to the client", fr: "Brouillon d'accusé de réception" }, isPage: false },
      ],
      tools: ["CourtiGo", "WhatsApp", "Gmail / Outlook"],
    },
    {
      triggers: [
        { en: "New quote request from a prospect or client", fr: "Nouvelle demande de devis d'un prospect ou client" },
        { en: "Daily check of quotes with no reply", fr: "Vérification quotidienne des devis sans réponse" },
        { en: "On demand from the broker", fr: "À la demande du courtier" },
      ],
      actions: [
        { en: "Collect the client need and risk details", fr: "Collecte le besoin du client et les éléments de risque" },
        { en: "Extract the data to fill the insurer forms", fr: "Extrait les données nécessaires aux formulaires assureurs" },
        { en: "Gather offers from the insurer extranets", fr: "Réunit les offres depuis les extranets assureurs" },
        { en: "Build a side-by-side comparison of guarantees", fr: "Construit un comparatif des garanties côte à côte" },
        { en: "Draft the quote presentation for the client", fr: "Rédige la présentation du devis pour le client" },
        { en: "Draft a follow-up for quotes left unanswered", fr: "Rédige une relance pour les devis sans réponse" },
      ],
      outputs: [
        { label: { en: "Quote comparison sheet", fr: "Comparatif de devis" }, isPage: true },
        { label: { en: "Draft client follow-up message", fr: "Brouillon de relance client" }, isPage: false },
        { label: { en: "Updated quote status", fr: "Statut du devis mis à jour" }, isPage: false },
      ],
      tools: ["CourtiGo", "EDI Courtage NEO", "Gmail / Outlook"],
    },
    {
      triggers: [
        { en: "Daily scan of open files", fr: "Balayage quotidien des dossiers en cours" },
        { en: "New document uploaded to the GED", fr: "Nouveau document déposé dans la GED" },
        { en: "On demand before an audit", fr: "À la demande avant un contrôle" },
      ],
      actions: [
        { en: "Collect the documents present in each file", fr: "Recense les documents présents dans chaque dossier" },
        { en: "Determine the required pieces per file type", fr: "Détermine les pièces requises par type de dossier" },
        { en: "Cross-check against the mandatory ACPR documents", fr: "Recoupe avec les documents ACPR obligatoires" },
        { en: "Build the list of missing or expired pieces", fr: "Établit la liste des pièces manquantes ou périmées" },
        {
          en: "Flag advisory-duty and information-notice gaps",
          fr: "Signale les manques de devoir de conseil et fiches d'information",
        },
        { en: "Prepare client reminders for missing pieces", fr: "Prépare des relances aux clients pour les pièces manquantes" },
      ],
      outputs: [
        { label: { en: "Compliance gap report", fr: "Rapport des écarts de conformité" }, isPage: true },
        { label: { en: "Missing documents checklist per file", fr: "Liste des pièces manquantes par dossier" }, isPage: true },
        { label: { en: "Draft document reminder to client", fr: "Brouillon de relance pièces au client" }, isPage: false },
      ],
      tools: ["CourtiGo", "Antenia", "Gmail / Outlook"],
    },
    {
      triggers: [
        { en: "New client email or WhatsApp message", fr: "Nouvel email ou message WhatsApp d'un client" },
        { en: "Hourly scan of the shared inbox", fr: "Balayage horaire de la boîte partagée" },
        { en: "On demand from the broker", fr: "À la demande du courtier" },
      ],
      actions: [
        { en: "Collect incoming requests across email and WhatsApp", fr: "Collecte les demandes entrantes par email et WhatsApp" },
        { en: "Extract the subject and the client contract", fr: "Extrait l'objet et le contrat du client" },
        { en: "Classify by type and urgency", fr: "Classe par type et urgence" },
        { en: "Cross-check the request against the client file", fr: "Recoupe la demande avec le dossier client" },
        { en: "Build a prioritized queue for the broker", fr: "Construit une file priorisée pour le courtier" },
        { en: "Draft a tailored reply for each request", fr: "Rédige une réponse adaptée pour chaque demande" },
      ],
      outputs: [
        { label: { en: "Prioritized request queue", fr: "File des demandes priorisées" }, isPage: true },
        { label: { en: "Draft reply per request", fr: "Brouillon de réponse par demande" }, isPage: false },
        { label: { en: "Updated client record", fr: "Fiche client mise à jour" }, isPage: false },
      ],
      tools: ["CourtiGo", "WhatsApp", "Gmail / Outlook"],
    },
  ],

  "experts-comptables": [
    {
      triggers: [
        { en: "Monthly on the collection deadline", fr: "Chaque mois à la date butoir de collecte" },
        { en: "Client uploads a missing piece", fr: "Le client dépose une pièce manquante" },
        { en: "On demand before a closing", fr: "À la demande avant une clôture" },
      ],
      actions: [
        { en: "List documents expected per client for the period", fr: "Liste les pièces attendues par client pour la période" },
        { en: "Check the file for what is already received", fr: "Vérifie dans le dossier ce qui est déjà reçu" },
        { en: "Identify the gap of missing pieces", fr: "Identifie l'écart des pièces manquantes" },
        { en: "Draft a personalized follow-up per client", fr: "Rédige une relance personnalisée par client" },
        { en: "Group reminders by deadline urgency", fr: "Regroupe les relances par urgence d'échéance" },
        { en: "Update the collection tracker", fr: "Met à jour le suivi de collecte" },
      ],
      outputs: [
        { label: { en: "Missing-pieces tracking board", fr: "Tableau de suivi des pièces manquantes" }, isPage: true },
        { label: { en: "Draft follow-up per client", fr: "Brouillon de relance par client" }, isPage: false },
        { label: { en: "Updated collection status", fr: "Statut de collecte mis à jour" }, isPage: false },
      ],
      tools: ["Pennylane", "Sage Coala", "RCA"],
    },
    {
      triggers: [
        { en: "Daily on a new bank feed", fr: "Chaque jour à l'arrivée du flux bancaire" },
        { en: "New invoice received in the file", fr: "Nouvelle facture reçue dans le dossier" },
        { en: "On demand before monthly close", fr: "À la demande avant la clôture mensuelle" },
      ],
      actions: [
        { en: "Read invoices and bank statements", fr: "Lit les factures et relevés bancaires" },
        { en: "Extract amount, date, VAT and third party", fr: "Extrait montant, date, TVA et tiers" },
        { en: "Propose accounting entries for review", fr: "Propose les écritures comptables à valider" },
        { en: "Match transactions to invoices", fr: "Rapproche les transactions aux factures" },
        { en: "Flag unmatched lines and duplicates", fr: "Signale lignes non rapprochées et doublons" },
        { en: "Compile the items needing a decision", fr: "Compile les points nécessitant une décision" },
      ],
      outputs: [
        { label: { en: "Proposed entries for validation", fr: "Écritures proposées à valider" }, isPage: true },
        { label: { en: "Reconciliation report", fr: "Rapport de rapprochement" }, isPage: true },
        { label: { en: "Unmatched items flagged", fr: "Anomalies non rapprochées signalées" }, isPage: false },
      ],
      tools: ["Pennylane", "Cegid Expert", "ACD (Cador)", "Agiris"],
    },
    {
      triggers: [
        { en: "Incoming client question", fr: "Question client entrante" },
        { en: "On demand from the collaborator", fr: "À la demande du collaborateur" },
        { en: "Weekly batch of pending questions", fr: "Traitement hebdomadaire des questions en attente" },
      ],
      actions: [
        { en: "Read the client question", fr: "Lit la question du client" },
        { en: "Pull the relevant file data", fr: "Récupère les données utiles du dossier" },
        { en: "Identify the recurring question type", fr: "Identifie le type de question récurrent" },
        { en: "Draft a sourced answer from the file", fr: "Rédige une réponse sourcée depuis le dossier" },
        { en: "Flag questions needing the accountant", fr: "Signale les questions nécessitant l'expert" },
        { en: "Prepare the reply for the collaborator", fr: "Prépare la réponse pour le collaborateur" },
      ],
      outputs: [
        { label: { en: "Draft reply to the client", fr: "Brouillon de réponse au client" }, isPage: false },
        { label: { en: "Open questions log", fr: "Journal des questions ouvertes" }, isPage: true },
      ],
      tools: ["Pennylane", "Sage Coala", "Cegid Expert"],
    },
    {
      triggers: [
        { en: "Scheduled before the review meeting", fr: "Planifié avant le rendez-vous bilan" },
        { en: "On demand from the partner", fr: "À la demande de l'expert-comptable" },
        { en: "End of a client's fiscal year", fr: "Fin d'exercice d'un client" },
      ],
      actions: [
        { en: "Gather balances and key file data", fr: "Rassemble balances et données clés du dossier" },
        { en: "Compare to the prior year", fr: "Compare à l'exercice précédent" },
        { en: "Flag anomalies and unusual variances", fr: "Signale anomalies et écarts inhabituels" },
        { en: "List open points and missing pieces", fr: "Liste points ouverts et pièces manquantes" },
        { en: "Draft talking points for the meeting", fr: "Rédige les points à aborder en rendez-vous" },
        { en: "Assemble the review brief for the partner", fr: "Assemble la note de synthèse pour l'expert" },
      ],
      outputs: [
        { label: { en: "Year-end review brief", fr: "Note de synthèse bilan" }, isPage: true },
        { label: { en: "Anomalies dashboard", fr: "Tableau de bord des anomalies" }, isPage: true },
        { label: { en: "Open points flagged", fr: "Points ouverts signalés" }, isPage: false },
      ],
      tools: ["Cegid Expert", "ACD (Cador)", "Agiris", "Pennylane"],
    },
  ],

  pharmacies: [
    {
      triggers: [
        { en: "A product is out of stock at the wholesaler", fr: "Un produit est en rupture chez le grossiste" },
        { en: "Morning stock check before opening", fr: "Vérification des stocks le matin avant l'ouverture" },
        { en: "Reorder threshold reached on a reference", fr: "Seuil de réapprovisionnement atteint sur une référence" },
      ],
      actions: [
        {
          en: "Detect references below the reorder threshold",
          fr: "Détecte les références sous le seuil de réapprovisionnement",
        },
        { en: "Cross-check stock-outs against wholesaler availability", fr: "Croise les ruptures avec la disponibilité du grossiste" },
        {
          en: "Group missing references by supplier and priority",
          fr: "Regroupe les références manquantes par fournisseur et priorité",
        },
        {
          en: "Prepare a draft wholesaler order for review",
          fr: "Prépare un projet de commande grossiste à valider",
        },
        { en: "Suggest available substitutes for lasting shortages", fr: "Propose des équivalents disponibles pour les ruptures durables" },
        { en: "Flag references to follow up at next delivery", fr: "Signale les références à suivre à la prochaine livraison" },
      ],
      outputs: [
        { label: { en: "Draft wholesaler order sheet", fr: "Projet de bon de commande grossiste" }, isPage: true },
        { label: { en: "Stock-outs summary", fr: "Synthèse des ruptures" }, isPage: true },
        { label: { en: "Order ready to place after approval", fr: "Commande prête à passer après validation" }, isPage: false },
      ],
      tools: ["LGPI", "Winpharma", "Pharmaland"],
    },
    {
      triggers: [
        { en: "A patient asks to renew a recurring prescription", fr: "Un patient demande le renouvellement d'une ordonnance récurrente" },
        { en: "Daily check of renewals due this week", fr: "Vérification quotidienne des renouvellements de la semaine" },
        { en: "A chronic treatment is nearing its end", fr: "Un traitement chronique arrive bientôt à terme" },
      ],
      actions: [
        { en: "Identify chronic treatments due for renewal", fr: "Identifie les traitements chroniques à renouveler" },
        {
          en: "Check prescription validity and remaining refills",
          fr: "Vérifie la validité de l'ordonnance et les renouvellements restants",
        },
        {
          en: "Flag prescriptions needing a new doctor's visit",
          fr: "Signale les ordonnances nécessitant une nouvelle consultation",
        },
        { en: "Verify availability of each treatment at delivery", fr: "Vérifie la disponibilité de chaque traitement à la délivrance" },
        { en: "Prepare a renewals list for the pharmacist", fr: "Prépare une liste de renouvellements à valider" },
        {
          en: "Draft a reminder for patients with an expired prescription",
          fr: "Rédige un rappel pour les patients dont l'ordonnance est expirée",
        },
      ],
      outputs: [
        { label: { en: "Renewals list to approve", fr: "Liste de renouvellements à valider" }, isPage: true },
        { label: { en: "Prescriptions to flag for a visit", fr: "Ordonnances à signaler pour consultation" }, isPage: true },
        { label: { en: "Patient renewal reminder", fr: "Rappel de renouvellement au patient" }, isPage: false },
      ],
      tools: ["LGPI", "Smart RX", "LEO"],
    },
    {
      triggers: [
        { en: "New emails from labs and suppliers", fr: "De nouveaux e-mails des labos et fournisseurs" },
        { en: "Morning review of supplier messages", fr: "Revue matinale des messages fournisseurs" },
        { en: "A promotional offer or recall notice arrives", fr: "Une offre promotionnelle ou un avis de retrait arrive" },
      ],
      actions: [
        { en: "Sort lab and supplier messages by topic", fr: "Trie les messages des labos et fournisseurs par sujet" },
        { en: "Flag recalls and withdrawals as a priority", fr: "Signale les retraits et rappels de lots en priorité" },
        { en: "Extract key terms from commercial offers", fr: "Extrait les conditions clés des offres commerciales" },
        { en: "Match offers to current shortages and needs", fr: "Rapproche les offres des ruptures et besoins en cours" },
        { en: "Prepare a summary of messages to handle", fr: "Prépare une synthèse des messages à traiter" },
        { en: "Draft a reply to suppliers awaiting an answer", fr: "Rédige une réponse aux fournisseurs en attente" },
      ],
      outputs: [
        { label: { en: "Supplier messages summary", fr: "Synthèse des communications fournisseurs" }, isPage: true },
        { label: { en: "Recalls to handle as a priority", fr: "Rappels de lots à traiter en priorité" }, isPage: true },
        { label: { en: "Draft reply to a supplier", fr: "Projet de réponse à un fournisseur" }, isPage: false },
      ],
      tools: ["LGPI", "Winpharma", "Pharmaland"],
    },
  ],

  ehpad: [
    {
      triggers: [
        { en: "A ViaTrajectoire admission request arrives", fr: "Une demande d'admission ViaTrajectoire arrive" },
        { en: "A family emails or calls to request a place", fr: "Une famille écrit ou appelle pour demander une place" },
        { en: "Weekly review of pending admission files", fr: "Revue hebdomadaire des dossiers d'admission en attente" },
      ],
      actions: [
        {
          en: "Read the request and check bed availability against capacity",
          fr: "Lit la demande et vérifie la disponibilité des lits selon la capacité",
        },
        {
          en: "List missing pieces (medical form, GIR level, ID, resources)",
          fr: "Liste les pièces manquantes (volet médical, niveau GIR, identité, ressources)",
        },
        {
          en: "Cross-check the resident profile against the care fit",
          fr: "Recoupe le profil du résident avec l'adéquation de prise en charge",
        },
        {
          en: "Create the pre-admission record and flag the dependency level",
          fr: "Crée la fiche de pré-admission et signale le niveau de dépendance",
        },
        {
          en: "Draft an admission reply (offer, waiting list, or refusal)",
          fr: "Rédige un courrier de réponse (proposition, liste d'attente ou refus motivé)",
        },
        {
          en: "Prepare a follow-up note with the next step and deadline",
          fr: "Prépare une note de suivi avec la prochaine étape et l'échéance",
        },
      ],
      outputs: [
        { label: { en: "Admission reply letter", fr: "Courrier de réponse d'admission" }, isPage: true },
        { label: { en: "Missing-pieces checklist", fr: "Liste des pièces manquantes" }, isPage: true },
        { label: { en: "Pre-admission record updated", fr: "Fiche de pré-admission mise à jour" }, isPage: false },
      ],
      tools: ["NetSoins", "Orisha Socialcare", "Titan"],
    },
    {
      triggers: [
        { en: "A family asks for news about a resident", fr: "Une famille demande des nouvelles d'un résident" },
        { en: "An event or activity to announce to families", fr: "Un événement ou une animation à annoncer aux familles" },
        { en: "A care or health change to share", fr: "Un changement de soin ou de santé à partager" },
      ],
      actions: [
        {
          en: "Gather recent care notes and activity participation",
          fr: "Rassemble les notes de soin récentes et la participation aux animations",
        },
        {
          en: "Check the referent contact and preferred channel",
          fr: "Vérifie le contact référent et le canal préféré",
        },
        {
          en: "Draft a warm, factual update for the referent",
          fr: "Rédige une mise à jour chaleureuse et factuelle pour le référent",
        },
        { en: "Prepare a family news page for an event or visit", fr: "Prépare une page de nouvelles familles pour un événement ou une visite" },
        {
          en: "Flag any sensitive health topic for the caregiver",
          fr: "Signale tout sujet de santé sensible au soignant",
        },
        {
          en: "Log the communication once the caregiver approves",
          fr: "Consigne la communication une fois approuvée par le soignant",
        },
      ],
      outputs: [
        { label: { en: "Family news page", fr: "Page de nouvelles aux familles" }, isPage: true },
        { label: { en: "News update message to the family", fr: "Message de nouvelles à la famille" }, isPage: false },
        { label: { en: "Communication logged in the record", fr: "Communication consignée dans le dossier" }, isPage: false },
      ],
      tools: ["NetSoins", "Teranga", "Orisha Socialcare"],
    },
    {
      triggers: [
        { en: "An APA or public-aid file needs a renewal", fr: "Un dossier APA ou d'aide publique nécessite un renouvellement" },
        { en: "A document deadline for a resident approaches", fr: "Une échéance de document pour un résident approche" },
        { en: "Monthly check of resident admin files", fr: "Contrôle mensuel des dossiers administratifs des résidents" },
      ],
      actions: [
        {
          en: "Review each resident's aid eligibility (APA, ASH, housing aid)",
          fr: "Examine l'éligibilité aux aides de chaque résident (APA, ASH, aide au logement)",
        },
        {
          en: "Identify expiring documents and renewal deadlines",
          fr: "Identifie les documents à expiration et les échéances de renouvellement",
        },
        { en: "Gather the supporting pieces for the aid file", fr: "Rassemble les pièces justificatives du dossier d'aide" },
        {
          en: "Draft the aid request or renewal form",
          fr: "Rédige la demande d'aide ou le formulaire de renouvellement",
        },
        {
          en: "Build an aids status sheet with each file's stage and deadline",
          fr: "Construit une fiche d'état des aides avec l'étape et l'échéance de chaque dossier",
        },
        { en: "Update the administrative record once validated", fr: "Met à jour le dossier administratif une fois validé" },
      ],
      outputs: [
        { label: { en: "Aids status sheet", fr: "Fiche d'état des aides" }, isPage: true },
        { label: { en: "Aid request form drafted", fr: "Formulaire de demande d'aide rédigé" }, isPage: true },
        { label: { en: "Administrative record updated", fr: "Dossier administratif mis à jour" }, isPage: false },
      ],
      tools: ["NetSoins", "Orisha Socialcare", "Ségur", "Titan"],
    },
  ],

  "syndics-copropriete": [
    {
      triggers: [
        { en: "60 days before each scheduled meeting", fr: "60 jours avant chaque AG planifiée" },
        { en: "On demand for an extraordinary meeting", fr: "À la demande pour une AG extraordinaire" },
        { en: "New resolution added to the agenda", fr: "Nouvelle résolution ajoutée à l'ordre du jour" },
      ],
      actions: [
        { en: "Pull the building file and co-owner list", fr: "Récupère le dossier d'immeuble et la liste des copropriétaires" },
        {
          en: "Assemble the agenda from pending resolutions and quotes",
          fr: "Assemble l'ordre du jour à partir des résolutions et devis en attente",
        },
        { en: "Gather supporting documents: budget, contracts, quotes", fr: "Rassemble les pièces jointes : budget, contrats, devis" },
        { en: "Draft the convocation respecting legal notice periods", fr: "Rédige la convocation en respectant les délais légaux" },
        { en: "Prepare attendance and proxy forms per owner", fr: "Prépare les formulaires de présence et pouvoirs par copropriétaire" },
        { en: "Flag missing documents or quorum risks", fr: "Signale les pièces manquantes ou risques de quorum" },
      ],
      outputs: [
        { label: { en: "AG convocation pack", fr: "Dossier de convocation d'AG" }, isPage: true },
        { label: { en: "Agenda with attached resolutions", fr: "Ordre du jour avec résolutions jointes" }, isPage: true },
        { label: { en: "Quorum and missing-document alert", fr: "Alerte quorum et pièces manquantes" }, isPage: false },
      ],
      tools: ["Gercop", "Vilogi", "Even"],
    },
    {
      triggers: [
        { en: "Start of each quarterly budget period", fr: "Début de chaque appel trimestriel du budget" },
        { en: "Weekly scan of unpaid charge balances", fr: "Analyse hebdomadaire des soldes de charges impayés" },
        { en: "On demand after a budget vote", fr: "À la demande après un vote de budget" },
      ],
      actions: [
        { en: "Compute each lot's share from budget and tantièmes", fr: "Calcule la quote-part de chaque lot selon le budget et les tantièmes" },
        { en: "Prepare the call-for-funds notices per owner", fr: "Prépare les avis d'appel de fonds par copropriétaire" },
        { en: "Track unpaid balances against the ledger", fr: "Suit les soldes impayés au regard du grand livre" },
        { en: "Draft personalized reminders graded by lateness", fr: "Rédige des relances personnalisées selon le retard" },
        { en: "Prepare a pre-litigation file for persistent debtors", fr: "Prépare un dossier pré-contentieux pour les débiteurs persistants" },
        { en: "Flag disputed balances for the manager", fr: "Signale les soldes contestés au gestionnaire" },
      ],
      outputs: [
        { label: { en: "Call-for-funds notices", fr: "Avis d'appel de fonds" }, isPage: true },
        { label: { en: "Charge reminder letter", fr: "Lettre de relance de charges" }, isPage: true },
        { label: { en: "Unpaid balances status report", fr: "État de suivi des impayés" }, isPage: true },
      ],
      tools: ["Gercop", "ICS", "Powimo"],
    },
    {
      triggers: [
        { en: "Monthly on the rent due date", fr: "Mensuellement à la date d'échéance des loyers" },
        { en: "Daily scan for late rent payments", fr: "Analyse quotidienne des loyers en retard" },
        { en: "On demand after a lease change", fr: "À la demande après un changement de bail" },
      ],
      actions: [
        { en: "Pull active leases and rent terms", fr: "Récupère les baux actifs et conditions de loyer" },
        { en: "Compute rent, charges and any indexation", fr: "Calcule le loyer, les charges et l'éventuelle révision" },
        { en: "Issue rent invoices and receipts per tenant", fr: "Établit les avis d'échéance et quittances par locataire" },
        { en: "Reconcile incoming payments against the ledger", fr: "Rapproche les paiements reçus avec le grand livre" },
        { en: "Draft reminders for late payments by lateness", fr: "Rédige des relances pour retards selon l'ancienneté" },
        { en: "Flag recurring late payers for the manager", fr: "Signale les retards récurrents au gestionnaire" },
      ],
      outputs: [
        { label: { en: "Rent invoice and receipt", fr: "Avis d'échéance et quittance" }, isPage: true },
        { label: { en: "Late-rent reminder letter", fr: "Lettre de relance de loyer" }, isPage: true },
        { label: { en: "Payment reconciliation entry", fr: "Écriture de rapprochement des paiements" }, isPage: false },
      ],
      tools: ["Vilogi", "Powimo", "Seiitra"],
    },
    {
      triggers: [
        { en: "Incoming tenant request by email or portal", fr: "Demande locataire entrante par email ou portail" },
        { en: "Daily triage of the shared inbox", fr: "Tri quotidien de la boîte partagée" },
        { en: "On demand for an urgent incident", fr: "À la demande pour un incident urgent" },
      ],
      actions: [
        { en: "Sort incoming requests by type and urgency", fr: "Trie les demandes entrantes par type et urgence" },
        { en: "Match each request to the building and lot", fr: "Rattache chaque demande à l'immeuble et au lot" },
        { en: "Draft a reply confirming receipt and next steps", fr: "Rédige une réponse confirmant la réception et les suites" },
        { en: "Prepare a work order with the right provider", fr: "Prépare un ordre de service avec le bon prestataire" },
        { en: "Coordinate provider scheduling and tenant access", fr: "Coordonne la planification du prestataire et l'accès locataire" },
        { en: "Flag recurring or warranty-covered issues", fr: "Signale les problèmes récurrents ou sous garantie" },
      ],
      outputs: [
        { label: { en: "Provider work order", fr: "Ordre de service prestataire" }, isPage: true },
        { label: { en: "Tenant reply draft", fr: "Brouillon de réponse au locataire" }, isPage: false },
        { label: { en: "Maintenance request log entry", fr: "Entrée au journal des demandes" }, isPage: false },
      ],
      tools: ["Vilogi", "Thetrawin", "Gimini"],
    },
  ],

  hotellerie: [
    {
      triggers: [
        { en: "New direct booking request received", fr: "Nouvelle demande de réservation directe reçue" },
        { en: "Guest message arrives in the inbox", fr: "Message client reçu en boîte de réception" },
        { en: "On demand from the front desk", fr: "À la demande de la réception" },
      ],
      actions: [
        { en: "Capture the booking request and guest details", fr: "Capture la demande et les coordonnées du client" },
        { en: "Check room availability for the dates", fr: "Vérifie la disponibilité des chambres pour les dates" },
        { en: "Draft a reply with room options and rate", fr: "Rédige une réponse avec options de chambre et tarif" },
        { en: "Prepare a booking record for confirmation", fr: "Prépare une fiche de réservation à confirmer" },
        { en: "Schedule the reply for desk approval", fr: "Programme la réponse pour validation par la réception" },
        { en: "Flag group or special requests for review", fr: "Signale les demandes groupe ou spéciales à revoir" },
      ],
      outputs: [
        { label: { en: "Pending bookings list", fr: "Liste des réservations en attente" }, isPage: true },
        { label: { en: "Draft guest reply", fr: "Brouillon de réponse client" }, isPage: false },
      ],
      tools: ["Mews", "Reservit", "Medialog"],
    },
    {
      triggers: [
        { en: "Daily before the portal cut-off", fr: "Chaque jour avant la fermeture des portails" },
        { en: "Occupancy threshold reached", fr: "Seuil d'occupation atteint" },
        { en: "On demand before a busy period", fr: "À la demande avant une période chargée" },
      ],
      actions: [
        { en: "Pull current occupancy and remaining rooms", fr: "Récupère l'occupation et les chambres restantes" },
        { en: "Compare rates across booking portals", fr: "Compare les tarifs entre les portails de réservation" },
        { en: "Draft rate and availability changes by room type", fr: "Prépare les changements de tarif et de disponibilité par type de chambre" },
        { en: "Prepare a stop-sale for fully booked dates", fr: "Prépare l'arrêt des ventes sur les dates complètes" },
        { en: "Compile a change proposal for approval", fr: "Compile une proposition de modification à valider" },
        { en: "Flag rate gaps between channels", fr: "Signale les écarts de tarif entre canaux" },
      ],
      outputs: [
        { label: { en: "Rate-change proposal sheet", fr: "Fiche de proposition de tarifs" }, isPage: true },
        { label: { en: "Availability update summary", fr: "Récapitulatif des disponibilités" }, isPage: true },
      ],
      tools: ["D-EDGE", "Mews", "Reservit"],
    },
    {
      triggers: [
        { en: "Guest checkout completed", fr: "Départ du client effectué" },
        { en: "Weekly for recent stays", fr: "Chaque semaine pour les séjours récents" },
        { en: "On demand for a guest segment", fr: "À la demande pour un segment de clients" },
      ],
      actions: [
        { en: "Capture stay details and guest history", fr: "Capture les détails du séjour et l'historique client" },
        { en: "Segment guests by stay type and loyalty", fr: "Segmente les clients par type de séjour et fidélité" },
        { en: "Draft a personalised review request", fr: "Rédige une demande d'avis personnalisée" },
        { en: "Draft a loyalty offer for returning guests", fr: "Rédige une offre fidélité pour les clients récurrents" },
        { en: "Schedule messages for owner approval", fr: "Programme les messages pour validation du gérant" },
        { en: "Flag unhappy guests for direct follow-up", fr: "Signale les clients mécontents pour un suivi direct" },
      ],
      outputs: [
        { label: { en: "Guest segments digest", fr: "Synthèse des segments clients" }, isPage: true },
        { label: { en: "Draft review request", fr: "Brouillon de demande d'avis" }, isPage: false },
      ],
      tools: ["Mews", "Medialog", "Septeo Hospitality"],
    },
    {
      triggers: [
        { en: "Days before the arrival date", fr: "Quelques jours avant la date d'arrivée" },
        { en: "New reservation confirmed", fr: "Nouvelle réservation confirmée" },
        { en: "On demand for the day's arrivals", fr: "À la demande pour les arrivées du jour" },
      ],
      actions: [
        { en: "Capture upcoming arrivals and stay details", fr: "Capture les arrivées à venir et les détails du séjour" },
        { en: "Draft a pre-arrival welcome email", fr: "Rédige un e-mail de bienvenue pré-arrivée" },
        { en: "Prepare check-in and parking information", fr: "Prépare les informations d'arrivée et de stationnement" },
        { en: "Draft a confirmation reminder for risky bookings", fr: "Rédige un rappel de confirmation pour les réservations à risque" },
        { en: "Schedule reminders for desk approval", fr: "Programme les rappels pour validation par la réception" },
        { en: "Flag no-show risks for the front desk", fr: "Signale les risques de no-show à la réception" },
      ],
      outputs: [
        { label: { en: "Daily arrivals brief", fr: "Note des arrivées du jour" }, isPage: true },
        { label: { en: "Draft pre-arrival email", fr: "Brouillon d'e-mail pré-arrivée" }, isPage: false },
      ],
      tools: ["Mews", "Reservit", "Septeo Hospitality"],
    },
  ],

  "artisans-batiment": [
    {
      triggers: [
        { en: "After a site visit dictated on the road", fr: "Après un relevé dicté sur la route" },
        { en: "Photos of the site sent from the phone", fr: "Photos du chantier envoyées depuis le mobile" },
        { en: "On demand from the craftsman", fr: "À la demande de l'artisan" },
      ],
      actions: [
        { en: "Transcribe the dictation and sort it by room or lot", fr: "Transcrit la dictée et la trie par pièce ou par lot" },
        { en: "Extract measurements, quantities and materials", fr: "Extrait les mesures, quantités et matériaux" },
        { en: "Itemize the work into clear line items", fr: "Détaille les travaux en lignes claires" },
        { en: "Price each line from the catalog and labor rates", fr: "Chiffre chaque ligne depuis le catalogue et les taux de main d'oeuvre" },
        { en: "Draft the quote in the software for review", fr: "Prépare le devis dans le logiciel pour relecture" },
        { en: "Flag missing measurements or unclear items", fr: "Signale les mesures manquantes ou les points flous" },
      ],
      outputs: [
        { label: { en: "Priced quote PDF", fr: "Devis chiffré en PDF" }, isPage: true },
        { label: { en: "Itemized line list to review", fr: "Liste de lignes à relire" }, isPage: true },
        { label: { en: "Draft quote saved in the software", fr: "Devis brouillon enregistré dans le logiciel" }, isPage: false },
      ],
      tools: ["Tolteck", "Batappli", "EBP Bâtiment"],
    },
    {
      triggers: [
        { en: "On a recurring weekly schedule", fr: "Selon un planning hebdomadaire" },
        { en: "A quote stays unanswered past a delay", fr: "Un devis reste sans réponse au-delà d'un délai" },
        { en: "An invoice passes its due date", fr: "Une facture dépasse sa date d'échéance" },
      ],
      actions: [
        { en: "Scan quotes and invoices for unanswered or unpaid ones", fr: "Parcourt devis et factures sans réponse ou impayés" },
        { en: "Sort by amount and days overdue", fr: "Trie par montant et jours de retard" },
        { en: "Match each to its client and history", fr: "Rapproche chacun de son client et de son historique" },
        { en: "Draft the right follow-up tone for each case", fr: "Rédige la relance au bon ton selon le cas" },
        { en: "Prepare a recap for the craftsman to approve", fr: "Prépare un récapitulatif à valider par l'artisan" },
        { en: "Flag cases that need a phone call", fr: "Signale les cas qui demandent un appel" },
      ],
      outputs: [
        { label: { en: "Follow-up list ranked by priority", fr: "Liste de relances classée par priorité" }, isPage: true },
        { label: { en: "Draft follow-up message per case", fr: "Message de relance préparé par cas" }, isPage: false },
        { label: { en: "Updated status on each record", fr: "Statut mis à jour sur chaque fiche" }, isPage: false },
      ],
      tools: ["EBP Bâtiment", "Sage Batigest", "Obat"],
    },
    {
      triggers: [
        { en: "A new job site is confirmed", fr: "Un nouveau chantier est confirmé" },
        { en: "Every morning before the round", fr: "Chaque matin avant la tournée" },
        { en: "On demand from the phone", fr: "À la demande depuis le mobile" },
      ],
      actions: [
        { en: "Gather job sites, appointments and team availability", fr: "Rassemble chantiers, rendez-vous et disponibilités de l'équipe" },
        { en: "Sort by location and urgency", fr: "Trie par localisation et urgence" },
        { en: "Propose a week schedule with travel between sites", fr: "Propose un planning de semaine avec les trajets entre chantiers" },
        { en: "Draft client confirmation messages per slot", fr: "Prépare les messages de confirmation client par créneau" },
        { en: "Prepare the day sheet for the team", fr: "Prépare la feuille de journée pour l'équipe" },
        { en: "Flag conflicts and overbooked days", fr: "Signale les conflits et les journées surchargées" },
      ],
      outputs: [
        { label: { en: "Proposed week schedule", fr: "Planning de semaine proposé" }, isPage: true },
        { label: { en: "Daily team sheet", fr: "Feuille de journée pour l'équipe" }, isPage: true },
        { label: { en: "Draft client confirmation per slot", fr: "Confirmation client préparée par créneau" }, isPage: false },
      ],
      tools: ["Extrabat", "Batappli", "Codial"],
    },
    {
      triggers: [
        { en: "After a site visit dictated on site", fr: "Après une visite dictée sur place" },
        { en: "Photos and notes sent from the phone", fr: "Photos et notes envoyées depuis le mobile" },
        { en: "On demand from the craftsman", fr: "À la demande de l'artisan" },
      ],
      actions: [
        { en: "Transcribe the dictation from the visit", fr: "Transcrit la dictée de la visite" },
        { en: "Structure it by topic and observation", fr: "La structure par sujet et observation" },
        { en: "Attach the site photos to the right points", fr: "Associe les photos du chantier aux bons points" },
        { en: "Draft a clean report with next steps", fr: "Rédige un compte-rendu propre avec les suites à donner" },
        { en: "Prepare a short client-facing summary", fr: "Prépare un résumé court destiné au client" },
        { en: "Flag points needing a decision or a quote", fr: "Signale les points demandant une décision ou un devis" },
      ],
      outputs: [
        { label: { en: "Site-visit report page", fr: "Page de compte-rendu de visite" }, isPage: true },
        { label: { en: "Client summary to review", fr: "Résumé client à relire" }, isPage: true },
        { label: { en: "Report attached to the job record", fr: "Compte-rendu attaché à la fiche chantier" }, isPage: false },
      ],
      tools: ["Obat", "Tolteck", "Batappli"],
    },
  ],

  veterinaires: [
    {
      triggers: [
        { en: "An incoming call to the clinic", fr: "Un appel entrant à la clinique" },
        { en: "A booking message by SMS or email", fr: "Une demande de RDV par SMS ou email" },
        { en: "A callback request left after hours", fr: "Une demande de rappel laissée hors horaires" },
      ],
      actions: [
        { en: "Answer and identify the owner and the animal", fr: "Répond et identifie le propriétaire et l'animal" },
        { en: "Qualify the reason: consultation, vaccine, emergency", fr: "Qualifie le motif : consultation, vaccin, urgence" },
        { en: "Check the practitioner's open slots", fr: "Consulte les créneaux libres du praticien" },
        { en: "Propose two or three slots to confirm", fr: "Propose deux ou trois créneaux à confirmer" },
        { en: "Prepare the booking once the owner agrees", fr: "Prépare le RDV une fois l'accord du propriétaire" },
        { en: "Flag urgent cases for the on-duty vet", fr: "Signale les cas urgents au vétérinaire de garde" },
      ],
      outputs: [
        { label: { en: "Call summary with the reason", fr: "Résumé d'appel avec le motif" }, isPage: true },
        { label: { en: "Booked appointment slot", fr: "Créneau de RDV réservé" }, isPage: false },
        { label: { en: "Urgent case alert to the vet", fr: "Alerte cas urgent au vétérinaire" }, isPage: false },
      ],
      tools: ["Vetocom", "Vetup", "DrVeto"],
    },
    {
      triggers: [
        { en: "A daily scan of the patient base", fr: "Un balayage quotidien du fichier patients" },
        { en: "On demand before a clinic campaign", fr: "À la demande avant une campagne clinique" },
        { en: "A post-consultation follow-up date reached", fr: "Une date de suivi post-consultation atteinte" },
      ],
      actions: [
        { en: "Spot animals due for a vaccine or booster", fr: "Repère les animaux dus pour un vaccin ou rappel" },
        { en: "Spot pending post-op or treatment follow-ups", fr: "Repère les suivis post-op ou traitements en attente" },
        { en: "Group reminders by owner and animal", fr: "Regroupe les rappels par propriétaire et animal" },
        { en: "Draft the reminder message per case", fr: "Rédige le message de rappel par cas" },
        { en: "Suggest a booking link or slot in the message", fr: "Propose un lien ou créneau de RDV dans le message" },
        { en: "Submit the list for the vet to approve", fr: "Soumet la liste à la validation du vétérinaire" },
      ],
      outputs: [
        { label: { en: "Due animals reminders list", fr: "Liste des animaux à rappeler" }, isPage: true },
        { label: { en: "Drafted reminder messages", fr: "Messages de rappel rédigés" }, isPage: true },
        { label: { en: "Approved reminder sent to the owner", fr: "Rappel validé envoyé au propriétaire" }, isPage: false },
      ],
      tools: ["Vetup", "DrVeto", "VetoPartner"],
    },
    {
      triggers: [
        { en: "The vet's notes after a consultation", fr: "Les notes du vétérinaire après une consultation" },
        { en: "On demand for a referral letter", fr: "À la demande pour un courrier de référé" },
        { en: "A dictated voice memo to transcribe", fr: "Un mémo vocal dicté à transcrire" },
      ],
      actions: [
        { en: "Read the vet's notes and structure them", fr: "Lit les notes du vétérinaire et les structure" },
        { en: "Draft the consultation report", fr: "Rédige le compte-rendu de consultation" },
        { en: "Draft the prescription from the noted drugs", fr: "Rédige l'ordonnance à partir des médicaments notés" },
        { en: "Add posology and owner instructions", fr: "Ajoute la posologie et les consignes au propriétaire" },
        { en: "Flag missing fields for the vet to fill", fr: "Signale les champs manquants à compléter par le vétérinaire" },
        { en: "Submit the draft for the vet to sign", fr: "Soumet le brouillon à la signature du vétérinaire" },
      ],
      outputs: [
        { label: { en: "Consultation report draft", fr: "Brouillon de compte-rendu" }, isPage: true },
        { label: { en: "Prescription draft to sign", fr: "Brouillon d'ordonnance à signer" }, isPage: true },
        { label: { en: "Report sent to the owner", fr: "Compte-rendu envoyé au propriétaire" }, isPage: false },
      ],
      tools: ["Vetocom", "Bourgelat", "DrVeto"],
    },
    {
      triggers: [
        { en: "A daily check of stock levels", fr: "Un contrôle quotidien des niveaux de stock" },
        { en: "A drug reaching its reorder threshold", fr: "Un médicament atteignant son seuil de réappro" },
        { en: "On demand before a supplier order", fr: "À la demande avant une commande fournisseur" },
      ],
      actions: [
        { en: "Track medication levels and expiry dates", fr: "Suit les niveaux et dates de péremption" },
        { en: "Spot low stock and regulated-drug counts", fr: "Repère les stocks bas et comptages de produits réglementés" },
        { en: "Match consumption to recent consultations", fr: "Rapproche la consommation des consultations récentes" },
        { en: "Group items to reorder by supplier", fr: "Regroupe les articles à recommander par fournisseur" },
        { en: "Prepare the supplier order sheet", fr: "Prépare le bon de commande fournisseur" },
        { en: "Submit the order for the vet to approve", fr: "Soumet la commande à la validation du vétérinaire" },
      ],
      outputs: [
        { label: { en: "Low-stock alert list", fr: "Liste d'alertes stock bas" }, isPage: true },
        { label: { en: "Supplier order sheet", fr: "Bon de commande fournisseur" }, isPage: true },
        { label: { en: "Order ready for vet approval", fr: "Commande prête à valider" }, isPage: false },
      ],
      tools: ["Vetup", "DrVeto", "VetoPartner"],
    },
  ],
};

export function getAgentSpec(slug: string, index: number): AgentSpec | undefined {
  return AGENT_SPECS[slug]?.[index];
}

export interface AgentPreview {
  key: string;
  label: string;
  lines: string[];
}

/**
 * Framed page-output previews for an agent: one per `isPage` output, each seeded with a slice of
 * the agent's (already-localized) actions as sample content. Shared by the inline page showcase
 * and the agent modal so the two stay in lockstep. `limit` caps how many previews are returned.
 */
export function buildAgentPreviews(
  spec: AgentSpec | undefined,
  locale: string,
  actions: string[],
  limit?: number,
): AgentPreview[] {
  const pageOutputs = (spec?.outputs ?? []).filter((output) => output.isPage);
  const selected = limit ? pageOutputs.slice(0, limit) : pageOutputs;
  return selected.map((output, position) => ({
    key: output.label.en,
    label: loc(locale, output.label),
    lines: actions.slice(position * 2, position * 2 + 4),
  }));
}
