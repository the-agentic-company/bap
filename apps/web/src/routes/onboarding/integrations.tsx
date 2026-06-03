"use client";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import { cn } from "@/lib/utils";
import {
  useIntegrationList,
  useGetAuthUrl,
  useCompleteOnboarding,
  useLinkLinkedIn,
} from "@/orpc/hooks";

/**
 * Search params that drive behavior on the onboarding integrations step. These are returned
 * by the LinkedIn / OAuth provider callbacks (`account_id`, `success`, `error`) and are
 * validated at the route boundary so the page consumes typed search state instead of
 * `next/navigation`'s `useSearchParams`.
 */
interface OnboardingIntegrationsSearch {
  account_id?: string;
  success?: string;
  error?: string;
}

function parseStringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const Route = createFileRoute("/onboarding/integrations")({
  validateSearch: (search: Record<string, unknown>): OnboardingIntegrationsSearch => ({
    account_id: parseStringParam(search.account_id),
    success: parseStringParam(search.success),
    error: parseStringParam(search.error),
  }),
  head: () => ({
    meta: [
      { title: "Connect your tools" },
      {
        name: "description",
        content: "Connect your apps so CmdClaw can help with email, calendar, and documents.",
      },
    ],
  }),
  component: OnboardingIntegrationsPage,
});

const integrationConfig = {
  google_gmail: {
    name: "Gmail",
    icon: "/integrations/google-gmail.svg",
  },
  outlook: {
    name: "Outlook",
    icon: "/integrations/outlook.svg",
  },
  outlook_calendar: {
    name: "Outlook Calendar",
    icon: "/integrations/outlook-calendar.svg",
  },
  google_calendar: {
    name: "Calendar",
    icon: "/integrations/google-calendar.svg",
  },
  google_docs: {
    name: "Docs",
    icon: "/integrations/google-docs.svg",
  },
  google_sheets: {
    name: "Sheets",
    icon: "/integrations/google-sheets.svg",
  },
  google_drive: {
    name: "Drive",
    icon: "/integrations/google-drive.svg",
  },
  notion: {
    name: "Notion",
    icon: "/integrations/notion.svg",
  },
  airtable: {
    name: "Airtable",
    icon: "/integrations/airtable.svg",
  },
  slack: {
    name: "Slack",
    icon: "/integrations/slack.svg",
  },
  hubspot: {
    name: "HubSpot",
    icon: "/integrations/hubspot.svg",
  },
  linkedin: {
    name: "LinkedIn",
    icon: "/integrations/linkedin.svg",
  },
} as const;

type IntegrationType = keyof typeof integrationConfig;

const recommendedIntegrations: IntegrationType[] = ["google_gmail", "google_calendar"];
const otherIntegrations: IntegrationType[] = [
  "outlook",
  "outlook_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
];
const allIntegrations: IntegrationType[] = [...recommendedIntegrations, ...otherIntegrations];

function OnboardingIntegrationsFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
    </div>
  );
}

function IntegrationIconButton({
  type,
  isRecommended,
  isConnected,
  isConnecting,
  onConnect,
}: {
  type: IntegrationType;
  isRecommended: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: (type: IntegrationType) => Promise<void>;
}) {
  const config = integrationConfig[type];

  const handleClick = useCallback(() => {
    if (!isConnected) {
      void onConnect(type);
    }
  }, [isConnected, onConnect, type]);

  return (
    <button
      onClick={handleClick}
      disabled={isConnected || isConnecting}
      className={cn(
        "relative flex flex-col items-center gap-1.5 rounded-xl p-3 transition-all sm:gap-2 sm:p-4",
        "border hover:border-primary/50 hover:bg-muted/50",
        isConnected && "border-green-500/50 bg-green-500/5",
        isRecommended && !isConnected && "border-primary/30 bg-primary/5",
        isConnecting && "opacity-50 cursor-wait",
      )}
    >
      {isConnected && (
        <div className="absolute -top-1.5 -right-1.5">
          <CheckCircle2 className="fill-background h-5 w-5 text-green-500" />
        </div>
      )}
      {isRecommended && !isConnected && (
        <span className="text-primary text-[10px] font-medium">Recommended</span>
      )}
      {isConnecting ? (
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      ) : isRecommended ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border bg-white shadow-sm dark:bg-gray-800">
          <img
            src={config.icon}
            alt={config.name}
            width={32}
            height={32}
            loading="lazy"
            decoding="async"
            className="h-8 w-auto"
          />
        </div>
      ) : (
        <div className="flex h-8 w-8 items-center justify-center">
          <img
            src={config.icon}
            alt={config.name}
            width={32}
            height={32}
            loading="lazy"
            decoding="async"
            className="h-8 w-auto"
          />
        </div>
      )}
      <span className="text-muted-foreground text-xs font-medium">{config.name}</span>
    </button>
  );
}

function OnboardingIntegrationsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { data: integrations, isLoading, refetch } = useIntegrationList();
  const getAuthUrl = useGetAuthUrl();
  const completeOnboarding = useCompleteOnboarding();
  const linkLinkedIn = useLinkLinkedIn();
  const [connectingType, setConnectingType] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const linkedInLinkingRef = useRef(false);

  useEffect(() => {
    const accountId = search.account_id;
    if (accountId && !linkedInLinkingRef.current) {
      linkedInLinkingRef.current = true;
      linkLinkedIn
        .mutateAsync(accountId)
        .then(() => {
          refetch();
        })
        .catch((error) => {
          console.error("Failed to link LinkedIn:", error);
        })
        .finally(() => {
          window.history.replaceState({}, "", "/onboarding/integrations");
        });
    }
  }, [search.account_id, linkLinkedIn, refetch]);

  useEffect(() => {
    const success = search.success;
    const error = search.error;

    if (success || error) {
      window.history.replaceState({}, "", "/onboarding/integrations");
      if (success) {
        refetch();
      }
    }
  }, [search.success, search.error, refetch]);

  const handleConnect = useCallback(
    async (type: IntegrationType) => {
      setConnectingType(type);
      setErrorMessage(null);
      try {
        const result = await getAuthUrl.mutateAsync({
          type,
          redirectUrl: `${window.location.origin}/onboarding/integrations`,
        });
        window.location.assign(result.authUrl);
      } catch (error) {
        console.error("Failed to get auth URL:", error);
        setErrorMessage(
          isUnipileMissingCredentialsError(error)
            ? UNIPILE_MISSING_CREDENTIALS_MESSAGE
            : "Failed to start connection. Please try again.",
        );
        setConnectingType(null);
      }
    },
    [getAuthUrl],
  );

  const handleContinue = useCallback(async () => {
    await completeOnboarding.mutateAsync();
    navigate({ to: "/agents" });
  }, [completeOnboarding, navigate]);

  const handleSkip = useCallback(async () => {
    await completeOnboarding.mutateAsync();
    navigate({ to: "/agents" });
  }, [completeOnboarding, navigate]);

  const handleBack = useCallback(() => {
    navigate({ to: "/onboarding/subscriptions" });
  }, [navigate]);

  const integrationsList = Array.isArray(integrations) ? integrations : [];
  const connectedIntegrations = new Set(integrationsList.map((i) => i.type));

  if (isLoading) {
    return <OnboardingIntegrationsFallback />;
  }

  return (
    <>
      <div className="mb-6 text-center sm:mb-8">
        <h1 className="mb-2 text-xl font-semibold tracking-tight sm:text-2xl">
          Connect your tools
        </h1>
        <p className="text-muted-foreground">
          Connect your apps to let the AI assistant help you with tasks like reading emails,
          scheduling meetings, and managing documents.
        </p>
      </div>

      {errorMessage && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-red-700 dark:text-red-400">
          <XCircle className="h-5 w-5" />
          {errorMessage}
        </div>
      )}

      <div className="bg-card mb-6 rounded-2xl border p-4 sm:p-6">
        {/* Mobile: single flat grid, all items same size */}
        <div className="grid grid-cols-3 gap-2 sm:hidden">
          {allIntegrations.map((type) => (
            <IntegrationIconButton
              key={type}
              type={type}
              isRecommended={false}
              isConnected={connectedIntegrations.has(type)}
              isConnecting={connectingType === type}
              onConnect={handleConnect}
            />
          ))}
        </div>

        {/* Desktop: recommended section + divider + other integrations */}
        <div className="hidden sm:block">
          <div className="mb-6 grid grid-cols-5 gap-3">
            {recommendedIntegrations.map((type) => (
              <IntegrationIconButton
                key={type}
                type={type}
                isRecommended
                isConnected={connectedIntegrations.has(type)}
                isConnecting={connectingType === type}
                onConnect={handleConnect}
              />
            ))}
          </div>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card text-muted-foreground px-2">More integrations</span>
            </div>
          </div>

          <div className="grid grid-cols-8 gap-3">
            {otherIntegrations.map((type) => (
              <IntegrationIconButton
                key={type}
                type={type}
                isRecommended={false}
                isConnected={connectedIntegrations.has(type)}
                isConnecting={connectingType === type}
                onConnect={handleConnect}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-2 sm:gap-3">
        <Button variant="ghost" onClick={handleBack} disabled={completeOnboarding.isPending}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back
        </Button>
        <Button variant="ghost" onClick={handleSkip} disabled={completeOnboarding.isPending}>
          Skip for now
        </Button>
        <Button onClick={handleContinue} disabled={completeOnboarding.isPending}>
          {completeOnboarding.isPending ? "Loading..." : "Continue"}
        </Button>
      </div>
    </>
  );
}
