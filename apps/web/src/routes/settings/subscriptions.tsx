import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useProviderAuthStatus,
  useConnectProvider,
  useDisconnectProvider,
  usePollProviderConnection,
} from "@/orpc/hooks";

type SubscriptionsSearch = {
  provider_connected?: string;
  provider_error?: string;
};

/**
 * `validateSearch` captures the OAuth completion flags the provider callback redirects
 * back with (`provider_connected` / `provider_error`). The component reads them via
 * `Route.useSearch()` (replacing the old `next/navigation` `useSearchParams`) and clears
 * them with `history.replaceState` so the success/error toast only fires once.
 */
export const Route = createFileRoute("/settings/subscriptions")({
  validateSearch: (search: Record<string, unknown>): SubscriptionsSearch => ({
    provider_connected:
      typeof search.provider_connected === "string" ? search.provider_connected : undefined,
    provider_error:
      typeof search.provider_error === "string" ? search.provider_error : undefined,
  }),
  head: () => ({ meta: [{ title: "Connected AI Account - CmdClaw" }] }),
  component: SubscriptionsPage,
});

type ProviderID = "openai";
type ProviderAuthType = "oauth";
type DeviceFlowState = {
  provider: "openai";
  flowId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresAt: number;
};

const PROVIDER_LABELS: Record<ProviderID, string> = {
  openai: "ChatGPT",
};

const getProviderLabel = (provider: ProviderID | string) =>
  PROVIDER_LABELS[provider as ProviderID] ?? provider;

const PROVIDERS: {
  id: ProviderID;
  authType: ProviderAuthType;
  name: string;
  description: string;
  logoUrl: string;
  logoAlt: string;
  logoClassName?: string;
  models: string[];
}[] = [
  {
    id: "openai",
    authType: "oauth",
    name: "ChatGPT",
    description: "Use your ChatGPT Plus/Pro/Max account",
    logoUrl: "/integrations/openai.svg",
    logoAlt: "OpenAI logo",
    logoClassName: "dark:invert",
    models: ["GPT-5.4", "GPT-5.4 Mini"],
  },
];

function SearchParamsHandler() {
  const { provider_connected: connected, provider_error: error } = Route.useSearch();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (connected) {
      toast.success(`${getProviderLabel(connected)} connected successfully!`);
      queryClient.invalidateQueries({ queryKey: ["providerAuth"] });
      window.history.replaceState({}, "", "/settings/subscriptions");
    } else if (error) {
      toast.error(`Connection failed: ${error.replace(/_/g, " ")}`);
      window.history.replaceState({}, "", "/settings/subscriptions");
    }
  }, [connected, error, queryClient]);

  return null;
}

function ProviderConnectButton({
  providerId,
  isConnected,
  isConnecting,
  isDisconnecting,
  onConnect,
  onDisconnect,
}: {
  providerId: ProviderID;
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  onConnect: (provider: ProviderID) => Promise<void>;
  onDisconnect: (provider: ProviderID) => Promise<void>;
}) {
  const handleConnectClick = useCallback(() => {
    void onConnect(providerId);
  }, [onConnect, providerId]);

  const handleDisconnectClick = useCallback(() => {
    void onDisconnect(providerId);
  }, [onDisconnect, providerId]);

  if (isConnected) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleDisconnectClick}
        disabled={isDisconnecting}
      >
        {isDisconnecting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
        Disconnect
      </Button>
    );
  }

  return (
    <Button size="sm" onClick={handleConnectClick} disabled={isConnecting}>
      {isConnecting ? (
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
      ) : (
        <ExternalLink className="mr-2 h-3 w-3" />
      )}
      Connect
    </Button>
  );
}

function SubscriptionsPage() {
  const { data, isLoading, refetch } = useProviderAuthStatus();
  const connectProvider = useConnectProvider();
  const pollProvider = usePollProviderConnection();
  const disconnectProvider = useDisconnectProvider();
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
            toast.success(`${getProviderLabel(deviceFlow.provider)} connected successfully!`);
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

  const handleConnect = useCallback(
    async (provider: ProviderID) => {
      setConnectingProvider(provider);

      try {
        const result = await connectProvider.mutateAsync(provider);

        if (result.mode === "device") {
          setDeviceFlow({
            provider,
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
    },
    [connectProvider],
  );

  const handleDisconnect = useCallback(
    async (provider: ProviderID) => {
      try {
        await disconnectProvider.mutateAsync(provider);
        toast.success(`${getProviderLabel(provider)} disconnected.`);
      } catch (error) {
        console.error("Failed to disconnect:", error);
        toast.error("Failed to disconnect. Please try again.");
      }
    },
    [disconnectProvider],
  );

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  const connected = data?.connected ?? {};

  return (
    <div>
      <SearchParamsHandler />
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Connected AI Account</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect your existing AI account to use provider-backed models without consuming CmdClaw
          credits.
        </p>
      </div>

      {deviceFlow && (
        <div className="mb-6 rounded-lg border p-4">
          <p className="text-sm font-medium">ChatGPT Pro/Plus (Device Code)</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Open the verification page and enter the code below.
          </p>
          <p className="mt-2 text-sm">
            Go to this link:{" "}
            <a
              href="https://auth.openai.com/codex/device"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              https://auth.openai.com/codex/device
            </a>
          </p>
          <div className="bg-muted mt-3 rounded-md px-3 py-2 font-mono text-lg tracking-wider">
            {deviceFlow.userCode}
          </div>
          <div className="mt-2 h-5">
            <div
              className={cn(
                "flex items-center gap-1 text-xs text-green-700 transition-all duration-300 dark:text-green-400",
                copySuccess ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5 animate-pulse" />
              Code copied
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyDeviceCode}
              className={cn(
                "transition-colors duration-300",
                copySuccess && "border-green-500 text-green-700 dark:text-green-400",
              )}
            >
              {copySuccess ? (
                <>
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5 animate-pulse" />
                  Copied
                </>
              ) : (
                "Copy code"
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCancelDeviceFlow}>
              Cancel
            </Button>
            <div className="text-muted-foreground ml-auto flex items-center text-xs">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Waiting for authorization...
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {PROVIDERS.map((provider) => {
          const isConnected = provider.id in connected;
          const isConnecting = connectingProvider === provider.id;
          const isDisconnecting = disconnectProvider.isPending;

          return (
            <div key={provider.id} className="rounded-lg border p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <img
                      src={provider.logoUrl}
                      alt={provider.logoAlt}
                      width={20}
                      height={20}
                      loading="lazy"
                      decoding="async"
                      className={cn("h-5 w-auto shrink-0", provider.logoClassName)}
                    />
                    <h3 className="font-medium">{provider.name}</h3>
                    {isConnected && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">{provider.description}</p>
                </div>

                <div className="shrink-0">
                  <ProviderConnectButton
                    providerId={provider.id}
                    isConnected={isConnected}
                    isConnecting={isConnecting}
                    isDisconnecting={isDisconnecting}
                    onConnect={handleConnect}
                    onDisconnect={handleDisconnect}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
