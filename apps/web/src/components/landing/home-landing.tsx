import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import type { TemplateCatalogTemplate, TemplateIntegrationType } from "@bap/db/template-catalog";
import type { ChangeEvent, FormEvent } from "react";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ArrowUp, ChevronDown, Globe2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PromptBar, type AttachmentData } from "@/components/prompt-bar";
import type { PromptSegment } from "@/lib/prompt-segments";
import {
  ChatDebugPopover,
  type ArmedDebugPreset,
  type ChatDebugSnapshot,
} from "@/components/chat/chat-debug-popover";
import { ModelSelector } from "@/components/chat/model-selector";
import { VoiceIndicator } from "@/components/chat/voice-indicator";
import { useAppLocale } from "@/components/general-translation-provider";
import { AnimatedHowItWorksSection } from "@/components/landing/animated-how-it-works";
import { BentoFeaturesSection } from "@/components/landing/bento-features";
import { OrgChartShowcaseSection } from "@/components/landing/org-chart-showcase";
import {
  clearPendingCoworkerPrompt,
  getPendingCoworkerGenerationContent,
  readPendingCoworkerPrompt,
  writePendingCoworkerPrompt,
} from "@/components/landing/pending-coworker-prompt";
import { startCoworkerBuilderGeneration } from "@/components/landing/start-coworker-builder-generation";
import { TeamShowcaseSection } from "@/components/landing/team-showcase";
import { TemplatePreviewModal } from "@/components/template-preview-modal";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useIsMobile } from "@/hooks/use-mobile";
import { blobToBase64, useVoiceRecording } from "@/hooks/use-voice-recording";
import { authClient } from "@/lib/auth-client";
import { normalizeChatModelSelection } from "@/lib/chat-model-selection";
import { COWORKER_AVAILABLE_INTEGRATION_TYPES, INTEGRATION_LOGOS } from "@/lib/integration-icons";
import { buildProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import { useCreateCoworker } from "@/orpc/hooks/coworkers";
import { useProviderAuthStatus } from "@/orpc/hooks/provider-auth";
import { useTranscribe } from "@/orpc/hooks/voice";

type HeroPromptExample = {
  department: string;
  color: string;
  segments: PromptSegment[];
  prompt: string;
};

const TEMPLATE_INTEGRATION_LOGOS: Record<TemplateIntegrationType, string> = {
  ...INTEGRATION_LOGOS,
  linear: "/integrations/linear.svg",
};
const LANDING_LOCALE_NAMES = {
  en: "English",
  fr: "Français",
} as const;

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_COWORKER_BUILDER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;
const COWORKER_BUILDER_DEBUG_PROMPT = "create a coworker that says hi";
const COWORKER_BUILDER_DEBUG_SCENARIOS = ["question", "runtime"] as const;
const COWORKER_BUILDER_DEBUG_PROMPTS = {
  question: COWORKER_BUILDER_DEBUG_PROMPT,
  runtime: COWORKER_BUILDER_DEBUG_PROMPT,
} as const;
const COWORKER_BUILDER_DEBUG_LABELS = {
  question: "Create Question",
  runtime: "Create Runtime",
} as const;
const COWORKER_BUILDER_DEBUG_DESCRIPTIONS = {
  question: "Builder question park repro",
  runtime: "Builder runtime deadline repro",
} as const;
// Brandfetch CDN icon URLs (fetched via Brand API)
const BF = {
  salesforce:
    "https://cdn.brandfetch.io/idVE84WdIN/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  outreach:
    "https://cdn.brandfetch.io/idppFLnf4N/w/150/h/150/theme/dark/icon.png?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  googleCalendar:
    "https://cdn.brandfetch.io/id6O2oGzv-/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  meta: "https://cdn.brandfetch.io/idWvz5T3V7/w/400/h/400/theme/dark/icon.png?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  slack:
    "https://cdn.brandfetch.io/idJ_HhtG0Z/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  greenhouse:
    "https://cdn.brandfetch.io/id7baa8wpg/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  bamboohr:
    "https://cdn.brandfetch.io/idpB2Dvgzu/w/180/h/180/theme/dark/icon.png?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  atlassian:
    "https://cdn.brandfetch.io/idlQIwGMOK/w/400/h/400/theme/dark/icon.png?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  ironclad:
    "https://cdn.brandfetch.io/id2DIJ2hXq/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  stripe:
    "https://cdn.brandfetch.io/idxAg10C0L/w/480/h/480/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  brex: "https://cdn.brandfetch.io/idu49Dl4i8/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  quickbooks:
    "https://cdn.brandfetch.io/idWrWLZ_I5/w/200/h/200/theme/dark/icon.png?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  zendesk:
    "https://cdn.brandfetch.io/idNq8SRGPd/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
} as const;

const HERO_PROMPT_EXAMPLES: HeroPromptExample[] = [
  {
    department: "Sales",
    color: "#3B82F6",
    segments: [
      { type: "text", content: "When a deal in " },
      { type: "brand", name: "Salesforce", icon: BF.salesforce },
      { type: "text", content: " moves to Proposal Sent, draft follow-ups in " },
      { type: "brand", name: "Outreach", icon: BF.outreach },
      { type: "text", content: " and schedule reminders in " },
      { type: "brand", name: "Google Calendar", icon: BF.googleCalendar },
    ],
    prompt:
      "When a deal in Salesforce moves to Proposal Sent, draft follow-ups in Outreach and schedule reminders in Google Calendar.",
  },
  {
    department: "Marketing",
    color: "#F472B6",
    segments: [
      { type: "text", content: "Every morning, compare " },
      { type: "brand", name: "Meta Ads", icon: BF.meta },
      { type: "text", content: " and " },
      { type: "brand", name: "Google Ads", icon: BF.googleCalendar },
      { type: "text", content: " CAC vs yesterday and send a performance digest to " },
      { type: "brand", name: "Slack", icon: BF.slack },
    ],
    prompt:
      "Every morning, compare Meta Ads and Google Ads CAC vs yesterday and send a performance digest to Slack.",
  },
  {
    department: "HR",
    color: "#F59E0B",
    segments: [
      { type: "text", content: "When a candidate is marked Hired in " },
      { type: "brand", name: "Greenhouse", icon: BF.greenhouse },
      { type: "text", content: ", create onboarding tasks in " },
      { type: "brand", name: "BambooHR", icon: BF.bamboohr },
      { type: "text", content: ", " },
      { type: "brand", name: "Jira", icon: BF.atlassian },
      { type: "text", content: ", and " },
      { type: "brand", name: "Google Workspace", icon: BF.googleCalendar },
    ],
    prompt:
      "When a candidate is marked Hired in Greenhouse, create onboarding tasks in BambooHR, Jira, and Google Workspace.",
  },
  {
    department: "Legal",
    color: "#8B5CF6",
    segments: [
      { type: "text", content: "When a new MSA is uploaded to " },
      { type: "brand", name: "Ironclad", icon: BF.ironclad },
      { type: "text", content: ", extract renewal and termination dates and add reminders to " },
      { type: "brand", name: "Google Calendar", icon: BF.googleCalendar },
    ],
    prompt:
      "When a new MSA is uploaded to Ironclad, extract renewal and termination dates and add reminders to Google Calendar.",
  },
  {
    department: "Finance",
    color: "#10B981",
    segments: [
      { type: "text", content: "Every business day, reconcile " },
      { type: "brand", name: "Stripe", icon: BF.stripe },
      { type: "text", content: " and " },
      { type: "brand", name: "Brex", icon: BF.brex },
      { type: "text", content: " transactions in " },
      { type: "brand", name: "QuickBooks", icon: BF.quickbooks },
      { type: "text", content: " and send mismatch reports to " },
      { type: "brand", name: "Slack", icon: BF.slack },
    ],
    prompt:
      "Every business day, reconcile Stripe and Brex transactions in QuickBooks and send mismatch reports to Slack.",
  },
  {
    department: "Support",
    color: "#06B6D4",
    segments: [
      { type: "text", content: "Every hour, triage new " },
      { type: "brand", name: "Zendesk", icon: BF.zendesk },
      {
        type: "text",
        content: " tickets by sentiment, auto-tag priority, and route critical ones to on-call in ",
      },
      { type: "brand", name: "Slack", icon: BF.slack },
    ],
    prompt:
      "Every hour, triage new Zendesk tickets by sentiment, auto-tag priority, and route critical ones to on-call in Slack.",
  },
];

const HERO_BACKGROUND_PLACEHOLDER =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABcQERQRDhcUEhQaGBcbIjklIh8fIkYyNSk5UkhXVVFIUE5bZoNvW2F8Yk5QcptzfIeLkpSSWG2grJ+OqoOPko3/2wBDARgaGiIeIkMlJUONXlBejY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY3/wAARCAAbADADASIAAhEBAxEB/8QAGQAAAgMBAAAAAAAAAAAAAAAAAwQBAgUG/8QAJxAAAgICAQIFBQEAAAAAAAAAAQIAEQMhEjFBBBMiUcEFIzJhcfH/xAAYAQADAQEAAAAAAAAAAAAAAAABAwUCBP/EAB8RAAICAgIDAQAAAAAAAAAAAAECABEDBBIhIjJBYf/aAAwDAQACEQMRAD8AQCywWXCywWU5J5QYWTxh1wse1f2Ex4AxAFte7A0B7xL7GNftx6a2V/lD9inCRxsajIAGY4iLBU7MyvDNlxekHmgv0ntXtFLtAnsUI99MqPE2ZpjiBfWFUqCfUABfQRc6ahoajKovlMa3x+JwvlZvYyjjwInqKkqRqgNpRs2Yti+q48jDlkONwOJta1HMZ2y6oIO36nNMoLZrHQfIgU3C44zeUo+ZeJDgj8gZlY0dPEsqkV5hFHtf+QQ+3iyOhKstUQem4XAxbOxJs8lmgKguz3P/2Q==";
const HERO_BACKGROUND_PLACEHOLDER_STYLE = {
  backgroundImage: `url("${HERO_BACKGROUND_PLACEHOLDER}")`,
  backgroundPosition: "center",
  backgroundSize: "cover",
} as const;

function getTriggerLabel(triggerType: string, gt: ReturnType<typeof useGT>) {
  const map: Record<string, string> = {
    manual: gt("Manual"),
    schedule: gt("Scheduled"),
    email: gt("Email"),
    webhook: gt("Webhook"),
  };
  return map[triggerType] ?? triggerType;
}

function translatePromptSegments(segments: PromptSegment[], gt: ReturnType<typeof useGT>) {
  return segments.map((segment) => {
    if (segment.type !== "text") {
      return segment;
    }
    return {
      ...segment,
      content: translateHeroSegmentText(segment.content, gt),
    };
  });
}

function translateHeroDepartment(department: string | undefined, gt: ReturnType<typeof useGT>) {
  switch (department) {
    case "Sales":
      return gt("Sales");
    case "Marketing":
      return gt("Marketing");
    case "HR":
      return gt("HR");
    case "Legal":
      return gt("Legal");
    case "Finance":
      return gt("Finance");
    case "Support":
      return gt("Support");
    default:
      return gt("your team");
  }
}

function translateHeroPrompt(prompt: string, gt: ReturnType<typeof useGT>) {
  switch (prompt) {
    case "When a deal in Salesforce moves to Proposal Sent, draft follow-ups in Outreach and schedule reminders in Google Calendar.":
      return gt(
        "When a deal in Salesforce moves to Proposal Sent, draft follow-ups in Outreach and schedule reminders in Google Calendar.",
      );
    case "Every morning, compare Meta Ads and Google Ads CAC vs yesterday and send a performance digest to Slack.":
      return gt(
        "Every morning, compare Meta Ads and Google Ads CAC vs yesterday and send a performance digest to Slack.",
      );
    case "When a candidate is marked Hired in Greenhouse, create onboarding tasks in BambooHR, Jira, and Google Workspace.":
      return gt(
        "When a candidate is marked Hired in Greenhouse, create onboarding tasks in BambooHR, Jira, and Google Workspace.",
      );
    case "When a new MSA is uploaded to Ironclad, extract renewal and termination dates and add reminders to Google Calendar.":
      return gt(
        "When a new MSA is uploaded to Ironclad, extract renewal and termination dates and add reminders to Google Calendar.",
      );
    case "Every business day, reconcile Stripe and Brex transactions in QuickBooks and send mismatch reports to Slack.":
      return gt(
        "Every business day, reconcile Stripe and Brex transactions in QuickBooks and send mismatch reports to Slack.",
      );
    case "Every hour, triage new Zendesk tickets by sentiment, auto-tag priority, and route critical ones to on-call in Slack.":
      return gt(
        "Every hour, triage new Zendesk tickets by sentiment, auto-tag priority, and route critical ones to on-call in Slack.",
      );
    default:
      return prompt;
  }
}

function translateHeroSegmentText(content: string, gt: ReturnType<typeof useGT>) {
  switch (content) {
    case "When a deal in ":
      return gt("When a deal in ");
    case " moves to Proposal Sent, draft follow-ups in ":
      return gt(" moves to Proposal Sent, draft follow-ups in ");
    case " and schedule reminders in ":
      return gt(" and schedule reminders in ");
    case "Every morning, compare ":
      return gt("Every morning, compare ");
    case " and ":
      return gt(" and ");
    case " CAC vs yesterday and send a performance digest to ":
      return gt(" CAC vs yesterday and send a performance digest to ");
    case "When a candidate is marked Hired in ":
      return gt("When a candidate is marked Hired in ");
    case ", create onboarding tasks in ":
      return gt(", create onboarding tasks in ");
    case ", and ":
      return gt(", and ");
    case ", ":
      return gt(", ");
    case "When a new MSA is uploaded to ":
      return gt("When a new MSA is uploaded to ");
    case ", extract renewal and termination dates and add reminders to ":
      return gt(", extract renewal and termination dates and add reminders to ");
    case "Every business day, reconcile ":
      return gt("Every business day, reconcile ");
    case " transactions in ":
      return gt(" transactions in ");
    case " and send mismatch reports to ":
      return gt(" and send mismatch reports to ");
    case "Every hour, triage new ":
      return gt("Every hour, triage new ");
    case " tickets by sentiment, auto-tag priority, and route critical ones to on-call in ":
      return gt(" tickets by sentiment, auto-tag priority, and route critical ones to on-call in ");
    default:
      return content;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function IntegrationLogos({ integrations }: { integrations: TemplateIntegrationType[] }) {
  return (
    <div className="flex items-center gap-1">
      {integrations.map((key) => {
        const logo = TEMPLATE_INTEGRATION_LOGOS[key];
        if (!logo) {
          return null;
        }
        return (
          <img
            key={key}
            src={logo}
            alt={key}
            width={16}
            height={16}
            loading="lazy"
            decoding="async"
            className="size-4 shrink-0"
          />
        );
      })}
    </div>
  );
}

function TemplateCard({
  template,
  isMobile,
}: {
  template: TemplateCatalogTemplate;
  isMobile: boolean;
}) {
  const gt = useGT();

  return (
    <Link
      to={isMobile ? "/template/$templateId" : "/"}
      // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop -- TanStack Router params require an inline object
      params={isMobile ? { templateId: template.id } : {}}
      // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop -- TanStack Router search requires an inline object
      search={isMobile ? {} : { preview: template.id }}
      resetScroll={false}
      className="group border-border/60 bg-card relative flex min-h-[170px] w-full flex-col gap-3 rounded-xl border p-5 text-left shadow-sm transition-all duration-150 hover:border-slate-300 hover:bg-slate-100"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm leading-tight font-medium text-slate-900">{template.title}</p>
          <span className="mt-1 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">
            {getTriggerLabel(template.triggerType, gt)}
          </span>
        </div>
        <ArrowUp className="mt-0.5 size-3.5 shrink-0 rotate-45 text-slate-500 transition-colors group-hover:text-slate-700" />
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed text-slate-700">{template.description}</p>
      <div className="mt-auto pt-1">
        <IntegrationLogos integrations={template.integrations} />
      </div>
    </Link>
  );
}

function LandingLocaleSelector({ placement = "hero" }: { placement?: "hero" | "footer" }) {
  const t = useGT();

  const { locale, locales, setLocale } = useAppLocale();
  const selectRef = useRef<HTMLSelectElement>(null);
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement> | FormEvent<HTMLSelectElement>) => {
      setLocale(event.currentTarget.value);
    },
    [setLocale],
  );
  const selectClassName =
    placement === "hero"
      ? "border-white/45 bg-white/80 text-slate-900 shadow-sm hover:bg-white"
      : "border-border/70 bg-background/80 text-foreground shadow-xs hover:bg-muted/50";

  useEffect(() => {
    const select = selectRef.current;
    if (!select) {
      return;
    }

    const handleNativeChange = () => setLocale(select.value);
    select.addEventListener("change", handleNativeChange);
    select.addEventListener("input", handleNativeChange);
    return () => {
      select.removeEventListener("change", handleNativeChange);
      select.removeEventListener("input", handleNativeChange);
    };
  }, [setLocale]);

  return (
    <div className="relative inline-flex items-center">
      <Globe2 className="text-muted-foreground pointer-events-none absolute left-2 size-3.5" />
      <select
        ref={selectRef}
        aria-label={t("Language")}
        className={`focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-[112px] appearance-none rounded-md border py-0 pr-7 pl-7 text-xs font-medium transition-[background-color,color,box-shadow] outline-none focus-visible:ring-[3px] ${selectClassName}`}
        value={locale}
        onChange={handleChange}
        onInput={handleChange}
      >
        {locales.map((option) => (
          <option key={option} value={option}>
            {LANDING_LOCALE_NAMES[option as keyof typeof LANDING_LOCALE_NAMES] ?? option}
          </option>
        ))}
      </select>
      <ChevronDown className="text-muted-foreground pointer-events-none absolute right-2 size-3.5" />
    </div>
  );
}

// ─── Animated Department Heading ──────────────────────────────────────────────

function AnimatedDepartment({
  department,
  color,
  isActive,
}: {
  department: string;
  color: string;
  isActive: boolean;
}) {
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const prevDeptRef = useRef(department);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    // When department changes, start fresh
    if (prevDeptRef.current !== department) {
      prevDeptRef.current = department;
      setDisplayedText("");
      setIsTyping(true);
    }
  }, [department, isActive]);

  // Start typing on mount
  useEffect(() => {
    setIsTyping(true);
  }, []);

  useEffect(() => {
    if (!isTyping || !isActive) {
      return;
    }

    if (displayedText.length < department.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(department.slice(0, displayedText.length + 1));
      }, 70);
      return () => clearTimeout(timeout);
    } else {
      setIsTyping(false);
    }
  }, [displayedText, department, isTyping, isActive]);

  const textStyle = useMemo(() => ({ color }), [color]);

  return (
    <span className="inline-flex items-baseline">
      <span style={textStyle}>{displayedText}</span>
    </span>
  );
}

// ─── Landing ─────────────────────────────────────────────────────────────────

type HomeLandingProps = {
  initialHasSession?: boolean;
  initialFirstName?: string | null;
  featuredTemplates: TemplateCatalogTemplate[];
};

function getFirstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/, 1).find(Boolean) ?? null;
}

export function HomeLanding({
  initialHasSession = false,
  initialFirstName = null,
  featuredTemplates,
}: HomeLandingProps) {
  const t = useGT();

  const gt = useGT();
  const navigate = useNavigate();
  const previewId = useLocation({
    select: (location) => (location.search as { preview?: string }).preview ?? null,
  });
  const isMobile = useIsMobile();
  const createCoworker = useCreateCoworker();
  const { data: providerAuthStatus } = useProviderAuthStatus();
  const { isRecording, error: voiceError, startRecording, stopRecording } = useVoiceRecording();
  const { mutateAsync: transcribe } = useTranscribe();
  const [isCreating, setIsCreating] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [model, setModel] = useState(DEFAULT_COWORKER_BUILDER_MODEL);
  const [modelAuthSource, setModelAuthSource] = useState<ProviderAuthSource | null>("shared");
  const [inputPrefillRequest, setInputPrefillRequest] = useState<{
    id: string;
    text: string;
    mode?: "replace" | "append";
  } | null>(null);
  const [armedDebugPreset, setArmedDebugPreset] = useState<ArmedDebugPreset | null>(null);
  const chatDebugSnapshot = useMemo<ChatDebugSnapshot>(() => ({}), []);
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();
  const [activePromptIndex, setActivePromptIndex] = useState(0);
  const [isAnonymous, setShowFooter] = useState(!initialHasSession);
  const [userFirstName, setUserFirstName] = useState<string | null>(initialFirstName);
  const resumePendingPromptRef = useRef(false);
  const isRecordingRef = useRef(false);
  const heroAnimatedPrompts = useMemo(
    () => HERO_PROMPT_EXAMPLES.map((item) => translateHeroPrompt(item.prompt, gt)),
    [gt],
  );
  const heroRichSegments = useMemo(
    () => HERO_PROMPT_EXAMPLES.map((item) => translatePromptSegments(item.segments, gt)),
    [gt],
  );
  const providerAvailability = useMemo(
    () =>
      buildProviderAuthAvailabilityByProvider({
        connectedProviders: providerAuthStatus?.connected,
        sharedConnectedProviders: providerAuthStatus?.shared,
      }),
    [providerAuthStatus],
  );

  const activeExample = HERO_PROMPT_EXAMPLES[activePromptIndex % HERO_PROMPT_EXAMPLES.length];
  const loggedInHeadline = userFirstName
    ? gt("What do you want to automate {name}?", { name: userFirstName })
    : gt("What do you want to automate today?");
  const handleModelChange = useCallback(
    (input: { model: string; authSource?: ProviderAuthSource | null }) => {
      const normalized = normalizeChatModelSelection(input);
      if (!normalized.model) {
        return;
      }

      setModel(normalized.model);
      setModelAuthSource(normalized.authSource);
    },
    [],
  );
  const modelSelectorNode = useMemo(
    () => (
      <ModelSelector
        selectedModel={model}
        selectedAuthSource={modelAuthSource}
        providerAvailability={providerAvailability}
        onSelectionChange={handleModelChange}
        disabled={isCreating || isRecording || isProcessingVoice}
      />
    ),
    [
      handleModelChange,
      isCreating,
      isProcessingVoice,
      isRecording,
      model,
      modelAuthSource,
      providerAvailability,
    ],
  );

  const redirectToLogin = useCallback(() => {
    window.location.assign("/login?callbackUrl=%2F&mode=getting-started");
  }, []);

  const handlePromptComposerSubmit = useCallback(
    async (text: string, attachments?: AttachmentData[]) => {
      if (isCreating) {
        return;
      }

      setIsCreating(true);
      writePendingCoworkerPrompt({
        initialMessage: text,
        attachments,
      });

      try {
        const session = await authClient.getSession().catch(() => null);
        const hasSession = Boolean(session?.data?.session && session?.data?.user);

        if (!hasSession) {
          redirectToLogin();
          return false;
        }

        const initialMessage = getPendingCoworkerGenerationContent({
          initialMessage: text,
          attachments,
        });
        if (!initialMessage) {
          return false;
        }

        const result = await createCoworker.mutateAsync({
          name: "",
          triggerType: "manual",
          prompt: "",
          model,
          authSource: modelAuthSource,
          allowedIntegrations: COWORKER_AVAILABLE_INTEGRATION_TYPES,
        });
        await startCoworkerBuilderGeneration({
          coworkerId: result.id,
          content: initialMessage,
          model,
          authSource: modelAuthSource,
          attachments,
          debugRunDeadlineMs: armedDebugPreset?.debugRunDeadlineMs,
          debugApprovalHotWaitMs: armedDebugPreset?.debugApprovalHotWaitMs,
        });
        clearPendingCoworkerPrompt();
        setArmedDebugPreset(null);
        void navigate({
          to: "/agents/edit/$id",
          params: { id: result.id },
          replace: true,
        });
        return false;
      } finally {
        setIsCreating(false);
      }
    },
    [
      armedDebugPreset,
      createCoworker,
      isCreating,
      model,
      modelAuthSource,
      navigate,
      redirectToLogin,
    ],
  );

  const handleArmDebugPreset = useCallback((preset: ArmedDebugPreset) => {
    setArmedDebugPreset(preset);
    setInputPrefillRequest({
      id: `create-debug-preset-${preset.key}-${Date.now()}`,
      text: preset.prompt,
      mode: "replace",
    });
  }, []);

  const handleClearDebugPreset = useCallback(() => {
    setArmedDebugPreset(null);
  }, []);

  const handleResumeRunDeadline = useCallback(() => {}, []);

  const debugControlNode = useMemo(() => {
    if (!isAdmin || isAdminLoading) {
      return null;
    }

    return (
      <ChatDebugPopover
        armedPreset={armedDebugPreset}
        snapshot={chatDebugSnapshot}
        disabled={isCreating}
        triggerClassName="h-8 w-8 rounded-lg"
        enabledScenarios={COWORKER_BUILDER_DEBUG_SCENARIOS}
        introText="Admin-only create debug controls for builder question and runtime recovery."
        promptOverrides={COWORKER_BUILDER_DEBUG_PROMPTS}
        labelOverrides={COWORKER_BUILDER_DEBUG_LABELS}
        descriptionOverrides={COWORKER_BUILDER_DEBUG_DESCRIPTIONS}
        onArmPreset={handleArmDebugPreset}
        onClearPreset={handleClearDebugPreset}
        onResumeRunDeadline={handleResumeRunDeadline}
      />
    );
  }, [
    armedDebugPreset,
    chatDebugSnapshot,
    handleArmDebugPreset,
    handleClearDebugPreset,
    handleResumeRunDeadline,
    isAdmin,
    isAdminLoading,
    isCreating,
  ]);

  useEffect(() => {
    let mounted = true;

    authClient
      .getSession()
      .then((result) => {
        if (!mounted) {
          return;
        }

        const hasSession = Boolean(result?.data?.session && result?.data?.user);
        setShowFooter(!hasSession);
        setUserFirstName(hasSession ? getFirstName(result?.data?.user?.name) : null);
      })
      .catch(() => {
        if (mounted) {
          setShowFooter(true);
          setUserFirstName(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (isAnonymous || isCreating || resumePendingPromptRef.current) {
      return;
    }

    const pendingPrompt = readPendingCoworkerPrompt();
    if (!pendingPrompt) {
      return;
    }

    resumePendingPromptRef.current = true;
    window.location.replace("/agents/new");
  }, [isAnonymous, isCreating]);

  useEffect(() => {
    if (!isMobile || !previewId) {
      return;
    }

    void navigate({
      to: "/template/$templateId",
      params: { templateId: previewId },
      replace: true,
      resetScroll: false,
    });
  }, [isMobile, previewId, navigate]);

  const stopRecordingAndTranscribe = useCallback(async () => {
    if (!isRecordingRef.current) {
      return;
    }
    isRecordingRef.current = false;

    const audioBlob = await stopRecording();
    if (!audioBlob || audioBlob.size === 0) {
      return;
    }

    setIsProcessingVoice(true);
    try {
      const base64Audio = await blobToBase64(audioBlob);
      const result = await transcribe({
        audio: base64Audio,
        mimeType: audioBlob.type || "audio/webm",
      });

      if (result.text && result.text.trim()) {
        setInputPrefillRequest({
          id: `landing-voice-prefill-${Date.now()}`,
          text: result.text.trim(),
          mode: "append",
        });
      }
    } catch (error) {
      console.error("Landing transcription error:", error);
    } finally {
      setIsProcessingVoice(false);
    }
  }, [stopRecording, transcribe]);

  const handleStartRecording = useCallback(() => {
    if (isCreating || isProcessingVoice || isRecordingRef.current) {
      return;
    }

    isRecordingRef.current = true;
    void startRecording();
  }, [isCreating, isProcessingVoice, startRecording]);

  return (
    <>
      <div className="relative min-h-screen overflow-visible">
        <div
          className={`pointer-events-none absolute inset-0 overflow-hidden ${isAnonymous ? "[mask-image:linear-gradient(to_bottom,black_0%,black_75%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_75%,transparent_100%)]" : ""}`}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.22),transparent_55%),radial-gradient(circle_at_80%_10%,rgba(125,211,252,0.2),transparent_45%),linear-gradient(180deg,rgba(2,6,23,0.5)_0%,rgba(2,6,23,0.82)_100%)]" />
          <picture
            className="absolute inset-0 block overflow-hidden"
            style={HERO_BACKGROUND_PLACEHOLDER_STYLE}
          >
            <source media="(max-width: 767px)" srcSet="/landing/brick-building-mobile.avif" />
            <img
              src="/landing/brick-building.avif"
              alt=""
              aria-hidden
              width={2600}
              height={1463}
              fetchPriority="high"
              loading="eager"
              decoding="async"
              className="size-full animate-[landing-ocean-drift_28s_ease-in-out_infinite_alternate] object-cover object-center opacity-80 saturate-110 md:object-[74%_60%] lg:object-center"
            />
          </picture>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,8,23,0.24)_0%,rgba(3,8,23,0.5)_45%,rgba(3,8,23,0.76)_100%)]" />
        </div>

        <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-20 bg-gradient-to-b from-transparent to-slate-950/70 sm:hidden" />

        <div className="relative z-10 mx-auto w-full max-w-[1500px] px-6 pb-10">
          {/* ── Top bar ── */}
          {isAnonymous ? (
            <div className="flex items-center justify-end gap-2 pt-5">
              <Button
                variant="outline"
                size="sm"
                asChild
                className="border-white/45 bg-white/80 hover:bg-white"
              >
                <Link to="/login">
                  <T>Log in</T>
                </Link>
              </Button>
              <Button
                size="sm"
                asChild
                className="bg-slate-950 text-white shadow-[0_16px_32px_rgba(2,6,23,0.35)] hover:bg-slate-900"
              >
                {/* oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop -- TanStack Router search requires an inline object */}
                <Link to="/login" search={{ mode: "getting-started" }}>
                  <T>Get Started</T>
                </Link>
              </Button>
            </div>
          ) : null}

          {/* ── Prompt area — centered hero ── */}
          <section className="flex min-h-[62vh] items-center justify-center pt-8 md:min-h-[max(22rem,calc(100dvh-21rem))] md:pt-10 lg:min-h-[max(23rem,calc(100dvh-22rem))] lg:pt-12">
            <div className="mx-auto w-full max-w-3xl">
              <h1 className="mb-3 text-center text-3xl font-semibold tracking-tight text-white drop-shadow-[0_0_30px_rgba(56,189,248,0.25)] md:text-4xl lg:text-5xl">
                {isAnonymous ? (
                  <>
                    <T>What do you want to automate in</T>{" "}
                    <AnimatedDepartment
                      department={translateHeroDepartment(activeExample?.department, gt)}
                      color={activeExample?.color ?? "#3B82F6"}
                      isActive
                    />
                    ?
                  </>
                ) : (
                  loggedInHeadline
                )}
              </h1>
              <p className="mx-auto mb-8 max-w-md text-center text-base text-white/70 md:text-lg">
                <T>Describe a task and we&apos;ll build it step by step</T>
              </p>
              <PromptBar
                onSubmit={handlePromptComposerSubmit}
                isSubmitting={isCreating}
                disabled={isCreating || isRecording || isProcessingVoice}
                variant="hero"
                submitOnEnter
                placeholder={gt(
                  "e.g. Every morning, summarize my unread emails and send me a digest...",
                )}
                animatedPlaceholders={heroAnimatedPrompts}
                richAnimatedPlaceholders={heroRichSegments}
                onAnimatedPlaceholderIndexChange={setActivePromptIndex}
                isRecording={isRecording}
                onStartRecording={handleStartRecording}
                onStopRecording={stopRecordingAndTranscribe}
                voiceInteractionMode="toggle"
                prefillRequest={inputPrefillRequest}
                renderModelSelector={!isAnonymous ? modelSelectorNode : undefined}
                renderDebugControls={debugControlNode}
              />
              {(isRecording || isProcessingVoice || voiceError) && (
                <div className="mt-4">
                  <VoiceIndicator
                    isRecording={isRecording}
                    isProcessing={isProcessingVoice}
                    error={voiceError}
                    variant="hero"
                    recordingLabel={gt("Recording... Click the mic again to stop")}
                  />
                </div>
              )}
            </div>
          </section>

          {/* ── Templates ── */}
          <section className="mt-6 pb-10 md:mt-8 md:pb-16 lg:mt-10">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  <T>Templates</T>
                </h2>
                <p className="mt-0.5 text-xs text-white">
                  <T>Start from a pre-built coworker</T>
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                asChild
                className="gap-1.5 border-white/45 bg-white/80 hover:bg-white"
              >
                <Link to="/templates">
                  <T>Browse all</T>
                </Link>
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {featuredTemplates.map((template) => (
                <TemplateCard key={template.id} template={template} isMobile={isMobile} />
              ))}
            </div>
          </section>
        </div>
        {!isMobile ? (
          <TemplatePreviewModal
            template={featuredTemplates.find((template) => template.id === previewId) ?? null}
            closeHref="/"
          />
        ) : null}
      </div>

      {/* ── Landing sections (anonymous only) ── */}
      {isAnonymous ? (
        <>
          <BentoFeaturesSection />
          <AnimatedHowItWorksSection />
          <OrgChartShowcaseSection />
          <TeamShowcaseSection />

          {/* ── CTA ── */}
          <section className="border-border/40 relative overflow-hidden border-t bg-slate-950 px-6 py-24 md:py-36">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.08),transparent_70%)]" />
            <div className="relative mx-auto max-w-xl text-center">
              <h2 className="mb-5 text-3xl font-bold tracking-tight text-white md:text-[2.75rem] md:leading-[1.15]">
                <T>Deploy your first AI coworker today</T>
              </h2>
              <p className="mx-auto mb-10 max-w-sm text-base leading-relaxed text-slate-400">
                <T>Start free. Build your first AI coworker in minutes.</T>
              </p>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <Button
                  size="lg"
                  asChild
                  className="bg-white px-8 text-slate-950 shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:bg-slate-100"
                >
                  <a
                    href="https://cal.com/hyperstack/try-bap"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <T>Book a Demo</T>
                  </a>
                </Button>
              </div>
              <div className="mt-6 flex items-center justify-center">
                <a
                  href="https://github.com/baptistecolle/bap"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-slate-300"
                >
                  <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                  </svg>
                  <T>Star us on GitHub</T>
                </a>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {/* ── Footer ── */}
      {isAnonymous ? (
        <footer className="border-border/40 bg-background border-t px-6 py-10 md:py-14">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
              {/* Brand */}
              <div className="max-w-xs">
                <p className="text-foreground text-sm font-semibold">
                  <T>Bap</T>
                </p>
                <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                  <T>AI coworkers that connect to your tools and automate work across your team.</T>
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <a
                    href="https://github.com/baptistecolle/bap"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={t("GitHub")}
                  >
                    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                    </svg>
                  </a>
                  <a
                    href="https://discord.com/invite/NHQy8gXerd"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={t("Discord")}
                  >
                    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                    </svg>
                  </a>
                </div>
              </div>

              {/* Links */}
              <div className="flex gap-12 md:gap-16">
                <div>
                  <p className="text-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
                    <T>Product</T>
                  </p>
                  <nav className="text-muted-foreground flex flex-col gap-2 text-xs">
                    <a
                      href="https://docs.heybap.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-foreground transition-colors"
                    >
                      <T>Docs</T>
                    </a>
                    <Link to="/pricing" className="hover:text-foreground transition-colors">
                      <T>Pricing</T>
                    </Link>
                    <Link to="/templates" className="hover:text-foreground transition-colors">
                      <T>Templates</T>
                    </Link>
                  </nav>
                </div>
                <div>
                  <p className="text-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
                    <T>Company</T>
                  </p>
                  <nav className="text-muted-foreground flex flex-col gap-2 text-xs">
                    <Link to="/support" className="hover:text-foreground transition-colors">
                      <T>Support</T>
                    </Link>
                    <Link to="/legal/terms" className="hover:text-foreground transition-colors">
                      <T>Terms</T>
                    </Link>
                    <Link
                      to="/legal/privacy-policy"
                      className="hover:text-foreground transition-colors"
                    >
                      <T>Privacy</T>
                    </Link>
                  </nav>
                </div>
              </div>
            </div>

            {/* Bottom line */}
            <div className="border-border/40 text-muted-foreground/60 mt-10 flex flex-col gap-4 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div>
                <T>&copy;</T> {new Date().getFullYear()} <T>Bap. All rights reserved.</T>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs font-medium">
                  <T>Language</T>
                </span>
                <LandingLocaleSelector placement="footer" />
              </div>
            </div>
          </div>
        </footer>
      ) : null}
    </>
  );
}
