import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, ClipboardCopy, ExternalLink, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useProviderAuthStatus,
  useConnectProvider,
  usePollProviderConnection,
} from "@/orpc/hooks/provider-auth";

export const Route = createFileRoute("/onboarding/subscriptions")({
  head: () => ({
    meta: [
      { title: "Bring your AI subscription" },
      {
        name: "description",
        content: "Connect your existing AI account to unlock additional models on CmdClaw.",
      },
    ],
  }),
  component: OnboardingSubscriptionsPage,
});

type ProviderID = "openai";

type DeviceFlowState = {
  provider: "openai";
  flowId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresAt: number;
};

const PROVIDERS = [
  {
    id: "openai" as ProviderID,
    name: "ChatGPT",
    description: "Use your ChatGPT Plus, Pro, or Max subscription",
    logoUrl: "/integrations/openai.svg",
    logoAlt: "OpenAI logo",
    logoClassName: "dark:invert",
    models: ["GPT-5.4", "GPT-5.4 Mini"],
  },
];

function OnboardingSubscriptionsFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
    </div>
  );
}

function DeviceFlowPanel({
  deviceFlow,
  copySuccess,
  onCopy,
  onCancel,
}: {
  deviceFlow: DeviceFlowState;
  copySuccess: boolean;
  onCopy: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="bg-card rounded-2xl border p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Enter this code to connect</p>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground -mr-1 rounded-lg p-1 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-muted-foreground mt-2 text-sm">
        Open the verification page below and paste this code to authorize CmdClaw.
      </p>

      <div className="bg-muted/60 mt-4 flex items-center justify-between rounded-xl px-3 py-3 sm:px-5 sm:py-4">
        <span className="font-mono text-xl font-semibold tracking-[0.15em] sm:text-2xl sm:tracking-[0.2em]">
          {deviceFlow.userCode}
        </span>
        <button
          onClick={onCopy}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
            copySuccess
              ? "bg-green-500/10 text-green-700 dark:text-green-400"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {copySuccess ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <ClipboardCopy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <a
          href="https://auth.openai.com/codex/device"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 transition-opacity hover:opacity-80"
        >
          Open verification page
          <ExternalLink className="h-3 w-3" />
        </a>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Waiting for authorization…
        </div>
      </div>
    </div>
  );
}

function ProviderCard({
  isConnected,
  isConnecting,
  onConnect,
}: {
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
}) {
  const provider = PROVIDERS[0];

  return (
    <div
      className={cn(
        "bg-card rounded-2xl border p-4 transition-colors sm:p-6",
        isConnected && "border-green-500/40",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white shadow-sm sm:h-12 sm:w-12 sm:rounded-xl dark:bg-gray-800">
          <img
            src={provider.logoUrl}
            alt={provider.logoAlt}
            width={28}
            height={28}
            loading="lazy"
            decoding="async"
            className={cn("h-7 w-auto", provider.logoClassName)}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{provider.name}</h3>
            {isConnected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3" />
                Connected
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">{provider.description}</p>
        </div>

        {!isConnected && (
          <Button size="sm" onClick={onConnect} disabled={isConnecting} className="shrink-0">
            {isConnecting ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
            )}
            Connect
          </Button>
        )}
      </div>

      {!isConnected && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {provider.models.map((model) => (
            <span
              key={model}
              className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-[11px] font-medium"
            >
              {model}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function OnboardingSubscriptionsPage() {
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useProviderAuthStatus();
  const connectProvider = useConnectProvider();
  const pollProvider = usePollProviderConnection();
  const [connectingProvider, setConnectingProvider] = useState<ProviderID | null>(null);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowState | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!deviceFlow) {
      return;
    }

    if (Date.now() >= deviceFlow.expiresAt) {
      toast.error("Device code expired. Please reconnect to generate a new code.");
      setDeviceFlow(null);
      setConnectingProvider(null);
      return;
    }

    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const result = await pollProvider.mutateAsync({
            provider: deviceFlow.provider,
            flowId: deviceFlow.flowId,
          });

          if (result.status === "connected") {
            await refetch();
            toast.success("ChatGPT connected successfully!");
            setDeviceFlow(null);
            setConnectingProvider(null);
            return;
          }

          if (result.status === "failed") {
            toast.error(`Connection failed: ${result.error.replace(/_/g, " ")}`);
            setDeviceFlow(null);
            setConnectingProvider(null);
            return;
          }

          if (result.status === "pending" && result.interval) {
            setDeviceFlow((prev) => (prev ? { ...prev, interval: result.interval } : prev));
          }
        } catch (error) {
          console.error("Failed polling provider auth:", error);
        }
      })();
    }, deviceFlow.interval * 1000);

    return () => clearTimeout(timeout);
  }, [deviceFlow, pollProvider, refetch]);

  const handleConnect = useCallback(async () => {
    setConnectingProvider("openai");

    try {
      const result = await connectProvider.mutateAsync("openai");

      if (result.mode === "device") {
        setDeviceFlow({
          provider: "openai",
          flowId: result.flowId,
          userCode: result.userCode,
          verificationUri: result.verificationUri,
          verificationUriComplete: result.verificationUriComplete,
          interval: result.interval,
          expiresAt: Date.now() + result.expiresIn * 1000,
        });
        return;
      }

      if (result.mode === "redirect") {
        window.location.href = result.authUrl;
        return;
      }

      setConnectingProvider(null);
    } catch (error) {
      console.error("Failed to start OAuth flow:", error);
      toast.error("Failed to start connection. Please try again.");
      setConnectingProvider(null);
    }
  }, [connectProvider]);

  const handleCopyDeviceCode = useCallback(() => {
    if (!deviceFlow) {
      return;
    }
    void (async () => {
      try {
        await navigator.clipboard.writeText(deviceFlow.userCode);
        setCopySuccess(true);

        if (copyFeedbackTimeoutRef.current) {
          clearTimeout(copyFeedbackTimeoutRef.current);
        }

        copyFeedbackTimeoutRef.current = window.setTimeout(() => {
          setCopySuccess(false);
        }, 1800);
      } catch (error) {
        console.error("Failed to copy device code:", error);
      }
    })();
  }, [deviceFlow]);

  const handleCancelDeviceFlow = useCallback(() => {
    setDeviceFlow(null);
    setConnectingProvider(null);
    setCopySuccess(false);
  }, []);

  const handleContinue = useCallback(() => {
    navigate({ to: "/onboarding/integrations" });
  }, [navigate]);

  const handleSkip = useCallback(() => {
    navigate({ to: "/onboarding/integrations" });
  }, [navigate]);

  const connected = data?.connected ?? {};
  const isConnected = "openai" in connected;

  if (isLoading) {
    return <OnboardingSubscriptionsFallback />;
  }

  return (
    <>
      <div className="mb-6 text-center sm:mb-8">
        <h1 className="mb-2 text-xl font-semibold tracking-tight sm:text-2xl">
          Bring your AI subscription
        </h1>
        <p className="text-muted-foreground">
          Connect your existing AI account to unlock additional models at no extra cost on CmdClaw.
        </p>
      </div>

      <div className="mb-4 space-y-4">
        {deviceFlow ? (
          <DeviceFlowPanel
            deviceFlow={deviceFlow}
            copySuccess={copySuccess}
            onCopy={handleCopyDeviceCode}
            onCancel={handleCancelDeviceFlow}
          />
        ) : (
          <ProviderCard
            isConnected={isConnected}
            isConnecting={connectingProvider === "openai"}
            onConnect={handleConnect}
          />
        )}
      </div>

      <div className="flex justify-center gap-3">
        <Button variant="ghost" onClick={handleSkip}>
          Skip for now
        </Button>
        <Button onClick={handleContinue}>Continue</Button>
      </div>
    </>
  );
}
