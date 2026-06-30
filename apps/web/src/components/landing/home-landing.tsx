import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import type { TemplateCatalogTemplate } from "@bap/db/template-catalog";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PromptBar, type AttachmentData } from "@/components/prompt-bar";
import {
  ChatDebugPopover,
  type ArmedDebugPreset,
  type ChatDebugSnapshot,
} from "@/components/chat/chat-debug-popover";
import { ModelSelector } from "@/components/chat/model-selector";
import { VoiceIndicator } from "@/components/chat/voice-indicator";
import { AnimatedHowItWorksSection } from "@/components/landing/animated-how-it-works";
import { BentoFeaturesSection } from "@/components/landing/bento-features";
import {
  HERO_PROMPT_EXAMPLES,
  translateHeroDepartment,
  translateHeroPrompt,
  translatePromptSegments,
} from "@/components/landing/hero-prompt-examples";
import { LandingFooterSection } from "@/components/landing/landing-footer";
import { AnimatedDepartment } from "@/components/landing/landing-hero-heading";
import { LandingTemplatesSection } from "@/components/landing/landing-templates";
import {
  clearPendingCoworkerPrompt,
  getPendingCoworkerGenerationContent,
  readPendingCoworkerPrompt,
  takeDraftCoworkerPrompt,
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
import { COWORKER_AVAILABLE_INTEGRATION_TYPES } from "@/lib/integration-icons";
import { buildProviderAuthAvailabilityByProvider } from "@/lib/provider-auth-availability";
import { useCreateCoworker } from "@/orpc/hooks/coworkers";
import { useProviderAuthStatus } from "@/orpc/hooks/provider-auth";
import { useTranscribe } from "@/orpc/hooks/voice";

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

const HERO_BACKGROUND_PLACEHOLDER =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABcQERQRDhcUEhQaGBcbIjklIh8fIkYyNSk5UkhXVVFIUE5bZoNvW2F8Yk5QcptzfIeLkpSSWG2grJ+OqoOPko3/2wBDARgaGiIeIkMlJUONXlBejY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY3/wAARCAAbADADASIAAhEBAxEB/8QAGQAAAgMBAAAAAAAAAAAAAAAAAwQBAgUG/8QAJxAAAgICAQIFBQEAAAAAAAAAAQIAEQMhEjFBBBMiUcEFIzJhcfH/xAAYAQADAQEAAAAAAAAAAAAAAAABAwUCBP/EAB8RAAICAgIDAQAAAAAAAAAAAAECABEDBBIhIjJBYf/aAAwDAQACEQMRAD8AQCywWXCywWU5J5QYWTxh1wse1f2Ex4AxAFte7A0B7xL7GNftx6a2V/lD9inCRxsajIAGY4iLBU7MyvDNlxekHmgv0ntXtFLtAnsUI99MqPE2ZpjiBfWFUqCfUABfQRc6ahoajKovlMa3x+JwvlZvYyjjwInqKkqRqgNpRs2Yti+q48jDlkONwOJta1HMZ2y6oIO36nNMoLZrHQfIgU3C44zeUo+ZeJDgj8gZlY0dPEsqkV5hFHtf+QQ+3iyOhKstUQem4XAxbOxJs8lmgKguz3P/2Q==";
const HERO_BACKGROUND_PLACEHOLDER_STYLE = {
  backgroundImage: `url("${HERO_BACKGROUND_PLACEHOLDER}")`,
  backgroundPosition: "center",
  backgroundSize: "cover",
} as const;

// ─── Landing ─────────────────────────────────────────────────────────────────

type HomeLandingProps = {
  initialHasSession?: boolean;
  initialFirstName?: string | null;
  featuredTemplates: TemplateCatalogTemplate[];
};

function getFirstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/, 1).find(Boolean) ?? null;
}

// ── Presentational sub-sections (keep HomeLanding's own complexity low) ──

function LandingBackdrop({ isAnonymous }: { isAnonymous: boolean }) {
  const mask = isAnonymous
    ? "[mask-image:linear-gradient(to_bottom,black_0%,black_75%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_75%,transparent_100%)]"
    : "";
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${mask}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.22),transparent_55%),radial-gradient(circle_at_80%_10%,rgba(125,211,252,0.2),transparent_45%),linear-gradient(180deg,rgba(2,6,23,0.5)_0%,rgba(2,6,23,0.82)_100%)]" />
      <picture className="absolute inset-0 block overflow-hidden" style={HERO_BACKGROUND_PLACEHOLDER_STYLE}>
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
  );
}

function LandingTopBar({ isAnonymous }: { isAnonymous: boolean }) {
  if (!isAnonymous) {
    return null;
  }
  return (
    <div className="flex items-center justify-end gap-2 pt-5">
      <Button variant="outline" size="sm" asChild className="border-white/45 bg-white/80 hover:bg-white">
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
  );
}

function automateHeadline(userFirstName: string | null, gt: ReturnType<typeof useGT>): string {
  if (userFirstName) {
    return gt("What do you want to automate {name}?", { name: userFirstName });
  }
  return gt("What do you want to automate today?");
}

function heroDepartment(
  activeExample: (typeof HERO_PROMPT_EXAMPLES)[number] | undefined,
  gt: ReturnType<typeof useGT>,
) {
  return {
    label: translateHeroDepartment(activeExample?.department, gt),
    color: activeExample?.color ?? "#3B82F6",
  };
}

function HeroHeadline({
  isAnonymous,
  activeExample,
  gt,
  userFirstName,
}: {
  isAnonymous: boolean;
  activeExample: (typeof HERO_PROMPT_EXAMPLES)[number] | undefined;
  gt: ReturnType<typeof useGT>;
  userFirstName: string | null;
}) {
  if (!isAnonymous) {
    return <>{automateHeadline(userFirstName, gt)}</>;
  }
  const department = heroDepartment(activeExample, gt);
  return (
    <>
      <T>What do you want to automate in</T>{" "}
      <AnimatedDepartment department={department.label} color={department.color} isActive />
      ?
    </>
  );
}

function HeroVoice({
  isRecording,
  isProcessingVoice,
  voiceError,
  gt,
}: {
  isRecording: boolean;
  isProcessingVoice: boolean;
  voiceError: ComponentProps<typeof VoiceIndicator>["error"];
  gt: ReturnType<typeof useGT>;
}) {
  if (!isRecording && !isProcessingVoice && !voiceError) {
    return null;
  }
  return (
    <div className="mt-4">
      <VoiceIndicator
        isRecording={isRecording}
        isProcessing={isProcessingVoice}
        error={voiceError}
        variant="hero"
        recordingLabel={gt("Recording... Click the mic again to stop")}
      />
    </div>
  );
}

function LandingPreviewModal({
  isMobile,
  featuredTemplates,
  previewId,
}: {
  isMobile: boolean;
  featuredTemplates: TemplateCatalogTemplate[];
  previewId: string | null;
}) {
  if (isMobile) {
    return null;
  }
  return (
    <TemplatePreviewModal
      template={featuredTemplates.find((template) => template.id === previewId) ?? null}
      closeHref="/"
    />
  );
}

function AnonymousLandingSections({ isAnonymous }: { isAnonymous: boolean }) {
  if (!isAnonymous) {
    return null;
  }
  return (
    <>
      <BentoFeaturesSection />
      <AnimatedHowItWorksSection />
      <TeamShowcaseSection />
      <LandingFooterSection />
    </>
  );
}

export function HomeLanding({
  initialHasSession = false,
  initialFirstName = null,
  featuredTemplates,
}: HomeLandingProps) {
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

  // A "Deploy to HeyBap" click from a use-case agent stores a draft prompt. Pre-fill the composer
  // with it (without submitting) so the user can edit and send it themselves.
  useEffect(() => {
    const draft = takeDraftCoworkerPrompt();
    if (draft) {
      setInputPrefillRequest({ id: `deploy-draft-${Date.now()}`, text: draft, mode: "replace" });
    }
  }, []);
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
        <LandingBackdrop isAnonymous={isAnonymous} />

        <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-20 bg-gradient-to-b from-transparent to-slate-950/70 sm:hidden" />

        <div className="relative z-10 mx-auto w-full max-w-[1500px] px-6 pb-10">
          {/* ── Top bar ── */}
          <LandingTopBar isAnonymous={isAnonymous} />

          {/* ── Prompt area — centered hero ── */}
          <section className="flex min-h-[62vh] items-center justify-center pt-8 md:min-h-[max(22rem,calc(100dvh-21rem))] md:pt-10 lg:min-h-[max(23rem,calc(100dvh-22rem))] lg:pt-12">
            <div className="mx-auto w-full max-w-3xl">
              <h1 className="mb-3 text-center text-3xl font-semibold tracking-tight text-white drop-shadow-[0_0_30px_rgba(56,189,248,0.25)] md:text-4xl lg:text-5xl">
                <HeroHeadline
                  isAnonymous={isAnonymous}
                  activeExample={activeExample}
                  gt={gt}
                  userFirstName={userFirstName}
                />
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
              <HeroVoice
                isRecording={isRecording}
                isProcessingVoice={isProcessingVoice}
                voiceError={voiceError}
                gt={gt}
              />
            </div>
          </section>

          {/* ── Templates ── */}
          <LandingTemplatesSection featuredTemplates={featuredTemplates} isMobile={isMobile} />
        </div>
        <LandingPreviewModal isMobile={isMobile} featuredTemplates={featuredTemplates} previewId={previewId} />
      </div>

      {/* ── Landing sections (anonymous only) ── */}
      <AnonymousLandingSections isAnonymous={isAnonymous} />
    </>
  );
}
