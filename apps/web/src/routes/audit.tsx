import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Globe, Loader2, Send } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AuthenticatedAppRootShell } from "@/components/authenticated-app-root-shell";
import { Button } from "@/components/ui/button";
import type { AuditIntegrationRecommendation } from "@/lib/agentic-audit-types";
import { requireSession } from "@/lib/route-guards";
import {
  useRecommendAgenticAudit,
  useRecommendAgenticAuditToolSurvey,
  useScrapeAuditCompanyWebsite,
  useScrapeAuditLinkedIn,
} from "@/orpc/hooks/agentic-audit";
import { useGeneration } from "@/orpc/hooks/generation";

export const Route = createFileRoute("/audit")({
  beforeLoad: async ({ location }) => ({
    sessionContext: await requireSession(location.href),
  }),
  head: () => ({ meta: [{ title: "Agentic Audit - Bap" }] }),
  component: AgenticAuditPage,
});

type AuditResult = {
  runId?: string;
  generationId?: string;
  conversationId?: string;
  agents: AgentRun[];
  companyUrl?: string;
  linkedin?: {
    profileUrl: string;
    fullName: string | null;
    headline: string | null;
    jobTitle: string | null;
    company: string | null;
    location: string | null;
    summary: string | null;
    profileImageUrl: string | null;
    raw: Record<string, unknown>;
    personProfile?: PersonProfile | null;
    currentCompany: {
      name: string | null;
      website: string | null;
      industry: string | null;
      description: string | null;
      employeeCount: string | null;
      linkedinUrl: string | null;
      logoUrl: string | null;
    } | null;
  };
  website?: {
    url: string;
    title: string | null;
    description: string | null;
    detectedColors: string[];
    markdown: string;
    raw: Record<string, unknown>;
    companyProfile?: CompanyProfile | null;
  };
  integrationRecommendations?: IntegrationRecommendation[];
  toolSurveyError?: string | null;
  agentRecommendations?: AgentRecommendation[];
};

type AgentRun = {
  key: string;
  name: string;
  username: string;
  runId: string;
  generationId: string;
  conversationId: string;
};

type CompanyProfile = {
  name: string | null;
  tagline: string | null;
  description: string | null;
  brand_voice: string[];
  color_palette: string[];
};

type PersonProfile = {
  full_name: string | null;
  job_title: string | null;
  description: string | null;
  talking_points: string[];
};

type IntegrationRecommendation = AuditIntegrationRecommendation;
type AgentRecommendation = {
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
type AuditStepId = "linkedin" | "website" | "integrations" | "agents";
type RecommendedIntegrationId =
  | "linkedin"
  | "google_gmail"
  | "outlook"
  | "google_calendar"
  | "outlook_calendar"
  | "slack"
  | "hubspot"
  | "salesforce"
  | "notion"
  | "google_sheets"
  | "google_docs"
  | "google_drive"
  | "airtable"
  | "linear"
  | "github";

const AUDIT_STEPS: Array<{ id: AuditStepId; label: string; description: string }> = [
  {
    id: "website",
    label: "Website",
    description: "Brand and positioning context",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    description: "Person and company profile",
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Connected tools used for the run",
  },
  {
    id: "agents",
    label: "Agent recommendations",
    description: "Highest-value agents to deploy first",
  },
];

const AUDITOR_AVATAR_SRC = "/bap_detective.png";
const TOTAL_AUDIT_STEPS = AUDIT_STEPS.length + 1;
const COWORKER_AVATAR_SRCS = [
  "/assets/brick-costumes/bap-brick-01-undercover.png",
  "/assets/brick-costumes/bap-brick-06-spy.png",
  "/assets/brick-costumes/bap-brick-09-professor.png",
  "/assets/brick-costumes/bap-brick-10-magician.png",
];

const INTEGRATION_DETAILS: Record<
  RecommendedIntegrationId,
  Pick<IntegrationRecommendation, "id" | "name" | "url" | "icon" | "reason">
> = {
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    url: "https://www.linkedin.com",
    icon: "/integrations/linkedin.svg",
    reason: "Profile, role, and company context.",
  },
  google_gmail: {
    id: "google_gmail",
    name: "Gmail",
    url: "https://mail.google.com",
    icon: "/integrations/google-gmail.svg",
    reason: "Draft outreach and follow-up emails.",
  },
  outlook: {
    id: "outlook",
    name: "Outlook",
    url: "https://outlook.office.com",
    icon: "/integrations/outlook.svg",
    reason: "Draft email from Microsoft work accounts.",
  },
  google_calendar: {
    id: "google_calendar",
    name: "Google Calendar",
    url: "https://calendar.google.com",
    icon: "/integrations/google-calendar.svg",
    reason: "Meeting timing, reminders, and next steps.",
  },
  outlook_calendar: {
    id: "outlook_calendar",
    name: "Outlook Calendar",
    url: "https://outlook.office.com/calendar",
    icon: "/integrations/outlook-calendar.svg",
    reason: "Meeting context from Microsoft calendars.",
  },
  slack: {
    id: "slack",
    name: "Slack",
    url: "https://slack.com",
    icon: "/integrations/slack.svg",
    reason: "Route approvals and team updates.",
  },
  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    url: "https://www.hubspot.com",
    icon: "/integrations/hubspot.svg",
    reason: "CRM stage, owner, and account history.",
  },
  salesforce: {
    id: "salesforce",
    name: "Salesforce",
    url: "https://www.salesforce.com",
    icon: "/integrations/salesforce.svg",
    reason: "Enterprise CRM records and opportunity data.",
  },
  notion: {
    id: "notion",
    name: "Notion",
    url: "https://www.notion.so",
    icon: "/integrations/notion.svg",
    reason: "Playbooks, briefs, and shared account notes.",
  },
  google_sheets: {
    id: "google_sheets",
    name: "Google Sheets",
    url: "https://sheets.google.com",
    icon: "/integrations/google-sheets.svg",
    reason: "Lists, enrichment tables, and batch runs.",
  },
  google_docs: {
    id: "google_docs",
    name: "Google Docs",
    url: "https://docs.google.com",
    icon: "/integrations/google-docs.svg",
    reason: "Write briefs, proposals, and handoff docs.",
  },
  google_drive: {
    id: "google_drive",
    name: "Google Drive",
    url: "https://drive.google.com",
    icon: "/integrations/google-drive.svg",
    reason: "Retrieve source files and store generated assets.",
  },
  airtable: {
    id: "airtable",
    name: "Airtable",
    url: "https://www.airtable.com",
    icon: "/integrations/airtable.svg",
    reason: "Structured workflow databases and lightweight CRM tables.",
  },
  linear: {
    id: "linear",
    name: "Linear",
    url: "https://linear.app",
    icon: "/integrations/linear.svg",
    reason: "Product work, issue tracking, and implementation loops.",
  },
  github: {
    id: "github",
    name: "GitHub",
    url: "https://github.com",
    icon: "/integrations/github.svg",
    reason: "Technical workflows, repository context, and implementation work.",
  },
};

const EMPTY_INTEGRATION_RECOMMENDATIONS: IntegrationRecommendation[] = [];
const EMPTY_AGENT_RECOMMENDATIONS: AgentRecommendation[] = [];

function AgenticAuditPage() {
  const { sessionContext } = Route.useRouteContext();

  return (
    <AuthenticatedAppRootShell initialPrincipal={sessionContext.principal}>
      <AuditExperience />
    </AuthenticatedAppRootShell>
  );
}

function AuditExperience() {
  const [step, setStep] = useState<"form" | "running">("form");
  const [email, setEmail] = useState("louis@hyperstack.studio");
  const [linkedinUrl, setLinkedinUrl] = useState("https://www.linkedin.com/in/louis-adam1");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const websiteMutation = useScrapeAuditCompanyWebsite();
  const linkedinMutation = useScrapeAuditLinkedIn();
  const toolSurveyMutation = useRecommendAgenticAuditToolSurvey();
  const recommendMutation = useRecommendAgenticAudit();
  const formError = getAuditFormError({
    auditError,
    websiteError: websiteMutation.error,
    linkedinError: linkedinMutation.error,
    recommendError: recommendMutation.error,
  });

  const handleSubmit = useCallback(() => {
    const trimmedEmail = email.trim();
    const trimmedLinkedinUrl = linkedinUrl.trim();
    if (!trimmedEmail || !trimmedLinkedinUrl) {
      return;
    }
    setAuditError(null);
    setResult({ agents: [] });
    setStep("running");

    const websitePromise = websiteMutation.mutateAsync({ email: trimmedEmail }).then((data) => {
      setResult((current) => ({
        ...(current ?? { agents: [] }),
        companyUrl: data.companyUrl,
        website: data.website,
      }));
      return data;
    });

    const linkedinPromise = linkedinMutation
      .mutateAsync({ linkedinUrl: trimmedLinkedinUrl })
      .then((data) => {
        setResult((current) => ({
          ...(current ?? { agents: [] }),
          linkedin: data.linkedin,
        }));
        return data;
      });

    void Promise.all([websitePromise, linkedinPromise])
      .then(([websiteData, linkedinData]) =>
        toolSurveyMutation.mutateAsync({
          email: trimmedEmail,
          linkedinUrl: trimmedLinkedinUrl,
          companyUrl: websiteData.companyUrl,
          website: websiteData.website,
          linkedin: linkedinData.linkedin,
        }),
      )
      .then((toolSurvey) => {
        setResult((current) => ({
          ...(current ?? { agents: [] }),
          integrationRecommendations: toolSurvey.integrationRecommendations,
          toolSurveyError: toolSurvey.toolSurveyError,
        }));
      })
      .catch((error) => {
        setAuditError(error instanceof Error ? error.message : "Something went wrong.");
      });
  }, [email, linkedinMutation, linkedinUrl, toolSurveyMutation, websiteMutation]);
  const handleGenerateAgents = useCallback(
    async (selectedRecommendations: IntegrationRecommendation[]) => {
      const recommendationInput = getAgentRecommendationInput({
        email,
        linkedinUrl,
        result,
        selectedRecommendations,
      });
      if (!recommendationInput) {
        return;
      }

      setAuditError(null);
      setResult((current) =>
        current
          ? {
              ...current,
              integrationRecommendations: selectedRecommendations,
              agentRecommendations: undefined,
            }
          : current,
      );

      try {
        const data = await recommendMutation.mutateAsync(recommendationInput);
        setResult((current) => ({
          ...(current ?? { agents: [] }),
          integrationRecommendations: data.integrationRecommendations,
          toolSurveyError: data.toolSurveyError,
          agentRecommendations: data.agentRecommendations,
        }));
      } catch (error) {
        setAuditError(error instanceof Error ? error.message : "Something went wrong.");
      }
    },
    [email, linkedinUrl, recommendMutation, result],
  );

  return (
    <main className="bg-background flex h-[calc(100dvh-4rem-var(--safe-area-inset-bottom))] min-h-0 min-w-0 flex-col overflow-hidden md:h-dvh">
      <header className="bg-background/95 z-10 shrink-0 px-3 pt-[max(0.5rem,var(--safe-area-inset-top))] pb-2 backdrop-blur-sm md:px-6 md:py-3">
        <div className="flex min-h-10 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background">
            <img
              src={AUDITOR_AVATAR_SRC}
              alt="Agentic Auditor avatar"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base leading-tight font-semibold md:text-lg">
              Agentic Auditor
            </p>
            <p className="text-muted-foreground max-w-[48rem] truncate text-xs">
              Researches you and your company to help create tailored agentic workflow.
            </p>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-2 overflow-hidden px-0 pt-[max(0.25rem,var(--safe-area-inset-top))] pb-0 md:gap-4 md:px-6 md:pt-3 md:pb-6">
        {step === "form" ? (
          <AuditForm
            email={email}
            linkedinUrl={linkedinUrl}
            onEmailChange={setEmail}
            onLinkedinChange={setLinkedinUrl}
            onSubmit={handleSubmit}
            error={formError}
          />
        ) : null}
        {step === "running" ? (
          <AuditStepperPanel
            result={result}
            linkedinUrl={linkedinUrl}
            error={auditError}
            onGenerateAgents={handleGenerateAgents}
          />
        ) : null}
      </div>
    </main>
  );
}

function getAuditFormError({
  auditError,
  websiteError,
  linkedinError,
  recommendError,
}: {
  auditError: string | null;
  websiteError: unknown;
  linkedinError: unknown;
  recommendError: unknown;
}): string | null {
  return (
    auditError ??
    errorMessage(websiteError) ??
    errorMessage(linkedinError) ??
    errorMessage(recommendError)
  );
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

function getAgentRecommendationInput({
  email,
  linkedinUrl,
  result,
  selectedRecommendations,
}: {
  email: string;
  linkedinUrl: string;
  result: AuditResult | null;
  selectedRecommendations: IntegrationRecommendation[];
}): Parameters<ReturnType<typeof useRecommendAgenticAudit>["mutateAsync"]>[0] | null {
  const trimmedEmail = email.trim();
  const trimmedLinkedinUrl = linkedinUrl.trim();
  if (!hasAgentRecommendationInputs(trimmedEmail, trimmedLinkedinUrl, result)) {
    return null;
  }

  return buildAgentRecommendationInput(
    trimmedEmail,
    trimmedLinkedinUrl,
    result,
    selectedRecommendations,
  );
}

function buildAgentRecommendationInput(
  email: string,
  linkedinUrl: string,
  result: AuditResult & {
    companyUrl: string;
    linkedin: NonNullable<AuditResult["linkedin"]>;
    website: NonNullable<AuditResult["website"]>;
  },
  selectedRecommendations: IntegrationRecommendation[],
): Parameters<ReturnType<typeof useRecommendAgenticAudit>["mutateAsync"]>[0] {
  return {
    email,
    linkedinUrl,
    companyUrl: result.companyUrl,
    linkedin: {
      ...result.linkedin,
      personProfile: result.linkedin.personProfile ?? null,
    },
    website: {
      ...result.website,
      companyProfile: result.website.companyProfile ?? null,
    },
    integrationRecommendations: selectedRecommendations,
    toolSurveyError: result.toolSurveyError ?? null,
  };
}

function hasAgentRecommendationInputs(
  email: string,
  linkedinUrl: string,
  result: AuditResult | null,
): result is AuditResult & {
  companyUrl: string;
  linkedin: NonNullable<AuditResult["linkedin"]>;
  website: NonNullable<AuditResult["website"]>;
} {
  return hasContactInputs(email, linkedinUrl) && hasAuditContextInputs(result);
}

function hasContactInputs(email: string, linkedinUrl: string): boolean {
  return Boolean(email && linkedinUrl);
}

function hasAuditContextInputs(result: AuditResult | null): result is AuditResult & {
  companyUrl: string;
  linkedin: NonNullable<AuditResult["linkedin"]>;
  website: NonNullable<AuditResult["website"]>;
} {
  return Boolean(result?.companyUrl && result.linkedin && result.website);
}

function AuditForm({
  email,
  linkedinUrl,
  onEmailChange,
  onLinkedinChange,
  onSubmit,
  error,
}: {
  email: string;
  linkedinUrl: string;
  onEmailChange: (value: string) => void;
  onLinkedinChange: (value: string) => void;
  onSubmit: () => void;
  error: string | null;
}) {
  const handleFormSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      onSubmit();
    },
    [onSubmit],
  );
  const handleEmailInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onEmailChange(event.target.value),
    [onEmailChange],
  );
  const handleLinkedinInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onLinkedinChange(event.target.value),
    [onLinkedinChange],
  );

  return (
    <form
      className="bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      onSubmit={handleFormSubmit}
    >
      <div className="bg-background flex min-h-0 flex-1 flex-col">
        <WizardTopBar stepNumber={1} totalSteps={TOTAL_AUDIT_STEPS} label="Contact details" />

        <section className="min-h-0 flex-1 overflow-auto">
          <StepShell size="wide">
            <StepHeader
              eyebrow="Step 1"
              title="Share your contact details"
              description="Enter your email and LinkedIn profile. Our Agentic Auditor starts the audit right away and gives you results in minutes."
            />
            <div className="grid w-full items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(19rem,0.85fr)]">
              <div className="border-border/70 bg-card space-y-5 rounded-xl border p-5">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Work email</span>
                  <input
                    type="email"
                    required
                    aria-label="Work email"
                    value={email}
                    onChange={handleEmailInput}
                    placeholder="alex@acme.com"
                    className="bg-background focus:ring-ring/30 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">LinkedIn profile URL</span>
                  <input
                    type="url"
                    required
                    aria-label="LinkedIn profile URL"
                    value={linkedinUrl}
                    onChange={handleLinkedinInput}
                    placeholder="https://www.linkedin.com/in/alex"
                    className="bg-background focus:ring-ring/30 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2"
                  />
                </label>

                {error ? <p className="text-destructive text-sm">{error}</p> : null}
              </div>

              <AuditOutputPreview email={email} />
            </div>
            <WizardActions align="end">
              <Button type="submit" className="gap-2">
                Next
                <Send className="h-4 w-4" />
              </Button>
            </WizardActions>
          </StepShell>
        </section>
      </div>
    </form>
  );
}

function AuditOutputPreview({ email }: { email: string }) {
  const companyDomain = getDomainFromEmail(email);

  return (
    <aside className="border-border/70 bg-card flex flex-col rounded-xl border p-5">
      <div className="flex items-start gap-3">
        <div className="bg-background flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border">
          <img src={AUDITOR_AVATAR_SRC} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">What you&apos;ll get</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Agentic research that gathers context to create agents that help you work.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <PreviewRow
          visual="company"
          companyDomain={companyDomain}
          title="Company brief"
          description={
            companyDomain
              ? `${companyDomain} positioning, brand voice, and colors`
              : "Website positioning, brand voice, and colors"
          }
        />
        <PreviewRow
          visual="linkedin"
          title="Person profile"
          description="LinkedIn role, context, and useful talking points"
        />
        <PreviewRow
          visual="bap"
          title="Create agents"
          description="4 ready-to-use agents to automate the most boring tasks"
        />
      </div>
    </aside>
  );
}

function PreviewRow({
  visual,
  companyDomain,
  title,
  description,
}: {
  visual: "linkedin" | "company" | "bap";
  companyDomain?: string | null;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
        <PreviewVisual visual={visual} companyDomain={companyDomain} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function PreviewVisual({
  visual,
  companyDomain,
}: {
  visual: "linkedin" | "company" | "bap";
  companyDomain?: string | null;
}) {
  return <PreviewVisualContent visual={visual} companyDomain={companyDomain ?? null} />;
}

function PreviewVisualContent({
  visual,
  companyDomain,
}: {
  visual: "linkedin" | "company" | "bap";
  companyDomain: string | null;
}) {
  const visualByType: Record<typeof visual, ReactNode> = {
    linkedin: <LinkedInLogoMark />,
    company: <CompanyLogoMark domain={companyDomain} />,
    bap: <BapLogoMark />,
  };

  return visualByType[visual];
}

function LinkedInLogoMark() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0a66c2] text-[12px] font-bold text-white">
      in
    </span>
  );
}

function CompanyLogoMark({ domain }: { domain: string | null }) {
  if (!domain) {
    return <Globe className="text-muted-foreground h-4 w-4" />;
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      className="h-5 w-5 rounded-sm"
    />
  );
}

function BapLogoMark() {
  return <img src="/logo.png" alt="" className="h-5 w-5 rounded-sm object-contain" />;
}

function getPersonAvatarUrl(name: string, linkedinUrl?: string): string {
  const seed = linkedinUrl || name || "linkedin-profile";
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=0a66c2,d1d5db,e5e7eb&textColor=ffffff,111827&fontWeight=600`;
}

function getDomainFromEmail(email: string): string | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain && domain.includes(".") ? domain : null;
}

function getDomainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return (
      url
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0] || null
    );
  }
}

function getAuditAgents(result: AuditResult): AgentRun[] {
  const existingAgents = getExistingAuditAgents(result.agents);
  if (existingAgents.length > 0) {
    return existingAgents;
  }
  return result.generationId ? [getFallbackAuditAgent(result)] : [];
}

function getExistingAuditAgents(agents: AgentRun[]): AgentRun[] {
  return agents.filter((agent) => agent.generationId);
}

function getFallbackAuditAgent(result: AuditResult): AgentRun {
  return {
    key: "company-brain",
    name: "company brain",
    username: "audit-company-brain",
    runId: result.runId ?? "",
    generationId: result.generationId ?? "",
    conversationId: result.conversationId ?? "",
  };
}

function getIntegrationsWaitMessage(
  result: AuditResult | null,
  selectedToolCount: number,
): string | null {
  if (!result?.integrationRecommendations) {
    return "Waiting for recommendations";
  }
  return getReadyIntegrationsWaitMessage(result.toolSurveyError, selectedToolCount);
}

function getReadyIntegrationsWaitMessage(
  toolSurveyError: string | null | undefined,
  selectedToolCount: number,
): string | null {
  if (toolSurveyError) {
    return "Tool survey failed";
  }
  return selectedToolCount > 0 ? null : "Select tools";
}

function AuditStepperPanel({
  result,
  linkedinUrl,
  error,
  onGenerateAgents,
}: {
  result: AuditResult | null;
  linkedinUrl: string;
  error: string | null;
  onGenerateAgents: (selectedRecommendations: IntegrationRecommendation[]) => Promise<void>;
}) {
  const agents = useMemo(() => getResultAuditAgents(result), [result]);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [rawTextByAgent, setRawTextByAgent] = useState<Record<string, string>>({});
  const [selectedTools, setSelectedTools] = useState<Set<string>>(() => new Set());
  const [customToolsByCategory, setCustomToolsByCategory] = useState<Record<string, string>>({});
  const activeStep = getActiveAuditStep(activeStepIndex);
  const recommendations = getResultIntegrationRecommendations(result);
  const recommendationKey = recommendations
    .map((recommendation) => `${recommendation.id}:${recommendation.commonTools.length}`)
    .join(":");
  const selectedToolCount = getSelectedToolCount(selectedTools, customToolsByCategory);
  const selectedRecommendations = useMemo(
    () =>
      buildSelectedIntegrationRecommendations({
        recommendations,
        selectedTools,
        customToolsByCategory,
      }),
    [customToolsByCategory, recommendations, selectedTools],
  );
  const nextWaitMessage = getStepWaitMessage(activeStep.id, result, selectedToolCount);
  const nextDisabled = getNextDisabled(activeStepIndex, nextWaitMessage);

  useEffect(() => {
    setSelectedTools(new Set());
    setCustomToolsByCategory({});
  }, [recommendationKey]);

  const combinedRawText = useMemo(
    () => Object.values(rawTextByAgent).join("\n\n"),
    [rawTextByAgent],
  );
  const parsed = useMemo(() => parseCards(combinedRawText), [combinedRawText]);
  const handleAgentText = useCallback((agentKey: string, text: string) => {
    setRawTextByAgent((prev) => ({ ...prev, [agentKey]: text }));
  }, []);
  const handleBack = useCallback(() => {
    setActiveStepIndex((current) => Math.max(0, current - 1));
  }, []);
  const handleToggleTool = useCallback((toolName: string) => {
    const key = normalizeToolName(toolName);
    setSelectedTools((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  const handleCustomToolChange = useCallback((categoryId: string, value: string) => {
    setCustomToolsByCategory((current) => ({
      ...current,
      [categoryId]: value,
    }));
  }, []);
  const handleNext = useCallback(() => {
    if (!canAdvanceAuditStep(nextWaitMessage)) {
      return;
    }
    setActiveStepIndex(nextAuditStepIndex);
    if (shouldGenerateAgents(activeStep.id)) {
      void onGenerateAgents(selectedRecommendations);
    }
  }, [activeStep.id, nextWaitMessage, onGenerateAgents, selectedRecommendations]);

  return (
    <div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {agents.map((agent) => (
        <AgentStreamCollector
          key={agent.key}
          agentKey={agent.key}
          generationId={agent.generationId}
          onTextChange={handleAgentText}
        />
      ))}
      <div className="bg-background flex min-h-0 flex-1 flex-col">
        <WizardTopBar
          stepNumber={activeStepIndex + 2}
          totalSteps={TOTAL_AUDIT_STEPS}
          label={activeStep.label}
        />

        <section className="min-h-0 flex-1 overflow-auto">
          <StepShell size={activeStep.id === "agents" ? "wide" : "default"}>
            <AuditStepContent
              activeStep={activeStep.id}
              result={result}
              linkedinUrl={linkedinUrl}
              company={parsed.company}
              person={parsed.person}
              error={error}
              selectedTools={selectedTools}
              customToolsByCategory={customToolsByCategory}
              selectedToolCount={selectedToolCount}
              onToggleTool={handleToggleTool}
              onCustomToolChange={handleCustomToolChange}
            />
            <WizardActions>
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={activeStepIndex === 0}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                type="button"
                onClick={handleNext}
                disabled={nextDisabled}
                className="gap-2"
                aria-live={nextWaitMessage ? "polite" : undefined}
              >
                {nextWaitMessage ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {nextWaitMessage}
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </WizardActions>
          </StepShell>
        </section>
      </div>
    </div>
  );
}

function getResultAuditAgents(result: AuditResult | null): AgentRun[] {
  return result ? getAuditAgents(result) : [];
}

function getActiveAuditStep(activeStepIndex: number): (typeof AUDIT_STEPS)[number] {
  return AUDIT_STEPS[activeStepIndex] ?? AUDIT_STEPS[0];
}

function getResultIntegrationRecommendations(
  result: AuditResult | null,
): IntegrationRecommendation[] {
  return result?.integrationRecommendations ?? EMPTY_INTEGRATION_RECOMMENDATIONS;
}

function getSelectedToolCount(
  selectedTools: Set<string>,
  customToolsByCategory: Record<string, string>,
): number {
  return selectedTools.size + getCustomToolCount(customToolsByCategory);
}

function getCustomToolCount(customToolsByCategory: Record<string, string>): number {
  return Object.values(customToolsByCategory).filter(hasTextValue).length;
}

function hasTextValue(value: string): boolean {
  return value.trim().length > 0;
}

function getNextDisabled(activeStepIndex: number, nextWaitMessage: string | null): boolean {
  return isFinalAuditStep(activeStepIndex) || Boolean(nextWaitMessage);
}

function isFinalAuditStep(activeStepIndex: number): boolean {
  return activeStepIndex === AUDIT_STEPS.length - 1;
}

function canAdvanceAuditStep(nextWaitMessage: string | null): boolean {
  return !nextWaitMessage;
}

function nextAuditStepIndex(current: number): number {
  return Math.min(AUDIT_STEPS.length - 1, current + 1);
}

function shouldGenerateAgents(activeStep: AuditStepId): boolean {
  return activeStep === "integrations";
}

function getStepWaitMessage(
  activeStep: AuditStepId,
  result: AuditResult | null,
  selectedToolCount: number,
): string | null {
  const waitMessage = STEP_WAIT_MESSAGE_BY_ID[activeStep];
  return waitMessage(result, selectedToolCount);
}

const STEP_WAIT_MESSAGE_BY_ID: Record<
  AuditStepId,
  (result: AuditResult | null, selectedToolCount: number) => string | null
> = {
  website: (result) => (result?.website ? null : "Waiting for company"),
  linkedin: (result) => (result?.linkedin ? null : "Waiting for info"),
  integrations: getIntegrationsWaitMessage,
  agents: (result) => (result?.agentRecommendations ? null : "Waiting for recommendations"),
};

function WizardTopBar({
  stepNumber,
  totalSteps,
  label,
}: {
  stepNumber: number;
  totalSteps: number;
  label: string;
}) {
  const progress = `${(stepNumber / totalSteps) * 100}%`;
  const progressStyle = useMemo(() => ({ width: progress }), [progress]);

  return (
    <div className="border-border/70 relative flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3 md:px-6">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Step {stepNumber} of {totalSteps}
        </p>
        <p className="truncate text-sm font-semibold">{label}</p>
      </div>
      <div className="text-muted-foreground shrink-0 text-xs">
        {Math.round((stepNumber / totalSteps) * 100)}%
      </div>
      <div className="bg-muted absolute right-0 bottom-0 left-0 h-0.5" aria-hidden="true">
        <div
          className="bg-brand h-full transition-[width] duration-200 ease-out"
          style={progressStyle}
        />
      </div>
    </div>
  );
}

function AuditStepContent({
  activeStep,
  result,
  linkedinUrl,
  company,
  person,
  error,
  selectedTools,
  customToolsByCategory,
  selectedToolCount,
  onToggleTool,
  onCustomToolChange,
}: {
  activeStep: AuditStepId;
  result: AuditResult | null;
  linkedinUrl: string;
  company: CompanyProfile | null;
  person: PersonProfile | null;
  error: string | null;
  selectedTools: Set<string>;
  customToolsByCategory: Record<string, string>;
  selectedToolCount: number;
  onToggleTool: (toolName: string) => void;
  onCustomToolChange: (categoryId: string, value: string) => void;
}) {
  if (error) {
    return <AuditErrorState message={error} />;
  }

  const contentByStep: Record<AuditStepId, ReactNode> = {
    linkedin: <LinkedInStepContent result={result} person={person} linkedinUrl={linkedinUrl} />,
    website: <WebsiteStepContent result={result} company={company} />,
    integrations: (
      <IntegrationsStep
        result={result}
        selectedTools={selectedTools}
        customToolsByCategory={customToolsByCategory}
        selectedToolCount={selectedToolCount}
        onToggleTool={onToggleTool}
        onCustomToolChange={onCustomToolChange}
      />
    ),
    agents: <AgentRecommendationsStep result={result} />,
  };

  return contentByStep[activeStep];
}

function LinkedInStepContent({
  result,
  person,
  linkedinUrl,
}: {
  result: AuditResult | null;
  person: PersonProfile | null;
  linkedinUrl: string;
}) {
  if (!result?.linkedin) {
    return <LinkedInSearchLoader linkedinUrl={linkedinUrl} />;
  }

  return (
    <LinkedInStep
      linkedin={result.linkedin}
      person={result.linkedin.personProfile ?? person}
      linkedinUrl={linkedinUrl}
    />
  );
}

function WebsiteStepContent({
  result,
  company,
}: {
  result: AuditResult | null;
  company: CompanyProfile | null;
}) {
  if (!result?.website) {
    return <WebsiteSearchLoader />;
  }

  return <WebsiteStep website={result.website} companyUrl={result.companyUrl} company={company} />;
}

function AuditErrorState({ message }: { message: string }) {
  return (
    <>
      <StepHeader
        eyebrow="Audit paused"
        title="Something blocked this stage"
        description={message}
      />
      <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-4 text-sm">
        {message}
      </div>
    </>
  );
}

function StepHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{eyebrow}</p>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>
    </div>
  );
}

function StepShell({
  children,
  size = "default",
}: {
  children: ReactNode;
  size?: "default" | "wide";
}) {
  return (
    <div
      className={`mx-auto flex min-h-full w-full flex-col justify-center gap-5 px-4 py-8 md:px-6 md:py-10 ${
        size === "wide" ? "max-w-4xl" : "max-w-2xl"
      }`}
    >
      {children}
    </div>
  );
}

function WizardActions({
  children,
  align = "between",
}: {
  children: ReactNode;
  align?: "between" | "end";
}) {
  return (
    <div
      className={`flex items-center gap-3 pt-1 ${align === "end" ? "justify-end" : "justify-between"}`}
    >
      {children}
    </div>
  );
}

function LinkedInSearchLoader({ linkedinUrl }: { linkedinUrl: string }) {
  const domain = getDomainFromUrl(linkedinUrl) ?? "linkedin.com";
  const steps = useMemo(
    () => [
      { status: "active" as const, text: `Opening the LinkedIn profile on ${domain}...` },
      { status: "done" as const, text: "Profile found. Reading headline, role, and location." },
      {
        status: "active" as const,
        text: "Finding the current company and public profile summary...",
      },
      { status: "done" as const, text: "Person context captured for the workflow audit." },
      {
        status: "active" as const,
        text: "Connecting this role to relevant agent opportunities...",
      },
      { status: "done" as const, text: "LinkedIn signals are ready for review." },
    ],
    [domain],
  );

  return (
    <>
      <StepHeader
        eyebrow="Step 3"
        title="Searching LinkedIn"
        description="Agentic Auditor is finding the person profile and current company details."
      />
      <SearchProgressLoader
        visual="linkedin"
        title="Researching the person"
        subtitle={linkedinUrl}
        steps={steps}
      />
    </>
  );
}

function WebsiteSearchLoader() {
  const steps = useMemo(
    () => [
      { status: "active" as const, text: "Opening the company website..." },
      { status: "done" as const, text: "Page loaded. Reading product and positioning." },
      { status: "active" as const, text: "Extracting audience, offer, and workflow language..." },
      { status: "done" as const, text: "Company context captured for the audit." },
      { status: "active" as const, text: "Finding brand colors and page patterns..." },
      { status: "done" as const, text: "Website signals are ready for review." },
    ],
    [],
  );

  return (
    <>
      <StepHeader
        eyebrow="Step 2"
        title="Searching the company website"
        description="Agentic Auditor is reading the website to understand the company, brand, and workflow opportunities."
      />
      <SearchProgressLoader
        visual="website"
        title="Researching the company"
        subtitle="Website crawl and brand context"
        steps={steps}
      />
    </>
  );
}

type SearchProgressStep = {
  status: "active" | "done";
  text: string;
};

function SearchProgressLoader({
  visual,
  title,
  subtitle,
  steps,
}: {
  visual: "linkedin" | "website";
  title: string;
  subtitle: string;
  steps: SearchProgressStep[];
}) {
  const visibleCount = useVisibleProgressCount(steps.length);

  return (
    <div className="border-border/70 bg-background rounded-xl border p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="bg-background flex h-9 w-9 items-center justify-center rounded-full shadow-xs">
          <SearchProgressVisual visual={visual} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
        </div>
      </div>
      <ProgressStepList steps={steps} visibleCount={visibleCount} />
    </div>
  );
}

function SearchProgressVisual({ visual }: { visual: "linkedin" | "website" }) {
  return visual === "linkedin" ? (
    <LinkedInLogoMark />
  ) : (
    <Globe className="text-muted-foreground h-5 w-5" />
  );
}

function useVisibleProgressCount(stepCount: number): number {
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    setVisibleCount(1);
    const timers = Array.from({ length: Math.max(0, stepCount - 1) }, (_, index) =>
      window.setTimeout(() => setVisibleCount(index + 2), (index + 1) * 650),
    );
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [stepCount]);

  return visibleCount;
}

function ProgressStepList({
  steps,
  visibleCount,
}: {
  steps: SearchProgressStep[];
  visibleCount: number;
}) {
  return (
    <div className="space-y-2 font-mono text-xs">
      {steps.slice(0, visibleCount).map((step, index) => (
        <ProgressStepRow
          key={step.text}
          step={step}
          isLatest={index === visibleCount - 1 && visibleCount < steps.length}
        />
      ))}
    </div>
  );
}

function ProgressStepRow({ step, isLatest }: { step: SearchProgressStep; isLatest: boolean }) {
  const done = isCompletedProgressStep(step, isLatest);

  return (
    <div className="flex items-start gap-2 transition-opacity duration-200 ease-out">
      <span className={getProgressMarkerClass(done)}>{getProgressMarker(done)}</span>
      <span className={getProgressTextClass(done)}>{step.text}</span>
    </div>
  );
}

function isCompletedProgressStep(step: SearchProgressStep, isLatest: boolean): boolean {
  return step.status === "done" && !isLatest;
}

function getProgressMarkerClass(done: boolean): string {
  return done ? "text-brand" : "text-muted-foreground animate-pulse";
}

function getProgressMarker(done: boolean): string {
  return done ? "✓" : "→";
}

function getProgressTextClass(done: boolean): string {
  return done ? "" : "text-muted-foreground";
}

function LinkedInStep({
  linkedin,
  person,
  linkedinUrl,
}: {
  linkedin: NonNullable<AuditResult["linkedin"]>;
  person: PersonProfile | null;
  linkedinUrl: string;
}) {
  const personDisplay = getPersonDisplay(linkedin, person);

  return (
    <>
      <StepHeader
        eyebrow="Step 3"
        title="LinkedIn profile"
        description="Review the person and current company signals before the agent recommendations use them."
      />
      <PersonCard
        name={personDisplay.name}
        title={personDisplay.title}
        description={personDisplay.description}
        location={linkedin.location}
        profileImageUrl={linkedin.profileImageUrl}
        currentCompany={linkedin.currentCompany}
        talkingPoints={person?.talking_points}
        linkedinUrl={linkedinUrl}
      />
    </>
  );
}

function getPersonDisplay(
  linkedin: NonNullable<AuditResult["linkedin"]>,
  person: PersonProfile | null,
): {
  name: string;
  title?: string;
  description?: string;
} {
  return {
    name: getPersonName(linkedin, person),
    title: getPersonTitle(linkedin, person),
    description: getPersonDescription(linkedin, person),
  };
}

function getPersonName(
  linkedin: NonNullable<AuditResult["linkedin"]>,
  person: PersonProfile | null,
): string {
  return firstPresent([person?.full_name, linkedin.fullName]) ?? "Unknown";
}

function getPersonTitle(
  linkedin: NonNullable<AuditResult["linkedin"]>,
  person: PersonProfile | null,
): string | undefined {
  return firstPresent([person?.job_title, linkedin.jobTitle, linkedin.headline]);
}

function getPersonDescription(
  linkedin: NonNullable<AuditResult["linkedin"]>,
  person: PersonProfile | null,
): string | undefined {
  return firstPresent([person?.description, linkedin.summary]);
}

function WebsiteStep({
  website,
  companyUrl,
  company,
}: {
  website: NonNullable<AuditResult["website"]>;
  companyUrl?: string;
  company: CompanyProfile | null;
}) {
  const companyProfile = getCompanyProfile(company, website.companyProfile);
  const companyDisplay = getCompanyDisplay({ companyProfile, companyUrl, website });

  return (
    <>
      <StepHeader
        eyebrow="Step 2"
        title="Company website"
        description="The website crawl provides positioning, visual cues, and brand language for the agents."
      />
      <CompanyCard
        name={companyDisplay.name}
        tagline={companyDisplay.tagline}
        description={companyDisplay.description}
        brandVoice={companyProfile?.brand_voice}
        palette={companyDisplay.palette}
        url={website.url}
      />
    </>
  );
}

function getCompanyProfile(
  parsedCompany: CompanyProfile | null,
  websiteCompany: CompanyProfile | null | undefined,
): CompanyProfile | null {
  return parsedCompany ?? websiteCompany ?? null;
}

function getCompanyDisplay({
  companyProfile,
  companyUrl,
  website,
}: {
  companyProfile: CompanyProfile | null;
  companyUrl?: string;
  website: NonNullable<AuditResult["website"]>;
}): {
  name: string;
  tagline?: string;
  description?: string;
  palette: string[];
} {
  return {
    name: getCompanyName(companyProfile, website, companyUrl),
    tagline: firstPresent([companyProfile?.tagline]),
    description: firstPresent([companyProfile?.description, website.description]),
    palette: getWebsitePalette(companyProfile, website.detectedColors),
  };
}

function getCompanyName(
  companyProfile: CompanyProfile | null,
  website: NonNullable<AuditResult["website"]>,
  companyUrl?: string,
): string {
  return firstPresent([companyProfile?.name, website.title, companyUrl]) ?? website.url;
}

function getWebsitePalette(
  companyProfile: CompanyProfile | null,
  detectedColors: string[],
): string[] {
  return companyProfile?.color_palette && companyProfile.color_palette.length > 0
    ? companyProfile.color_palette
    : detectedColors;
}

function firstPresent(values: Array<string | null | undefined>): string | undefined {
  return values.find((value) => value && value.trim().length > 0) ?? undefined;
}

function IntegrationsStep({
  result,
  selectedTools,
  customToolsByCategory,
  selectedToolCount,
  onToggleTool,
  onCustomToolChange,
}: {
  result: AuditResult | null;
  selectedTools: Set<string>;
  customToolsByCategory: Record<string, string>;
  selectedToolCount: number;
  onToggleTool: (toolName: string) => void;
  onCustomToolChange: (categoryId: string, value: string) => void;
}) {
  const recommendations = useMemo(
    () =>
      result?.integrationRecommendations && result.integrationRecommendations.length > 0
        ? result.integrationRecommendations
        : [],
    [result?.integrationRecommendations],
  );
  const surveyFailed = Boolean(result?.toolSurveyError);

  return (
    <>
      <StepHeader
        eyebrow="Step 4"
        title="Tool survey"
        description="Agentic Auditor turns the raw profile and website into hypotheses about the tool categories this person or company likely uses."
      />
      <div className="border-border/70 border-t pt-4">
        <ToolSurveyHeader result={result} selectedToolCount={selectedToolCount} />
        <ToolSurveyPendingCallout result={result} />
        <ToolSurveyBody
          result={result}
          recommendations={recommendations}
          surveyFailed={surveyFailed}
          selectedTools={selectedTools}
          customToolsByCategory={customToolsByCategory}
          onToggleTool={onToggleTool}
          onCustomToolChange={onCustomToolChange}
        />
      </div>
    </>
  );
}

function ToolSurveyHeader({
  result,
  selectedToolCount,
}: {
  result: AuditResult | null;
  selectedToolCount: number;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold">Tool hypotheses</p>
        <p className="text-muted-foreground mt-1 text-xs">{getToolSurveySourceLabel(result)}</p>
      </div>
      <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
        {selectedToolCount} tools selected
      </span>
    </div>
  );
}

function getToolSurveySourceLabel(result: AuditResult | null): string {
  return result
    ? "Grounded in the raw LinkedIn profile and website JSON."
    : "Waiting for the profile pass before building the survey.";
}

function ToolSurveyPendingCallout({ result }: { result: AuditResult | null }) {
  if (result) {
    return null;
  }

  return (
    <div className="border-border/70 bg-background mb-3 flex items-center gap-3 rounded-lg border p-3">
      <Loader2 className="text-brand h-4 w-4 animate-spin" />
      <p className="text-muted-foreground text-xs">
        The agent is mapping likely tool categories and common products for this profile.
      </p>
    </div>
  );
}

function ToolSurveyBody({
  result,
  recommendations,
  surveyFailed,
  selectedTools,
  customToolsByCategory,
  onToggleTool,
  onCustomToolChange,
}: {
  result: AuditResult | null;
  recommendations: IntegrationRecommendation[];
  surveyFailed: boolean;
  selectedTools: Set<string>;
  customToolsByCategory: Record<string, string>;
  onToggleTool: (toolName: string) => void;
  onCustomToolChange: (categoryId: string, value: string) => void;
}) {
  if (surveyFailed) {
    return <ToolSurveyFailed message={result?.toolSurveyError} />;
  }

  if (isToolSurveyLoading(result, recommendations)) {
    return <ToolSurveyLoading />;
  }

  return (
    <div className="divide-border/70 divide-y">
      {recommendations.map((recommendation) => (
        <ToolCategorySurveyCard
          key={recommendation.id}
          recommendation={recommendation}
          selectedTools={selectedTools}
          customTool={customToolsByCategory[recommendation.id] ?? ""}
          onToggleTool={onToggleTool}
          onCustomToolChange={onCustomToolChange}
        />
      ))}
    </div>
  );
}

function isToolSurveyLoading(
  result: AuditResult | null,
  recommendations: IntegrationRecommendation[],
): boolean {
  return Boolean(result && recommendations.length === 0);
}

function ToolSurveyFailed({ message }: { message?: string | null }) {
  return (
    <div className="divide-border/70 divide-y">
      <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
        <p className="text-destructive text-sm font-medium">Tool survey failed</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {message ?? "The model did not return usable tool categories."}
        </p>
      </div>
    </div>
  );
}

function ToolSurveyLoading() {
  return (
    <div className="divide-border/70 divide-y">
      <div className="border-border/70 bg-background rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Loader2 className="text-brand h-4 w-4 animate-spin" />
          <p className="text-muted-foreground text-sm">
            Building tool categories from the raw profile and website.
          </p>
        </div>
      </div>
    </div>
  );
}

function ToolCategorySurveyCard({
  recommendation,
  selectedTools,
  customTool,
  onToggleTool,
  onCustomToolChange,
}: {
  recommendation: IntegrationRecommendation;
  selectedTools: Set<string>;
  customTool: string;
  onToggleTool: (toolName: string) => void;
  onCustomToolChange: (categoryId: string, value: string) => void;
}) {
  const handleCustomChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onCustomToolChange(recommendation.id, event.target.value);
    },
    [onCustomToolChange, recommendation.id],
  );
  return (
    <section className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold tracking-tight">
            {formatToolCategoryName(recommendation.toolType)}
          </h3>
          <div className="flex shrink-0 items-center gap-2">
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
              {recommendation.importanceScore}/10
            </span>
            {recommendation.connected ? (
              <span className="bg-brand/10 text-brand rounded-full px-2 py-0.5 text-[10px] font-medium">
                Connected match
              </span>
            ) : null}
          </div>
        </div>
        <p className="text-sm leading-relaxed">{recommendation.whyLikely}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">{recommendation.toolUse}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {recommendation.commonTools.map((tool) => (
          <SurveyToolCheckbox
            key={`${recommendation.id}-${tool.name}`}
            tool={tool}
            checked={selectedTools.has(normalizeToolName(tool.name))}
            onToggle={onToggleTool}
          />
        ))}
      </div>

      <label className="mt-3 block">
        <span className="text-muted-foreground text-xs font-medium">Other tool</span>
        <input
          type="text"
          value={customTool}
          onChange={handleCustomChange}
          aria-label={`Other tool for ${formatToolCategoryName(recommendation.toolType)}`}
          placeholder="Add another tool for this category"
          className="border-input bg-background mt-1 h-9 w-full rounded-md border px-3 text-sm outline-none focus:border-brand"
        />
      </label>
    </section>
  );
}

function SurveyToolCheckbox({
  tool,
  checked,
  onToggle,
}: {
  tool: IntegrationRecommendation["commonTools"][number];
  checked: boolean;
  onToggle: (toolName: string) => void;
}) {
  const handleChange = useCallback(() => onToggle(tool.name), [onToggle, tool.name]);

  return (
    <label
      className={`flex min-h-12 min-w-56 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
        checked ? "border-brand/50 bg-brand/5" : "border-border/70 hover:bg-muted/50"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        aria-label={`Select ${tool.name}`}
        className="h-4 w-4"
      />
      <img src={getFaviconUrl(tool.url)} alt="" className="h-5 w-5 shrink-0 object-contain" />
      <span className="min-w-0 flex-1 truncate font-medium">{tool.name}</span>
    </label>
  );
}

function buildSelectedIntegrationRecommendations({
  recommendations,
  selectedTools,
  customToolsByCategory,
}: {
  recommendations: IntegrationRecommendation[];
  selectedTools: Set<string>;
  customToolsByCategory: Record<string, string>;
}): IntegrationRecommendation[] {
  return recommendations.flatMap((recommendation) =>
    buildSelectedIntegrationRecommendation(recommendation, selectedTools, customToolsByCategory),
  );
}

function buildSelectedIntegrationRecommendation(
  recommendation: IntegrationRecommendation,
  selectedTools: Set<string>,
  customToolsByCategory: Record<string, string>,
): IntegrationRecommendation[] {
  const commonTools = getSelectedCommonTools(recommendation, selectedTools);
  const customTools = getCustomTools(customToolsByCategory[recommendation.id]);

  return hasSelectedRecommendationTools(commonTools, customTools)
    ? [
        {
          ...recommendation,
          url: getSelectedRecommendationUrl(recommendation, commonTools),
          commonTools,
          customTools,
          selected: true,
        },
      ]
    : [];
}

function getSelectedCommonTools(
  recommendation: IntegrationRecommendation,
  selectedTools: Set<string>,
): IntegrationRecommendation["commonTools"] {
  return recommendation.commonTools.filter((tool) =>
    selectedTools.has(normalizeToolName(tool.name)),
  );
}

function getCustomTools(value: string | undefined): string[] {
  return (value ?? "").split(",").map(trimToolName).filter(Boolean);
}

function trimToolName(tool: string): string {
  return tool.trim();
}

function hasSelectedRecommendationTools(
  commonTools: IntegrationRecommendation["commonTools"],
  customTools: string[],
): boolean {
  return commonTools.length > 0 || customTools.length > 0;
}

function getSelectedRecommendationUrl(
  recommendation: IntegrationRecommendation,
  commonTools: IntegrationRecommendation["commonTools"],
): string {
  return commonTools[0]?.url ?? recommendation.url;
}

const TOOL_CATEGORY_ACRONYMS = new Set([
  "ai",
  "api",
  "ats",
  "bi",
  "crm",
  "erp",
  "hr",
  "it",
  "kpi",
  "saas",
  "seo",
  "sop",
  "sql",
]);

function formatToolCategoryName(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return TOOL_CATEGORY_ACRONYMS.has(lower)
        ? lower.toUpperCase()
        : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function AgentRecommendationsStep({ result }: { result: AuditResult | null }) {
  const recommendations = getResultAgentRecommendations(result);
  const integrationRecommendations = getResultIntegrationRecommendations(result);
  const companyName = getAgentRecommendationCompanyName(result);
  const toolCount = getSelectedRecommendationToolCount(integrationRecommendations);

  return (
    <>
      <AgentRecommendationsHeader
        companyName={companyName}
        toolCount={toolCount}
        recommendationCount={recommendations.length}
      />
      <AgentRecommendationsBody
        recommendations={recommendations}
        integrationRecommendations={integrationRecommendations}
      />
    </>
  );
}

function getResultAgentRecommendations(result: AuditResult | null): AgentRecommendation[] {
  return result?.agentRecommendations ?? EMPTY_AGENT_RECOMMENDATIONS;
}

function getAgentRecommendationCompanyName(result: AuditResult | null): string {
  return firstPresent(getAgentRecommendationCompanyNameCandidates(result)) ?? "your company";
}

function getAgentRecommendationCompanyNameCandidates(
  result: AuditResult | null,
): Array<string | null | undefined> {
  return [
    result?.linkedin?.currentCompany?.name,
    result?.linkedin?.company,
    result?.website?.title,
  ];
}

function getSelectedRecommendationToolCount(
  integrationRecommendations: IntegrationRecommendation[],
): number {
  return integrationRecommendations.reduce(
    (count, recommendation) => count + getRecommendationToolCount(recommendation),
    0,
  );
}

function getRecommendationToolCount(recommendation: IntegrationRecommendation): number {
  return recommendation.commonTools.length + (recommendation.customTools?.length ?? 0);
}

function AgentRecommendationsHeader({
  companyName,
  toolCount,
  recommendationCount,
}: {
  companyName: string;
  toolCount: number;
  recommendationCount: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <StepHeader
        eyebrow="Step 5"
        title="Agent recommendations"
        description={`Based on ${companyName}'s profile, website, and tool stack, these are the agents most likely to create value first.`}
      />
      <div className="bg-brand-light text-brand-dark w-fit rounded-full px-2.5 py-1 text-xs font-medium">
        {toolCount} tools analysed · {recommendationCount || 4} agent ideas
      </div>
    </div>
  );
}

function AgentRecommendationsBody({
  recommendations,
  integrationRecommendations,
}: {
  recommendations: AgentRecommendation[];
  integrationRecommendations: IntegrationRecommendation[];
}) {
  if (recommendations.length === 0) {
    return <AgentRecommendationsLoading />;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {recommendations.map((agent, index) => (
        <AgentRecommendationCard
          key={agent.id}
          agent={agent}
          index={index}
          integrations={integrationRecommendations}
        />
      ))}
    </div>
  );
}

function AgentRecommendationsLoading() {
  return (
    <div className="border-border/70 bg-background rounded-xl border p-5">
      <div className="flex items-center gap-3">
        <Loader2 className="text-brand h-4 w-4 animate-spin" />
        <div>
          <p className="text-sm font-medium">The agent is building recommendations.</p>
          <p className="text-muted-foreground text-xs">
            It is ranking workflow ideas by likely time saved, integration fit, and adoption effort.
          </p>
        </div>
      </div>
    </div>
  );
}

function AgentRecommendationCard({
  agent,
  index,
  integrations,
}: {
  agent: AgentRecommendation;
  index: number;
  integrations: IntegrationRecommendation[];
}) {
  const isHighRoi = agent.badge === "High ROI";
  const avatarSrc = COWORKER_AVATAR_SRCS[index % COWORKER_AVATAR_SRCS.length];

  return (
    <section className="border-border/70 bg-background flex min-h-72 flex-col rounded-xl border p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border">
          <img
            src={avatarSrc}
            alt={`${agent.name} avatar`}
            className="h-full w-full object-cover"
          />
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isHighRoi ? "bg-brand-light text-brand-dark" : "bg-muted text-muted-foreground"
          }`}
        >
          {agent.badge}
        </span>
      </div>

      <div className="flex-1">
        <h3 className="text-base font-semibold tracking-tight">{agent.name}</h3>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{agent.description}</p>

        <dl className="mt-4 space-y-1.5 text-xs">
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0">Time saved:</dt>
            <dd className="font-medium">{agent.timeSaved}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0">Integrations:</dt>
            <dd className="font-medium">{agent.integrationCount}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground shrink-0">Impact:</dt>
            <dd className="font-medium">{agent.impactMetric}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {agent.tools.map((tool) => (
            <AgentToolPill key={tool} tool={tool} integrations={integrations} />
          ))}
        </div>
      </div>

      <Button type="button" className="mt-5 w-full gap-2">
        Deploy this agent
        <ArrowRight className="h-4 w-4" />
      </Button>
    </section>
  );
}

function AgentToolPill({
  tool,
  integrations,
}: {
  tool: string;
  integrations: IntegrationRecommendation[];
}) {
  const integration = getIntegrationByName(tool, integrations);

  return (
    <span className="bg-muted flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-[11px]">
      {integration ? (
        <IntegrationLogoImage integration={integration} className="h-3.5 w-3.5 shrink-0" />
      ) : null}
      <span className="truncate">{integration?.name ?? tool}</span>
    </span>
  );
}

function IntegrationLogoImage({
  integration,
  className,
}: {
  integration: IntegrationRecommendation;
  className: string;
}) {
  const src = integration.icon ?? getFaviconUrl(integration.url);

  return <img src={src} alt="" className={`${className} object-contain`} />;
}

function getFaviconUrl(url: string): string {
  const domain = getDomainFromUrl(url) ?? url;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function getIntegrationByName(
  tool: string,
  integrations: IntegrationRecommendation[],
): IntegrationRecommendation | null {
  const normalizedTool = normalizeToolName(tool);
  const candidates = [
    ...integrations,
    ...Object.values(INTEGRATION_DETAILS).map(knownIntegrationToRecommendation),
  ];
  const integration = candidates.find((item) => {
    const normalizedName = normalizeToolName(item.name);
    const normalizedType = normalizeToolName(item.toolType);
    const normalizedCommonTools = item.commonTools.map((commonTool) =>
      normalizeToolName(commonTool.name),
    );
    return (
      normalizedName === normalizedTool ||
      normalizedType === normalizedTool ||
      normalizedTool.includes(normalizedName) ||
      normalizedCommonTools.some(
        (commonTool) => commonTool === normalizedTool || normalizedTool.includes(commonTool),
      )
    );
  });

  if (!integration) {
    return null;
  }

  return {
    ...integration,
    connected: false,
    selected: false,
  };
}

function knownIntegrationToRecommendation(
  integration: Pick<IntegrationRecommendation, "id" | "name" | "url" | "icon" | "reason">,
): IntegrationRecommendation {
  return {
    ...integration,
    toolType: integration.name,
    toolUse: integration.reason,
    whyLikely: integration.reason,
    importanceScore: 5,
    commonTools: [{ name: integration.name, url: integration.url }],
    connected: false,
    selected: false,
  };
}

function normalizeToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function AgentStreamCollector({
  agentKey,
  generationId,
  onTextChange,
}: {
  agentKey: string;
  generationId: string;
  onTextChange: (agentKey: string, text: string) => void;
}) {
  const { subscribeToGeneration, abort } = useGeneration();
  const textRef = useRef("");

  useEffect(() => {
    textRef.current = "";
    onTextChange(agentKey, "");
    void subscribeToGeneration(generationId, {
      onText: (content) => {
        textRef.current += content;
        onTextChange(agentKey, textRef.current);
      },
    });

    return () => abort();
  }, [abort, agentKey, generationId, onTextChange, subscribeToGeneration]);

  return null;
}

function CompanyCard({
  name,
  tagline,
  description,
  brandVoice,
  palette,
  url,
}: {
  name: string;
  tagline?: string;
  description?: string;
  brandVoice?: string[];
  palette: string[];
  url: string;
}) {
  return (
    <section className="border-border/70 bg-background space-y-4 rounded-xl border p-4">
      <CompanyCardHeader name={name} url={url} />
      <CompanyCardDescription tagline={tagline} description={description} />
      <BrandVoiceList brandVoice={brandVoice} />
      <CompanyPalette palette={palette} />
      <CompanyUrlLink url={url} />
    </section>
  );
}

function CompanyCardHeader({ name, url }: { name: string; url: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border">
        <CompanyLogoMark domain={getDomainFromUrl(url)} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Company
          </span>
        </div>
        <p className="truncate text-base leading-tight font-semibold">{name}</p>
      </div>
    </div>
  );
}

function CompanyCardDescription({
  tagline,
  description,
}: {
  tagline?: string;
  description?: string;
}) {
  return (
    <div className="space-y-2">
      <OptionalMutedText value={tagline} className="text-sm" />
      {description ? <p className="text-sm leading-relaxed">{description}</p> : null}
    </div>
  );
}

function BrandVoiceList({ brandVoice }: { brandVoice?: string[] }) {
  if (!brandVoice?.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {brandVoice.map((word) => (
        <span key={word} className="bg-muted rounded-full px-2 py-0.5 text-xs">
          {word}
        </span>
      ))}
    </div>
  );
}

function CompanyPalette({ palette }: { palette: string[] }) {
  return palette.length > 0 ? <PaletteSummary palette={palette} /> : null;
}

function CompanyUrlLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-foreground block truncate text-xs underline"
    >
      {url}
    </a>
  );
}

function Swatch({ color }: { color: string }) {
  const style = useMemo(() => ({ backgroundColor: color }), [color]);
  return <span className="h-5 w-5 rounded-md border" style={style} title={color} />;
}

function PaletteSummary({ palette }: { palette: string[] }) {
  return (
    <div className="border-border/60 bg-muted/35 flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="text-xs font-medium">Brand palette</p>
        <p className="text-muted-foreground text-[11px]">{palette.length} colors detected</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {palette.slice(0, 5).map((color) => (
          <Swatch key={color} color={color} />
        ))}
      </div>
    </div>
  );
}

function PersonCard({
  name,
  title,
  description,
  location,
  profileImageUrl,
  currentCompany,
  talkingPoints,
  linkedinUrl,
}: {
  name: string;
  title?: string;
  description?: string;
  location: string | null;
  profileImageUrl: string | null;
  currentCompany: NonNullable<AuditResult["linkedin"]>["currentCompany"];
  talkingPoints?: string[];
  linkedinUrl?: string;
}) {
  const avatarSrc = profileImageUrl ?? getPersonAvatarUrl(name, linkedinUrl);

  return (
    <section className="border-border/70 bg-background space-y-4 rounded-xl border p-4">
      <PersonCardHeader name={name} title={title} location={location} avatarSrc={avatarSrc} />
      <CurrentCompanyPanel currentCompany={currentCompany} />
      <PersonDescription description={description} />
      <TalkingPointsList talkingPoints={talkingPoints} />
    </section>
  );
}

function PersonCardHeader({
  name,
  title,
  location,
  avatarSrc,
}: {
  name: string;
  title?: string;
  location: string | null;
  avatarSrc: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="relative h-16 w-16 shrink-0">
        <img src={avatarSrc} alt="" className="h-full w-full rounded-xl object-cover" />
        <div className="bg-background absolute -right-1 -bottom-1 flex h-7 w-7 items-center justify-center rounded-full shadow-xs">
          <LinkedInLogoMark />
        </div>
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Person
          </span>
        </div>
        <p className="truncate text-lg font-semibold leading-tight">{name}</p>
        <OptionalMutedText value={title} className="text-sm" />
        <OptionalMutedText value={location} className="text-xs" />
      </div>
    </div>
  );
}

function OptionalMutedText({ value, className }: { value?: string | null; className: string }) {
  return value ? <p className={`text-muted-foreground ${className}`}>{value}</p> : null;
}

function CurrentCompanyPanel({
  currentCompany,
}: {
  currentCompany: NonNullable<AuditResult["linkedin"]>["currentCompany"];
}) {
  if (!currentCompany?.name) {
    return null;
  }

  const companyMeta = getCompanyMetaLabel(currentCompany);

  return (
    <div className="border-border/50 bg-muted/40 rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <CompanyLogo logoUrl={currentCompany.logoUrl} />
        <div className="min-w-0">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
            Current company
          </p>
          <p className="text-sm font-medium">{currentCompany.name}</p>
          <CompanyMeta label={companyMeta} />
          <CompanyWebsiteLink website={currentCompany.website} />
        </div>
      </div>
    </div>
  );
}

function CompanyLogo({ logoUrl }: { logoUrl: string | null }) {
  return logoUrl ? (
    <img
      src={logoUrl}
      alt=""
      className="bg-background h-10 w-10 shrink-0 rounded-lg border object-contain p-1"
    />
  ) : null;
}

function getCompanyMetaLabel({
  industry,
  employeeCount,
}: NonNullable<NonNullable<AuditResult["linkedin"]>["currentCompany"]>): string {
  return [industry, employeeCount].filter(Boolean).join(" · ");
}

function CompanyMeta({ label }: { label: string }) {
  return label ? <p className="text-muted-foreground text-xs">{label}</p> : null;
}

function CompanyWebsiteLink({ website }: { website: string | null }) {
  return website ? (
    <a
      href={website}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-foreground block truncate text-xs underline"
    >
      {website}
    </a>
  ) : null;
}

function PersonDescription({ description }: { description?: string }) {
  return description ? <p className="text-sm leading-relaxed">{description}</p> : null;
}

function TalkingPointsList({ talkingPoints }: { talkingPoints?: string[] }) {
  if (!talkingPoints?.length) {
    return null;
  }

  return (
    <ul className="space-y-1 text-sm">
      {talkingPoints.map((point) => (
        <li key={point} className="flex gap-2">
          <span className="text-brand">•</span>
          {point}
        </li>
      ))}
    </ul>
  );
}

// --- card parsing ---

function parseCards(text: string): {
  company: CompanyProfile | null;
  person: PersonProfile | null;
} {
  return Array.from(text.matchAll(/```json\s*([\s\S]*?)```/g)).reduce(mergeParsedCardBlock, {
    company: null,
    person: null,
  } as {
    company: CompanyProfile | null;
    person: PersonProfile | null;
  });
}

function mergeParsedCardBlock(
  current: {
    company: CompanyProfile | null;
    person: PersonProfile | null;
  },
  match: RegExpMatchArray,
): {
  company: CompanyProfile | null;
  person: PersonProfile | null;
} {
  const parsed = parseCardBlock(match[1]);
  if (!parsed) {
    return current;
  }

  return {
    company: parsed.company_profile ?? current.company,
    person: parsed.person_profile ?? current.person,
  };
}

function parseCardBlock(block: string): {
  company_profile?: CompanyProfile;
  person_profile?: PersonProfile;
} | null {
  try {
    return JSON.parse(block.trim()) as {
      company_profile?: CompanyProfile;
      person_profile?: PersonProfile;
    };
  } catch {
    // Block may still be streaming; ignore until complete.
    return null;
  }
}
