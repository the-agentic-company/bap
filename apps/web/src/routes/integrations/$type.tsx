import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useState } from "react";
import { IntegrationDetailContent } from "@/components/integration-detail-content";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import { type IntegrationType as IntegrationIconType } from "@/lib/integration-icons";
import {
  useIntegrationList,
  useGetAuthUrl,
  useGoogleAccessStatus,
  useToggleIntegration,
  useDisconnectIntegration,
  useRenameAccountLabel,
  useRequestGoogleAccess,
} from "@/orpc/hooks/integrations";

type OAuthIntegrationType = Exclude<IntegrationIconType, "linear">;

function isOAuthIntegrationType(type: string): type is OAuthIntegrationType {
  return type !== "linear";
}

// ─── Integration config (shared with toolbox) ────────────────────────────────

const integrationConfig: Record<string, { name: string; description: string; icon: string }> = {
  google_gmail: {
    name: "Google Gmail",
    description: "Read and send emails",
    icon: "/integrations/google-gmail.svg",
  },
  outlook: {
    name: "Outlook Mail",
    description: "Read and send emails",
    icon: "/integrations/outlook.svg",
  },
  outlook_calendar: {
    name: "Outlook Calendar",
    description: "Manage events and calendars",
    icon: "/integrations/outlook-calendar.svg",
  },
  google_calendar: {
    name: "Google Calendar",
    description: "Manage events and calendars",
    icon: "/integrations/google-calendar.svg",
  },
  google_docs: {
    name: "Google Docs",
    description: "Read and edit documents",
    icon: "/integrations/google-docs.svg",
  },
  google_sheets: {
    name: "Google Sheets",
    description: "Read and edit spreadsheets",
    icon: "/integrations/google-sheets.svg",
  },
  google_drive: {
    name: "Google Drive",
    description: "Access and manage files",
    icon: "/integrations/google-drive.svg",
  },
  notion: {
    name: "Notion",
    description: "Search and create pages",
    icon: "/integrations/notion.svg",
  },
  airtable: {
    name: "Airtable",
    description: "Read and update bases",
    icon: "/integrations/airtable.svg",
  },
  slack: {
    name: "Slack",
    description: "Send messages and read channels",
    icon: "/integrations/slack.svg",
  },
  hubspot: {
    name: "HubSpot",
    description: "Manage CRM contacts, deals, and tickets",
    icon: "/integrations/hubspot.svg",
  },
  linkedin: {
    name: "LinkedIn",
    description: "Send messages, manage connections, and post content",
    icon: "/integrations/linkedin.svg",
  },
  salesforce: {
    name: "Salesforce",
    description: "Query and manage CRM records and contacts",
    icon: "/integrations/salesforce.svg",
  },
  dynamics: {
    name: "Microsoft Dynamics 365",
    description: "Manage Dataverse tables and CRM rows",
    icon: "/integrations/dynamics.svg",
  },
  reddit: {
    name: "Reddit",
    description: "Browse, vote, comment, and post on Reddit",
    icon: "/integrations/reddit.svg",
  },
  twitter: {
    name: "X (Twitter)",
    description: "Post tweets, manage followers, and search content",
    icon: "/integrations/twitter.svg",
  },
  whatsapp: {
    name: "WhatsApp",
    description: "Link WhatsApp and pair the bridge with QR",
    icon: "/integrations/whatsapp.svg",
  },
};

type GoogleIntegrationType =
  | "google_gmail"
  | "google_calendar"
  | "google_docs"
  | "google_sheets"
  | "google_drive";
const googleIntegrationTypes = new Set<GoogleIntegrationType>([
  "google_gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
]);
function isGoogleIntegrationType(type: string): type is GoogleIntegrationType {
  return googleIntegrationTypes.has(type as GoogleIntegrationType);
}

// ─── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/integrations/$type")({
  head: () => ({ meta: [{ title: "Integration - CmdClaw" }] }),
  component: IntegrationDetailPage,
});

function IntegrationDetailPage() {
  const { type } = Route.useParams();
  const config = integrationConfig[type];

  const { data: integrations, refetch: refetchIntegrations } = useIntegrationList();
  const { data: googleAccessStatus } = useGoogleAccessStatus();
  const getAuthUrl = useGetAuthUrl();
  const toggleIntegration = useToggleIntegration();
  const disconnectIntegration = useDisconnectIntegration();
  const renameAccountLabel = useRenameAccountLabel();
  const requestGoogleAccess = useRequestGoogleAccess();

  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string>();

  const integrationsList = useMemo(
    () => (Array.isArray(integrations) ? integrations : []),
    [integrations],
  );
  const integration = useMemo(
    () => integrationsList.find((i) => i.type === type) ?? null,
    [integrationsList, type],
  );
  const integrationsForType = useMemo(
    () => integrationsList.filter((i) => i.type === type),
    [integrationsList, type],
  );

  const isWhatsApp = type === "whatsapp";
  const lacksGoogleAccess = googleAccessStatus?.allowed === false;
  const isGoogleType = !isWhatsApp && isGoogleIntegrationType(type);
  const showGoogleRequest = !integration && isGoogleType && lacksGoogleAccess;

  const handleConnect = useCallback(async () => {
    if (isWhatsApp) {
      return;
    }
    if (!isOAuthIntegrationType(type)) {
      setConnectError("This integration is connected through Workspace MCP settings.");
      return;
    }
    setIsConnecting(true);
    setConnectError(undefined);
    try {
      const result = await getAuthUrl.mutateAsync({
        type,
        redirectUrl: window.location.href,
      });
      window.location.assign(result.authUrl);
    } catch (error) {
      setIsConnecting(false);
      const message = error instanceof Error ? error.message : "";
      setConnectError(
        isUnipileMissingCredentialsError(error)
          ? UNIPILE_MISSING_CREDENTIALS_MESSAGE
          : message.includes("admin approval")
            ? "Google access is restricted. Use Request access first."
            : "Failed to start connection. Please try again.",
      );
    }
  }, [getAuthUrl, isWhatsApp, type]);

  const handleConnectAnother = useCallback(async () => {
    if (isWhatsApp) {
      return;
    }
    if (!isOAuthIntegrationType(type)) {
      setConnectError("This integration is connected through Workspace MCP settings.");
      return;
    }
    setIsConnecting(true);
    setConnectError(undefined);
    try {
      const result = await getAuthUrl.mutateAsync({
        type,
        redirectUrl: window.location.href,
        mode: "connect",
      });
      window.location.assign(result.authUrl);
    } catch (error) {
      setIsConnecting(false);
      const message = error instanceof Error ? error.message : "";
      setConnectError(
        isUnipileMissingCredentialsError(error)
          ? UNIPILE_MISSING_CREDENTIALS_MESSAGE
          : message.includes("admin approval")
            ? "Google access is restricted. Use Request access first."
            : "Failed to start connection. Please try again.",
      );
    }
  }, [getAuthUrl, isWhatsApp, type]);

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      if (!integration) {
        return;
      }
      await toggleIntegration.mutateAsync({ id: integration.id, enabled });
      refetchIntegrations();
    },
    [integration, refetchIntegrations, toggleIntegration],
  );

  const handleDisconnect = useCallback(async () => {
    if (!integration) {
      return;
    }
    await disconnectIntegration.mutateAsync(integration.id);
    refetchIntegrations();
  }, [disconnectIntegration, integration, refetchIntegrations]);

  const handleDisconnectAccount = useCallback(
    async (id: string) => {
      await disconnectIntegration.mutateAsync(id);
      refetchIntegrations();
    },
    [disconnectIntegration, refetchIntegrations],
  );

  const handleToggleAccount = useCallback(
    async (id: string, enabled: boolean) => {
      await toggleIntegration.mutateAsync({ id, enabled });
      refetchIntegrations();
    },
    [refetchIntegrations, toggleIntegration],
  );

  const handleRequestGoogleAccess = useCallback(async () => {
    if (!isGoogleType) {
      return;
    }
    await requestGoogleAccess.mutateAsync({
      integration: type as GoogleIntegrationType,
      source: "integrations",
    });
  }, [isGoogleType, requestGoogleAccess, type]);

  if (!config) {
    return (
      <div className="mx-auto max-w-3xl pb-8">
        <Link
          to="/toolbox"
          className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <ArrowLeft className="size-3" />
          Back to Toolbox
        </Link>
        <p className="text-muted-foreground text-sm">Integration not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-8">
      <Link
        to="/toolbox"
        className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft className="size-3" />
        Back to Toolbox
      </Link>

      <IntegrationDetailContent
        type={type}
        config={config}
        integration={integration}
        integrations={integrationsForType}
        isWhatsApp={isWhatsApp}
        connectError={connectError}
        showGoogleRequest={showGoogleRequest}
        isConnecting={isConnecting}
        onConnect={handleConnect}
        onConnectAnother={handleConnectAnother}
        onToggle={handleToggle}
        onToggleAccount={handleToggleAccount}
        onDisconnect={handleDisconnect}
        onDisconnectAccount={handleDisconnectAccount}
        onRequestGoogleAccess={handleRequestGoogleAccess}
        onRenameAccountLabel={renameAccountLabel.mutate}
      />
    </div>
  );
}
