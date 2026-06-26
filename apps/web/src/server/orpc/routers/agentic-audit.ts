import { integration } from "@bap/db/schema";
import {
  buildAuditAgentRecommenderPrompt,
  buildAuditCompanyProfilePrompt,
  buildAuditIntegrationRecommenderPrompt,
  buildAuditPersonProfilePrompt,
} from "@bap/prompts";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { z } from "zod";
import { env } from "@/env";
import type { AuditIntegrationRecommendation } from "@/lib/agentic-audit-types";
import { type LinkedInProfileResult, scrapeLinkedInProfile } from "@/server/integrations/apify";
import { scrapeWebsite } from "@/server/integrations/firecrawl";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess } from "../workspace-access";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
]);
const AUDIT_STRUCTURED_OUTPUT_MODEL = "gpt-5.5";

type AuditIntegrationRecommendationOutput = {
  importanceScore: number;
  toolType: string;
  toolUse: string;
  whyLikely: string;
  commonTools: Array<{
    name: string;
    url: string;
  }>;
};

type AuditAgentRecommendation = {
  id: string;
  name: string;
  badge: "High ROI" | "Quick win";
  emoji: string;
  description: string;
  timeSaved: string;
  integrationCount: string;
  impactMetric: string;
  tools: string[];
};

type AuditCompanyProfile = {
  name: string | null;
  tagline: string | null;
  description: string | null;
  brand_voice: string[];
  color_palette: string[];
};

type ConnectedIntegrationRow = {
  type: string;
  enabled: boolean;
  authStatus: string | null;
};

type IntegrationQueryReader = {
  findMany(args: {
    where: ReturnType<typeof eq>;
    columns: {
      type: true;
      enabled: true;
      authStatus: true;
    };
  }): Promise<ConnectedIntegrationRow[]>;
};

type AuditContextInput = z.infer<typeof auditContextInputSchema>;

type AuditHandlerContext = {
  db: {
    query: {
      integration: IntegrationQueryReader;
    };
  };
  user: {
    id: string;
  };
};

type AuditPersonProfile = {
  full_name: string | null;
  job_title: string | null;
  description: string | null;
  talking_points: string[];
};

type AuditLinkedInProfileContext = LinkedInProfileResult & {
  personProfile?: AuditPersonProfile | null;
};

type EnrichedLinkedInProfileResult = LinkedInProfileResult & {
  personProfile: AuditPersonProfile | null;
};

type AuditWebsiteResult = Awaited<ReturnType<typeof scrapeWebsite>> & {
  companyProfile: AuditCompanyProfile | null;
};

const linkedInCompanySchema = z.object({
  name: z.string().nullable(),
  website: z.string().nullable(),
  industry: z.string().nullable(),
  description: z.string().nullable(),
  employeeCount: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  logoUrl: z.string().nullable(),
});

const linkedInProfileSchema = z.object({
  profileUrl: z.string(),
  fullName: z.string().nullable(),
  headline: z.string().nullable(),
  jobTitle: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  summary: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
  currentCompany: linkedInCompanySchema.nullable(),
  raw: z.record(z.string(), z.unknown()),
  personProfile: z
    .object({
      full_name: z.string().nullable(),
      job_title: z.string().nullable(),
      description: z.string().nullable(),
      talking_points: z.array(z.string()),
    })
    .nullable()
    .optional(),
});

const websiteScrapeResultSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  markdown: z.string(),
  detectedColors: z.array(z.string()),
  raw: z.record(z.string(), z.unknown()),
  companyProfile: z
    .object({
      name: z.string().nullable(),
      tagline: z.string().nullable(),
      description: z.string().nullable(),
      brand_voice: z.array(z.string()),
      color_palette: z.array(z.string()),
    })
    .nullable()
    .optional(),
});

const auditCommonToolSchema = z.object({
  name: z.string(),
  url: z.string(),
});

const auditIntegrationRecommendationSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  icon: z.string().optional(),
  reason: z.string(),
  importanceScore: z.number(),
  toolType: z.string(),
  toolUse: z.string(),
  whyLikely: z.string(),
  commonTools: z.array(auditCommonToolSchema),
  customTools: z.array(z.string()).optional(),
  connected: z.boolean(),
  selected: z.boolean(),
});

const auditContextInputSchema = z.object({
  email: z.string().email(),
  linkedinUrl: z.string().url(),
  companyUrl: z.string().url(),
  linkedin: linkedInProfileSchema,
  website: websiteScrapeResultSchema,
});

type AuditIntegrationCandidate = {
  id: string;
  name: string;
  url: string;
  icon: string;
  baseReason: string;
  keywords: string[];
};

const AUDIT_INTEGRATION_CANDIDATES: AuditIntegrationCandidate[] = [
  {
    id: "linkedin",
    name: "LinkedIn",
    url: "https://www.linkedin.com",
    icon: "/integrations/linkedin.svg",
    baseReason: "Profile, role, and company context.",
    keywords: ["linkedin", "outreach", "founder", "sales", "prospect", "lead"],
  },
  {
    id: "google_gmail",
    name: "Gmail",
    url: "https://mail.google.com",
    icon: "/integrations/google-gmail.svg",
    baseReason: "Draft outreach and follow-up emails.",
    keywords: ["email", "gmail", "outreach", "follow-up", "sales", "customer"],
  },
  {
    id: "outlook",
    name: "Outlook",
    url: "https://outlook.office.com",
    icon: "/integrations/outlook.svg",
    baseReason: "Draft email from Microsoft work accounts.",
    keywords: ["email", "outlook", "microsoft", "enterprise", "customer"],
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    url: "https://calendar.google.com",
    icon: "/integrations/google-calendar.svg",
    baseReason: "Meeting timing, reminders, and next steps.",
    keywords: ["calendar", "meeting", "demo", "follow-up", "sales", "customer"],
  },
  {
    id: "outlook_calendar",
    name: "Outlook Calendar",
    url: "https://outlook.office.com/calendar",
    icon: "/integrations/outlook-calendar.svg",
    baseReason: "Meeting context from Microsoft calendars.",
    keywords: ["calendar", "meeting", "microsoft", "enterprise", "demo"],
  },
  {
    id: "slack",
    name: "Slack",
    url: "https://slack.com",
    icon: "/integrations/slack.svg",
    baseReason: "Route approvals and team updates.",
    keywords: ["slack", "team", "ops", "operations", "alerts", "approval"],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    url: "https://www.hubspot.com",
    icon: "/integrations/hubspot.svg",
    baseReason: "CRM stage, owner, and account history.",
    keywords: ["crm", "hubspot", "sales", "pipeline", "customer", "revenue"],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    url: "https://www.salesforce.com",
    icon: "/integrations/salesforce.svg",
    baseReason: "Enterprise CRM records and opportunity data.",
    keywords: ["crm", "salesforce", "enterprise", "pipeline", "opportunity", "customer"],
  },
  {
    id: "notion",
    name: "Notion",
    url: "https://www.notion.so",
    icon: "/integrations/notion.svg",
    baseReason: "Playbooks, briefs, and shared account notes.",
    keywords: ["notion", "docs", "knowledge", "playbook", "brief", "operations"],
  },
  {
    id: "google_sheets",
    name: "Google Sheets",
    url: "https://sheets.google.com",
    icon: "/integrations/google-sheets.svg",
    baseReason: "Lists, enrichment tables, and batch runs.",
    keywords: ["spreadsheet", "sheet", "list", "enrichment", "reporting", "operations"],
  },
  {
    id: "google_docs",
    name: "Google Docs",
    url: "https://docs.google.com",
    icon: "/integrations/google-docs.svg",
    baseReason: "Write briefs, proposals, and handoff docs.",
    keywords: ["docs", "proposal", "brief", "document", "handoff"],
  },
  {
    id: "google_drive",
    name: "Google Drive",
    url: "https://drive.google.com",
    icon: "/integrations/google-drive.svg",
    baseReason: "Retrieve source files and store generated assets.",
    keywords: ["drive", "files", "assets", "docs", "shared"],
  },
  {
    id: "airtable",
    name: "Airtable",
    url: "https://www.airtable.com",
    icon: "/integrations/airtable.svg",
    baseReason: "Structured workflow databases and lightweight CRM tables.",
    keywords: ["airtable", "database", "table", "workflow", "operations"],
  },
  {
    id: "linear",
    name: "Linear",
    url: "https://linear.app",
    icon: "/integrations/linear.svg",
    baseReason: "Product work, issue tracking, and implementation loops.",
    keywords: ["linear", "product", "engineering", "issue", "roadmap"],
  },
  {
    id: "github",
    name: "GitHub",
    url: "https://github.com",
    icon: "/integrations/github.svg",
    baseReason: "Technical workflows, repository context, and implementation work.",
    keywords: ["github", "engineering", "developer", "code", "repository"],
  },
];

const INTEGRATION_RECOMMENDATION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "audit_tool_hypotheses",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["tool_hypotheses"],
      properties: {
        tool_hypotheses: {
          type: "array",
          minItems: 6,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["importanceScore", "toolType", "toolUse", "whyLikely", "commonTools"],
            properties: {
              importanceScore: {
                type: "integer",
                minimum: 1,
                maximum: 10,
              },
              toolType: { type: "string" },
              toolUse: { type: "string" },
              whyLikely: { type: "string" },
              commonTools: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "url"],
                  properties: {
                    name: { type: "string" },
                    url: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const AGENT_RECOMMENDATION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "audit_agent_recommendations",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["agent_recommendations"],
      properties: {
        agent_recommendations: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "id",
              "name",
              "badge",
              "emoji",
              "description",
              "timeSaved",
              "integrationCount",
              "impactMetric",
              "tools",
            ],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              badge: { type: "string", enum: ["High ROI", "Quick win"] },
              emoji: { type: "string" },
              description: { type: "string" },
              timeSaved: { type: "string" },
              integrationCount: { type: "string" },
              impactMetric: { type: "string" },
              tools: {
                type: "array",
                minItems: 2,
                maxItems: 6,
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const COMPANY_PROFILE_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "audit_company_profile",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["company_profile"],
      properties: {
        company_profile: {
          type: "object",
          additionalProperties: false,
          required: ["name", "tagline", "description", "brand_voice", "color_palette"],
          properties: {
            name: { type: ["string", "null"] },
            tagline: { type: ["string", "null"] },
            description: { type: ["string", "null"] },
            brand_voice: {
              type: "array",
              maxItems: 4,
              items: { type: "string" },
            },
            color_palette: {
              type: "array",
              maxItems: 6,
              items: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

const PERSON_PROFILE_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "audit_person_profile",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["person_profile"],
      properties: {
        person_profile: {
          type: "object",
          additionalProperties: false,
          required: ["full_name", "job_title", "description", "talking_points"],
          properties: {
            full_name: { type: ["string", "null"] },
            job_title: { type: ["string", "null"] },
            description: { type: ["string", "null"] },
            talking_points: {
              type: "array",
              maxItems: 4,
              items: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

function buildLinkedInContext(linkedin: LinkedInProfileResult): string {
  return JSON.stringify(
    {
      profileUrl: linkedin.profileUrl,
      rawProfile: linkedin.raw,
      displayFallbacks: {
        fullName: linkedin.fullName,
        headline: linkedin.headline,
        jobTitle: linkedin.jobTitle,
        company: linkedin.company,
        location: linkedin.location,
        summary: linkedin.summary,
        currentCompany: linkedin.currentCompany,
      },
    },
    null,
    2,
  );
}

function fallbackPersonProfile(linkedin: LinkedInProfileResult): AuditPersonProfile {
  const talkingPoints = [
    roleTalkingPoint(linkedin),
    companyTalkingPoint(linkedin),
    locationTalkingPoint(linkedin),
    industryTalkingPoint(linkedin),
  ].filter((item): item is string => Boolean(item));

  return {
    full_name: trimOrNull(linkedin.fullName),
    job_title: firstTrimmed(linkedin.jobTitle, linkedin.headline),
    description: firstTrimmed(linkedin.summary, linkedin.headline),
    talking_points: talkingPoints.slice(0, 4),
  };
}

function roleTalkingPoint(linkedin: LinkedInProfileResult): string | null {
  return linkedin.jobTitle ? `Current role: ${linkedin.jobTitle}` : null;
}

function companyTalkingPoint(linkedin: LinkedInProfileResult): string | null {
  if (linkedin.currentCompany?.name) {
    return `Current company: ${linkedin.currentCompany.name}`;
  }
  return linkedin.company ? `Company: ${linkedin.company}` : null;
}

function locationTalkingPoint(linkedin: LinkedInProfileResult): string | null {
  return linkedin.location ? `Location: ${linkedin.location}` : null;
}

function industryTalkingPoint(linkedin: LinkedInProfileResult): string | null {
  return linkedin.currentCompany?.industry ? `Industry: ${linkedin.currentCompany.industry}` : null;
}

function trimOrNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function firstTrimmed(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function normalizePersonProfile(
  raw: AuditPersonProfile | undefined,
  linkedin: LinkedInProfileResult,
): AuditPersonProfile {
  const fallback = fallbackPersonProfile(linkedin);
  if (!raw) {
    return fallback;
  }

  const talkingPoints = raw.talking_points
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    full_name: raw.full_name?.trim() || fallback.full_name,
    job_title: raw.job_title?.trim() || fallback.job_title,
    description: raw.description?.trim() || fallback.description,
    talking_points: talkingPoints.length > 0 ? talkingPoints : fallback.talking_points,
  };
}

async function describePersonWithOpenAI(
  linkedin: LinkedInProfileResult,
): Promise<AuditPersonProfile> {
  const prompt = buildAuditPersonProfilePrompt({
    linkedinContext: buildLinkedInContext(linkedin),
  });
  const parsed = await createStructuredAuditCompletion<{
    person_profile?: AuditPersonProfile;
  }>(prompt, PERSON_PROFILE_RESPONSE_FORMAT, "Person profile service");
  return normalizePersonProfile(parsed.person_profile, linkedin);
}

async function enrichLinkedInForAudit(
  linkedin: LinkedInProfileResult,
): Promise<EnrichedLinkedInProfileResult> {
  try {
    return {
      ...linkedin,
      personProfile: await describePersonWithOpenAI(linkedin),
    };
  } catch (error) {
    console.error("Person profile service failed:", error);
    return {
      ...linkedin,
      personProfile: fallbackPersonProfile(linkedin),
    };
  }
}

function buildWebsiteContext(input: {
  companyUrl: string;
  website: Awaited<ReturnType<typeof scrapeWebsite>>;
}): string {
  return JSON.stringify(
    {
      companyUrl: input.companyUrl,
      website: {
        url: input.website.url,
        rawWebsite: input.website.raw,
        displayFallbacks: {
          title: input.website.title,
          description: input.website.description,
          detectedColors: input.website.detectedColors,
          markdownExcerpt: input.website.markdown.slice(0, 5000),
        },
      },
    },
    null,
    2,
  );
}

function normalizeCompanyProfile(
  raw: AuditCompanyProfile | undefined,
  website: Awaited<ReturnType<typeof scrapeWebsite>>,
): AuditCompanyProfile | null {
  if (!raw) {
    return null;
  }

  const colorSet = new Set(website.detectedColors.map((color) => color.toLowerCase()));
  return {
    name: raw.name?.trim() || website.title,
    tagline: raw.tagline?.trim() || null,
    description: raw.description?.trim() || website.description,
    brand_voice: raw.brand_voice
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4),
    color_palette: raw.color_palette
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/.test(item))
      .filter((item) => colorSet.size === 0 || colorSet.has(item))
      .slice(0, 6),
  };
}

async function describeCompanyWithOpenAI(input: {
  companyUrl: string;
  website: Awaited<ReturnType<typeof scrapeWebsite>>;
}): Promise<AuditCompanyProfile | null> {
  const prompt = buildAuditCompanyProfilePrompt({
    websiteContext: buildWebsiteContext(input),
  });
  const parsed = await createStructuredAuditCompletion<{
    company_profile?: AuditCompanyProfile;
  }>(prompt, COMPANY_PROFILE_RESPONSE_FORMAT, "Company profile service");
  return normalizeCompanyProfile(parsed.company_profile, input.website);
}

async function enrichWebsiteForAudit(input: {
  companyUrl: string;
  website: Awaited<ReturnType<typeof scrapeWebsite>>;
}): Promise<AuditWebsiteResult> {
  try {
    return {
      ...input.website,
      companyProfile: await describeCompanyWithOpenAI(input),
    };
  } catch (error) {
    console.error("Company profile service failed:", error);
    return {
      ...input.website,
      companyProfile: null,
    };
  }
}

function buildProfileContext(input: {
  email: string;
  linkedinUrl: string;
  companyUrl: string;
  linkedin: AuditLinkedInProfileContext;
  website: AuditWebsiteResult;
}): string {
  return JSON.stringify(
    {
      email: input.email,
      linkedinUrl: input.linkedinUrl,
      companyUrl: input.companyUrl,
      linkedin: input.linkedin,
      website: {
        url: input.website.url,
        title: input.website.title,
        description: input.website.description,
        companyProfile: input.website.companyProfile,
        rawWebsite: input.website.raw,
        detectedColors: input.website.detectedColors,
        markdownExcerpt: input.website.markdown.slice(0, 5000),
      },
    },
    null,
    2,
  );
}

function auditWebsiteFromInput(website: z.infer<typeof websiteScrapeResultSchema>): AuditWebsiteResult {
  return {
    ...website,
    companyProfile: website.companyProfile ?? null,
  };
}

function auditLinkedInFromInput(
  linkedin: z.infer<typeof linkedInProfileSchema>,
): EnrichedLinkedInProfileResult {
  return {
    ...linkedin,
    personProfile: linkedin.personProfile ?? null,
  };
}

async function getConnectedIntegrationTypes(
  integrationQuery: IntegrationQueryReader,
  userId: string,
): Promise<string[]> {
  const connectedIntegrations = await integrationQuery.findMany({
    where: eq(integration.userId, userId),
    columns: {
      type: true,
      enabled: true,
      authStatus: true,
    },
  });
  return connectedIntegrations.filter(isConnectedIntegration).map((item) => item.type);
}

async function prepareAuditRecommendationContext(
  input: AuditContextInput,
  integrationQuery: IntegrationQueryReader,
  userId: string,
): Promise<{
  website: AuditWebsiteResult;
  linkedin: EnrichedLinkedInProfileResult;
  connectedIntegrationTypes: string[];
}> {
  return {
    website: auditWebsiteFromInput(input.website),
    linkedin: auditLinkedInFromInput(input.linkedin),
    connectedIntegrationTypes: await getConnectedIntegrationTypes(integrationQuery, userId),
  };
}

function prepareAuditRecommendationContextForHandler(
  input: AuditContextInput,
  context: AuditHandlerContext,
) {
  return prepareAuditRecommendationContext(input, context.db.query.integration, context.user.id);
}

function isConnectedIntegration(item: ConnectedIntegrationRow): boolean {
  return item.enabled && item.authStatus === "connected";
}

function normalizeOpenAIRecommendations(input: {
  rawRecommendations: AuditIntegrationRecommendationOutput[];
  connectedIntegrationTypes: string[];
}): AuditIntegrationRecommendation[] {
  const knownCandidatesById = new Map(
    AUDIT_INTEGRATION_CANDIDATES.map((candidate) => [candidate.id, candidate]),
  );
  const connected = new Set(input.connectedIntegrationTypes);
  const connectedNames = getConnectedIntegrationNames(input.connectedIntegrationTypes);
  const seen = new Set<string>();
  const normalized: AuditIntegrationRecommendation[] = [];

  for (const raw of input.rawRecommendations) {
    const recommendation = normalizeOpenAIRecommendation({
      raw,
      knownCandidatesById,
      connected,
      connectedNames,
    });
    if (!recommendation || seen.has(recommendation.id)) {
      continue;
    }
    seen.add(recommendation.id);
    normalized.push(recommendation);
  }

  if (normalized.length === 0) {
    throw new Error("Integration recommendation agent returned no usable tool hypotheses");
  }

  return normalized.toSorted((a, b) => b.importanceScore - a.importanceScore).slice(0, 8);
}

function normalizeOpenAIRecommendation({
  raw,
  knownCandidatesById,
  connected,
  connectedNames,
}: {
  raw: AuditIntegrationRecommendationOutput;
  knownCandidatesById: Map<string, (typeof AUDIT_INTEGRATION_CANDIDATES)[number]>;
  connected: Set<string>;
  connectedNames: Set<string>;
}): AuditIntegrationRecommendation | null {
  const base = getRecommendationBase(raw);
  if (!base) {
    return null;
  }

  const primaryTool = base.commonTools[0];
  const knownCandidate = findKnownCandidate(knownCandidatesById, primaryTool.name, base.toolType);
  const whyLikely = raw.whyLikely?.trim() || "Likely from profile and website signals.";

  return {
    id: base.id,
    name: base.toolType,
    url: primaryTool.url,
    icon: knownCandidate?.icon,
    reason: whyLikely,
    importanceScore: clampImportanceScore(raw.importanceScore),
    toolType: base.toolType,
    toolUse: base.toolUse,
    whyLikely,
    commonTools: base.commonTools,
    customTools: [],
    connected: hasConnectedTool(base.commonTools, connected, connectedNames),
    selected: false,
  };
}

function getRecommendationBase(raw: AuditIntegrationRecommendationOutput): {
  id: string;
  toolType: string;
  toolUse: string;
  commonTools: AuditIntegrationRecommendation["commonTools"];
} | null {
  const toolType = raw.toolType?.trim();
  const toolUse = raw.toolUse?.trim();
  const commonTools = normalizeCommonTools(raw.commonTools);
  const id = toolType ? slugifyIntegrationId(toolType) : "";
  return toolType && toolUse && commonTools.length > 0 && id
    ? { id, toolType, toolUse, commonTools }
    : null;
}

function findKnownCandidate(
  knownCandidatesById: Map<string, (typeof AUDIT_INTEGRATION_CANDIDATES)[number]>,
  primaryToolName: string,
  toolType: string,
) {
  return (
    knownCandidatesById.get(slugifyIntegrationId(primaryToolName)) ??
    knownCandidatesById.get(slugifyIntegrationId(toolType))
  );
}

function hasConnectedTool(
  commonTools: AuditIntegrationRecommendation["commonTools"],
  connected: Set<string>,
  connectedNames: Set<string>,
): boolean {
  return commonTools.some(
    (tool) =>
      connected.has(slugifyIntegrationId(tool.name)) ||
      connectedNames.has(normalizeIntegrationName(tool.name)),
  );
}

function clampImportanceScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.min(10, Math.max(1, Math.round(value)));
}

function getConnectedIntegrationNames(connectedIntegrationTypes: string[]): Set<string> {
  const knownCandidatesById = new Map(
    AUDIT_INTEGRATION_CANDIDATES.map((candidate) => [candidate.id, candidate]),
  );
  return new Set(
    connectedIntegrationTypes
      .map((type) => knownCandidatesById.get(type)?.name)
      .filter((name): name is string => Boolean(name))
      .map(normalizeIntegrationName),
  );
}

function normalizeCommonTools(
  commonTools: AuditIntegrationRecommendationOutput["commonTools"],
): AuditIntegrationRecommendation["commonTools"] {
  const seen = new Set<string>();
  const normalized: AuditIntegrationRecommendation["commonTools"] = [];
  for (const tool of commonTools) {
    const name = tool.name?.trim();
    const url = normalizeIntegrationUrl(tool.url);
    const key = name ? normalizeIntegrationName(name) : "";
    if (!name || !url || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ name, url });
    if (normalized.length >= 5) {
      break;
    }
  }
  return normalized;
}

function slugifyIntegrationId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeIntegrationUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeIntegrationName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function recommendAuditIntegrationsWithOpenAI(input: {
  email: string;
  linkedinUrl: string;
  linkedin: AuditLinkedInProfileContext;
  companyUrl: string;
  website: AuditWebsiteResult;
  connectedIntegrationTypes: string[];
}): Promise<AuditIntegrationRecommendation[]> {
  const prompt = buildAuditIntegrationRecommenderPrompt({
    profileContext: buildProfileContext(input),
    connectedIntegrations: JSON.stringify(input.connectedIntegrationTypes, null, 2),
  });
  const parsed = await createStructuredAuditCompletion<{
    tool_hypotheses?: AuditIntegrationRecommendationOutput[];
  }>(prompt, INTEGRATION_RECOMMENDATION_RESPONSE_FORMAT, "Integration recommendation agent");
  if (!Array.isArray(parsed.tool_hypotheses)) {
    throw new Error("Integration recommendation agent did not return tool_hypotheses");
  }

  return normalizeOpenAIRecommendations({
    rawRecommendations: parsed.tool_hypotheses,
    connectedIntegrationTypes: input.connectedIntegrationTypes,
  });
}

function normalizeAgentRecommendations(input: {
  rawRecommendations: AuditAgentRecommendation[];
}): AuditAgentRecommendation[] {
  const normalized: AuditAgentRecommendation[] = input.rawRecommendations
    .filter((item) => item.name && item.description && item.tools.length > 0)
    .slice(0, 4)
    .map((item, index) => ({
      id: item.id || `agent-${index + 1}`,
      name: item.name,
      badge: item.badge === "Quick win" ? "Quick win" : "High ROI",
      emoji: item.emoji || "🤖",
      description: item.description,
      timeSaved: item.timeSaved,
      integrationCount: item.integrationCount,
      impactMetric: item.impactMetric,
      tools: item.tools.slice(0, 6),
    }));

  if (normalized.length !== 4) {
    throw new Error("Agent recommendation service returned no usable agent recommendations");
  }

  return normalized;
}

async function recommendAuditAgentsWithOpenAI(input: {
  email: string;
  linkedinUrl: string;
  linkedin: AuditLinkedInProfileContext;
  companyUrl: string;
  website: AuditWebsiteResult;
  integrationRecommendations: AuditIntegrationRecommendation[];
}): Promise<AuditAgentRecommendation[]> {
  const prompt = buildAuditAgentRecommenderPrompt({
    profileContext: buildProfileContext(input),
    integrationRecommendations: JSON.stringify(input.integrationRecommendations, null, 2),
  });
  const parsed = await createStructuredAuditCompletion<{
    agent_recommendations?: AuditAgentRecommendation[];
  }>(prompt, AGENT_RECOMMENDATION_RESPONSE_FORMAT, "Agent recommendation service");
  if (!Array.isArray(parsed.agent_recommendations)) {
    throw new Error("Agent recommendation service did not return agent_recommendations");
  }

  return normalizeAgentRecommendations({
    rawRecommendations: parsed.agent_recommendations,
  });
}

async function createStructuredAuditCompletion<T>(
  prompt: string,
  responseFormat: AuditStructuredResponseFormat,
  serviceName: string,
): Promise<T> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: AUDIT_STRUCTURED_OUTPUT_MODEL,
    messages: [
      {
        role: "system",
        content: "Return only data matching the supplied JSON schema.",
      },
      { role: "user", content: prompt },
    ],
    response_format: responseFormat,
  });
  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error(`${serviceName} returned an empty response`);
  }

  return JSON.parse(content) as T;
}

type AuditStructuredResponseFormat =
  | typeof PERSON_PROFILE_RESPONSE_FORMAT
  | typeof COMPANY_PROFILE_RESPONSE_FORMAT
  | typeof INTEGRATION_RECOMMENDATION_RESPONSE_FORMAT
  | typeof AGENT_RECOMMENDATION_RESPONSE_FORMAT;

/** Pick the company website URL from the submitted work email so it can be crawled immediately. */
function deriveCompanyUrl(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase().trim() ?? "";
  if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
    return `https://${domain}`;
  }
  return domain ? `https://${domain}` : "https://example.com";
}

const scrapeLinkedIn = protectedProcedure
  .input(
    z.object({
      linkedinUrl: z.string().url(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    try {
      const linkedin = await scrapeLinkedInProfile(input.linkedinUrl);
      return {
        linkedin: await enrichLinkedInForAudit(linkedin),
      };
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message: `LinkedIn scrape (Apify) failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

const scrapeCompanyWebsite = protectedProcedure
  .input(
    z.object({
      email: z.string().email(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    const companyUrl = deriveCompanyUrl(input.email);
    try {
      const website = await scrapeWebsite(companyUrl);
      return {
        companyUrl,
        website: await enrichWebsiteForAudit({ companyUrl, website }),
      };
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Website scrape (Firecrawl) failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

const toolSurvey = protectedProcedure
  .input(auditContextInputSchema)
  .handler(async ({ input, context }) => {
    await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    const recommendationContext = await prepareAuditRecommendationContextForHandler(input, context);

    try {
      return {
        integrationRecommendations: await recommendAuditIntegrationsWithOpenAI({
          email: input.email,
          linkedinUrl: input.linkedinUrl,
          linkedin: recommendationContext.linkedin,
          companyUrl: input.companyUrl,
          website: recommendationContext.website,
          connectedIntegrationTypes: recommendationContext.connectedIntegrationTypes,
        }),
        toolSurveyError: null,
      };
    } catch (error) {
      console.error("Tool survey service failed:", error);
      return {
        integrationRecommendations: [],
        toolSurveyError: error instanceof Error ? error.message : String(error),
      };
    }
  });

const recommend = protectedProcedure
  .input(
    auditContextInputSchema.extend({
      integrationRecommendations: z.array(auditIntegrationRecommendationSchema).optional(),
      toolSurveyError: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    const recommendationContext = await prepareAuditRecommendationContextForHandler(input, context);
    let integrationRecommendations: AuditIntegrationRecommendation[] =
      input.integrationRecommendations ?? [];
    let toolSurveyError: string | null = input.toolSurveyError ?? null;
    if (input.integrationRecommendations === undefined) {
      try {
        integrationRecommendations = await recommendAuditIntegrationsWithOpenAI({
          email: input.email,
          linkedinUrl: input.linkedinUrl,
          linkedin: recommendationContext.linkedin,
          companyUrl: input.companyUrl,
          website: recommendationContext.website,
          connectedIntegrationTypes: recommendationContext.connectedIntegrationTypes,
        });
      } catch (error) {
        console.error("Integration recommendation service failed:", error);
        toolSurveyError = error instanceof Error ? error.message : String(error);
      }
    }
    try {
      const agentRecommendations = await recommendAuditAgentsWithOpenAI({
        email: input.email,
        linkedinUrl: input.linkedinUrl,
        linkedin: recommendationContext.linkedin,
        companyUrl: input.companyUrl,
        website: recommendationContext.website,
        integrationRecommendations,
      });
      return {
        integrationRecommendations,
        toolSurveyError,
        agentRecommendations,
      };
    } catch (error) {
      console.error("Agent recommendation service failed:", error);
      throw new ORPCError("BAD_REQUEST", {
        message: `Agent recommendation service failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

const start = protectedProcedure
  .input(
    z.object({
      email: z.string().email(),
      linkedinUrl: z.string().url(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    const companyUrl = deriveCompanyUrl(input.email);
    const linkedinPromise = scrapeLinkedInProfile(input.linkedinUrl).catch((error) => {
      throw new ORPCError("BAD_REQUEST", {
        message: `LinkedIn scrape (Apify) failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
    const websitePromise = scrapeWebsite(companyUrl).catch((error) => {
      throw new ORPCError("BAD_REQUEST", {
        message: `Website scrape (Firecrawl) failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
    const [scrapedLinkedin, scrapedWebsite] = await Promise.all([linkedinPromise, websitePromise]);
    const [linkedin, website] = await Promise.all([
      enrichLinkedInForAudit(scrapedLinkedin),
      enrichWebsiteForAudit({ companyUrl, website: scrapedWebsite }),
    ]);

    const connectedIntegrationTypes = await getConnectedIntegrationTypes(
      context.db.query.integration,
      context.user.id,
    );
    let integrationRecommendations: AuditIntegrationRecommendation[] = [];
    let toolSurveyError: string | null = null;
    try {
      integrationRecommendations = await recommendAuditIntegrationsWithOpenAI({
        email: input.email,
        linkedinUrl: input.linkedinUrl,
        linkedin,
        companyUrl,
        website,
        connectedIntegrationTypes,
      });
    } catch (error) {
      console.error("Integration recommendation service failed:", error);
      toolSurveyError = error instanceof Error ? error.message : String(error);
    }
    return {
      runId: "",
      generationId: "",
      conversationId: "",
      agents: [],
      companyUrl,
      linkedin,
      website,
      integrationRecommendations,
      toolSurveyError,
    };
  });

export const agenticAuditRouter = {
  scrapeLinkedIn,
  scrapeCompanyWebsite,
  toolSurvey,
  recommend,
  start,
};
