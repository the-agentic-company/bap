// oxlint-disable jsx-a11y/control-has-associated-label

import {
  ArrowUp,
  Copy,
  FileInput,
  FileOutput,
  Globe,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Puzzle,
  Search,
  Share2,
  Table,
  Trash2,
  Wand2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IntegrationBadges } from "@/components/chat/integration-badges";
import { WorkspaceMcpServerLogo } from "@/components/executor-source-logo";
import { ToolboxPreviewModal } from "@/components/toolbox-preview-modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconDisplay } from "@/components/ui/icon-picker";
import { AnimatedTabs, AnimatedTab } from "@/components/ui/tabs";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useIsMobile } from "@/hooks/use-mobile";
import { blobToBase64 } from "@/hooks/use-voice-recording";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import {
  type DisplayIntegrationType,
  isComingSoonIntegration,
  type IntegrationType as IntegrationIconType,
} from "@/lib/integration-icons";
import { formatOAuthConnectionError } from "@/lib/oauth-error-message";
import { cn } from "@/lib/utils";
import {
  useIntegrationList,
  useGetAuthUrl,
  useGoogleAccessStatus,
  useToggleIntegration,
  useDisconnectIntegration,
  useRenameAccountLabel,
  useLinkLinkedIn,
  useRequestGoogleAccess,
} from "@/orpc/hooks/integrations";
import {
  useSkillList,
  useCreateSkill,
  useImportSkill,
  useDeleteSkill,
  useSaveSharedSkill,
  useShareSkill,
  useUnshareSkill,
} from "@/orpc/hooks/skills";
import { useWorkspaceMcpServerList } from "@/orpc/hooks/workspace-mcp-servers";
import { AppImage } from "../-lib/app-image";
import { AppLink } from "../-lib/app-link";
import { useRouter, useSearchParams } from "../-lib/next-navigation-compat";

// ─── Types ──────────────────────────────────────────────────────────────────────

type FilterTab = "all" | "active" | "needs_setup";

type IntegrationType = IntegrationIconType | "whatsapp";

type OAuthIntegrationType = Exclude<IntegrationIconType, "linear">;

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

function isGoogleIntegrationType(type: OAuthIntegrationType): type is GoogleIntegrationType {
  return googleIntegrationTypes.has(type as GoogleIntegrationType);
}

// ─── Integration config ─────────────────────────────────────────────────────────

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

const adminPreviewOnlyIntegrations = new Set<IntegrationType>(
  (Object.keys(integrationConfig) as IntegrationType[]).filter((type) => {
    if (type === "whatsapp") {
      return true;
    }
    return isComingSoonIntegration(type as IntegrationIconType);
  }),
);

// ─── Community skills ───────────────────────────────────────────────────────────

type CommunitySkill = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  icon: React.ReactNode;
  logoUrl?: string;
  category: string;
  kind: "skill" | "tool-integration";
  enabled: boolean;
};

const COMMUNITY_SKILLS: CommunitySkill[] = [
  {
    id: "agent-browser",
    slug: "agent-browser",
    displayName: "Browser",
    description:
      "Browse the web autonomously — search, navigate, extract data, and interact with pages on behalf of the user.",
    icon: <Globe className="h-5 w-5" />,
    logoUrl: "/tools/browser.svg",
    category: "Automation",
    kind: "tool-integration",
    enabled: true,
  },
  {
    id: "fill-pdf",
    slug: "fill-pdf",
    displayName: "Fill PDF",
    description:
      "Fill PDF form fields programmatically from structured data. Supports text fields, checkboxes, and dropdowns.",
    icon: <FileInput className="h-5 w-5" />,
    category: "Documents",
    kind: "skill",
    enabled: true,
  },
  {
    id: "docx",
    slug: "docx",
    displayName: "Docx",
    description:
      "Generate polished Word documents from templates or scratch — headings, tables, images, and custom styles.",
    icon: <FileOutput className="h-5 w-5" />,
    logoUrl: "/integrations/google-docs.svg",
    category: "Documents",
    kind: "skill",
    enabled: true,
  },
  {
    id: "xlsx",
    slug: "xlsx",
    displayName: "Xlsx",
    description:
      "Create and manipulate Excel spreadsheets — multiple sheets, formulas, conditional formatting, and charts.",
    icon: <Table className="h-5 w-5" />,
    logoUrl: "/integrations/google-sheets.svg",
    category: "Documents",
    kind: "skill",
    enabled: false,
  },
  {
    id: "skill-creator",
    slug: "skill-creator",
    displayName: "Skill Creator",
    description:
      "Describe what you need in plain language and this skill generates a fully functional new skill with instructions and files.",
    icon: <Wand2 className="h-5 w-5" />,
    category: "Utilities",
    kind: "skill",
    enabled: true,
  },
];

const CARD_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: "easeOut" },
} as const;

const FADE_IN_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────────

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

// ─── Card components ────────────────────────────────────────────────────────────

function IntegrationToolCard({
  config,
  href,
  integration,
  connectError,
  isPreviewOnly,
}: {
  config: { name: string; description: string; icon: string };
  href: string;
  integration: {
    id: string;
    type: string;
    enabled: boolean;
    displayName: string | null;
    setupRequired?: boolean;
  } | null;
  connectError?: string;
  isPreviewOnly: boolean;
}) {
  const isConnected = !!integration;
  const isEnabled = integration?.enabled ?? false;

  return (
    <motion.div
      layout
      initial={CARD_MOTION.initial}
      animate={CARD_MOTION.animate}
      exit={CARD_MOTION.exit}
      transition={CARD_MOTION.transition}
    >
      <AppLink
        href={href}
        scroll={false}
        className={cn(
          "border-border bg-card hover:border-foreground/30 hover:bg-muted/30 group relative flex h-full min-h-[180px] w-full flex-col rounded-xl border p-5 transition-all duration-150",
          isPreviewOnly && "opacity-50",
          connectError && "border-red-500/30",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white p-1.5 shadow-sm dark:bg-gray-800">
              <AppImage
                src={config.icon}
                alt={config.name}
                width={22}
                height={22}
                className="h-auto max-h-[22px] w-auto max-w-[22px] object-contain"
              />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] leading-tight font-medium">{config.name}</p>
              <div className="mt-1 flex items-center gap-1.5">
                {isConnected ? (
                  <>
                    <span
                      className={cn(
                        "inline-block h-1.5 w-1.5 rounded-full",
                        isEnabled ? "bg-emerald-500" : "bg-amber-500",
                      )}
                    />
                    <span
                      className={cn(
                        "text-[10px] font-medium",
                        isEnabled
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {isEnabled ? "Connected" : "Disabled"}
                    </span>
                  </>
                ) : isPreviewOnly ? (
                  <span className="text-muted-foreground/60 text-[10px] font-medium">
                    Coming soon
                  </span>
                ) : connectError ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span className="text-[10px] font-medium text-red-500">Error</span>
                  </>
                ) : (
                  <span className="text-muted-foreground text-[10px] font-medium">
                    Not connected
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "mt-0.5 size-2 rounded-full",
                isConnected && isEnabled ? "bg-green-500" : "bg-muted-foreground/30",
              )}
            />
            <span className="text-muted-foreground text-xs">
              {isConnected && isEnabled ? "On" : "Off"}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-relaxed">
          {config.description}
        </p>

        {/* Error */}
        {connectError && (
          <p className="mt-2 text-[11px] leading-snug text-red-500 dark:text-red-400">
            {connectError}
          </p>
        )}

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
            Integration
          </span>
          <ArrowUp className="text-muted-foreground/30 group-hover:text-muted-foreground size-3.5 rotate-45 transition-colors" />
        </div>
      </AppLink>
    </motion.div>
  );
}

function CommunityToolCard({ skill, enabled }: { skill: CommunitySkill; enabled: boolean }) {
  const isToolIntegration = skill.kind === "tool-integration";

  return (
    <motion.div
      layout
      initial={CARD_MOTION.initial}
      animate={CARD_MOTION.animate}
      exit={CARD_MOTION.exit}
      transition={CARD_MOTION.transition}
    >
      <AppLink
        href={`/toolbox?preview=community:${skill.id}`}
        scroll={false}
        className={cn(
          "border-border bg-card hover:border-foreground/30 hover:bg-muted/30 group relative flex h-full min-h-[180px] w-full flex-col rounded-xl border p-5 transition-all duration-150",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
                skill.logoUrl ? "border bg-white p-1.5 shadow-sm dark:bg-gray-800" : "bg-muted/60",
                !skill.logoUrl && (enabled ? "text-foreground" : "text-muted-foreground"),
              )}
            >
              {skill.logoUrl ? (
                <AppImage
                  src={skill.logoUrl}
                  alt={skill.displayName}
                  width={22}
                  height={22}
                  className="h-auto max-h-[22px] w-auto max-w-[22px] object-contain"
                />
              ) : (
                skill.icon
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] leading-tight font-medium">{skill.displayName}</p>
              <span className="text-muted-foreground mt-0.5 block text-[10px] font-medium tracking-wider uppercase">
                {skill.category}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "mt-0.5 size-2 rounded-full",
                enabled ? "bg-green-500" : "bg-muted-foreground/30",
              )}
            />
            <span className="text-muted-foreground text-xs">{enabled ? "On" : "Off"}</span>
          </div>
        </div>

        {/* Description */}
        <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-relaxed">
          {skill.description}
        </p>

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
            {isToolIntegration ? "Tool Integration" : "Skill"}
          </span>
          <ArrowUp className="text-muted-foreground/30 group-hover:text-muted-foreground size-3.5 rotate-45 transition-colors" />
        </div>
      </AppLink>
    </motion.div>
  );
}

function CustomToolCard({
  skill,
  onDelete,
  onShare,
  onUnshare,
  onSaveShared,
}: {
  skill: {
    id: string;
    name: string;
    displayName: string;
    description: string;
    icon: string | null;
    enabled: boolean;
    visibility: "private" | "public";
    owner: {
      id: string;
      name: string | null;
      email: string | null;
    };
    isOwnedByCurrentUser: boolean;
    canEdit: boolean;
    toolIntegrations: string[];
  };
  onDelete: (id: string, displayName: string) => Promise<void>;
  onShare: (id: string, displayName: string) => Promise<void>;
  onUnshare: (id: string, displayName: string) => Promise<void>;
  onSaveShared: (id: string, displayName: string) => Promise<void>;
}) {
  const router = useRouter();

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void onDelete(skill.id, skill.displayName);
    },
    [onDelete, skill.id, skill.displayName],
  );

  const handleShare = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void onShare(skill.id, skill.displayName);
    },
    [onShare, skill.displayName, skill.id],
  );

  const handleUnshare = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void onUnshare(skill.id, skill.displayName);
    },
    [onUnshare, skill.displayName, skill.id],
  );

  const handleSaveShared = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void onSaveShared(skill.id, skill.displayName);
    },
    [onSaveShared, skill.displayName, skill.id],
  );

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void router.push(`/skills/${skill.id}`);
    },
    [router, skill.id],
  );

  const handleCardActionClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  return (
    <motion.div
      layout
      initial={CARD_MOTION.initial}
      animate={CARD_MOTION.animate}
      exit={CARD_MOTION.exit}
      transition={CARD_MOTION.transition}
    >
      <AppLink
        href={`/skills/${skill.id}`}
        className={cn(
          "border-border bg-card hover:border-foreground/30 hover:bg-muted/30 group relative flex h-full min-h-[180px] w-full flex-col rounded-xl border p-5 transition-all duration-150",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-muted/60 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
              <IconDisplay icon={skill.icon} />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] leading-tight font-medium">{skill.displayName}</p>
              <span className="text-muted-foreground font-mono text-[10px]">{skill.name}</span>
              <span className="text-muted-foreground mt-1 block text-[10px]">
                {skill.isOwnedByCurrentUser
                  ? skill.visibility === "public"
                    ? "Workspace public"
                    : "Private to you"
                  : `Shared by ${skill.owner.name ?? skill.owner.email ?? "workspace"}`}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "mt-0.5 size-2 rounded-full",
                skill.enabled ? "bg-green-500" : "bg-muted-foreground/30",
              )}
            />
            <span className="text-muted-foreground text-xs">{skill.enabled ? "On" : "Off"}</span>
          </div>
        </div>

        {/* Description */}
        <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-relaxed">
          {skill.description}
        </p>

        {skill.toolIntegrations.length > 0 ? (
          <IntegrationBadges
            integrations={skill.toolIntegrations as DisplayIntegrationType[]}
            className="mt-3"
          />
        ) : null}

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
            {skill.visibility === "public" ? <Share2 className="h-3 w-3" /> : null}
            {skill.isOwnedByCurrentUser ? "Custom" : "Shared"}
          </span>
          <div className="flex items-center gap-0.5" onClick={handleCardActionClick}>
            {skill.canEdit ? (
              <>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={skill.visibility === "public" ? handleUnshare : handleShare}
                  title={skill.visibility === "public" ? "Unshare" : "Share with workspace"}
                >
                  <Share2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-7 w-7"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSaveShared}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </AppLink>
    </motion.div>
  );
}

function WorkspaceMcpServerToolCard({
  source,
}: {
  source: {
    id: string;
    name: string;
    namespace: string;
    kind: "mcp";
    endpoint: string;
    enabled: boolean;
    connected: boolean;
    credentialEnabled: boolean;
  };
}) {
  const isActive = source.enabled && source.connected && source.credentialEnabled;
  const needsSetup = !source.connected;

  return (
    <motion.div
      layout
      initial={CARD_MOTION.initial}
      animate={CARD_MOTION.animate}
      exit={CARD_MOTION.exit}
      transition={CARD_MOTION.transition}
    >
      <AppLink
        href={`/toolbox/sources/${source.id}`}
        className={cn(
          "border-border bg-card hover:border-foreground/30 hover:bg-muted/30 group relative flex h-full min-h-[180px] w-full flex-col rounded-xl border p-5 transition-all duration-150",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <WorkspaceMcpServerLogo
              kind={source.kind}
              endpoint={source.endpoint}
              className="h-10 w-10 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-[13px] leading-tight font-medium">{source.name}</p>
              <div className="mt-1 flex items-center gap-1.5">
                {isActive ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      Connected
                    </span>
                  </>
                ) : source.connected && !source.credentialEnabled ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      Paused
                    </span>
                  </>
                ) : needsSetup ? (
                  <span className="text-muted-foreground text-[10px] font-medium">
                    Not connected
                  </span>
                ) : (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      Disabled
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "mt-0.5 size-2 rounded-full",
                isActive ? "bg-green-500" : "bg-muted-foreground/30",
              )}
            />
            <span className="text-muted-foreground text-xs">{isActive ? "On" : "Off"}</span>
          </div>
        </div>

        {/* Description */}
        <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-relaxed">
          {source.namespace} · {source.endpoint}
        </p>

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
            <Plug className="h-3 w-3" />
            MCP
          </span>
          <ArrowUp className="text-muted-foreground/30 group-hover:text-muted-foreground size-3.5 rotate-45 transition-colors" />
        </div>
      </AppLink>
    </motion.div>
  );
}

// ─── Page content ───────────────────────────────────────────────────────────────

export function ToolboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const { isAdmin } = useIsAdmin();

  // Integration hooks
  const {
    data: integrations,
    isLoading: integrationsLoading,
    refetch: refetchIntegrations,
  } = useIntegrationList();
  const { data: googleAccessStatus } = useGoogleAccessStatus();
  const getAuthUrl = useGetAuthUrl();
  const requestGoogleAccess = useRequestGoogleAccess();
  const toggleIntegration = useToggleIntegration();
  const disconnectIntegration = useDisconnectIntegration();
  const renameAccountLabel = useRenameAccountLabel();
  const linkLinkedIn = useLinkLinkedIn();

  // Executor source hooks
  const { data: executorData, isLoading: executorLoading } = useWorkspaceMcpServerList();

  // Skill hooks
  const { data: skills, isLoading: skillsLoading, refetch: refetchSkills } = useSkillList();
  const createSkill = useCreateSkill();
  const importSkill = useImportSkill();
  const deleteSkill = useDeleteSkill();
  const shareSkill = useShareSkill();
  const unshareSkill = useUnshareSkill();
  const saveSharedSkill = useSaveSharedSkill();

  // Local state
  const [connectingType, setConnectingType] = useState<string | null>(null);
  const [integrationConnectErrors, setIntegrationConnectErrors] = useState<
    Partial<Record<OAuthIntegrationType, string>>
  >({});
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [communitySkillToggles, setCommunitySkillToggles] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(COMMUNITY_SKILLS.map((s) => [s.id, s.enabled])),
  );
  const linkedInLinkingRef = useRef(false);
  const zipImportInputRef = useRef<HTMLInputElement>(null);
  const folderImportInputRef = useRef<HTMLInputElement>(null);
  const [supportsFolderImport, setSupportsFolderImport] = useState(false);

  const isLoading = integrationsLoading || skillsLoading || executorLoading;
  const isWorkspaceAdmin =
    executorData?.membershipRole === "admin" || executorData?.membershipRole === "owner";
  const executorSources = useMemo(() => executorData?.sources ?? [], [executorData?.sources]);
  const lacksGoogleAccess = googleAccessStatus?.allowed === false;

  // Integration data
  const integrationsList = useMemo(
    () => (Array.isArray(integrations) ? integrations : []),
    [integrations],
  );
  const connectedIntegrations = useMemo(
    () =>
      new Map<string, (typeof integrationsList)[number]>(integrationsList.map((i) => [i.type, i])),
    [integrationsList],
  );

  const visibleIntegrations = useMemo(
    () =>
      (
        Object.entries(integrationConfig) as [
          IntegrationType,
          (typeof integrationConfig)[IntegrationType],
        ][]
      ).filter(([type]) => isAdmin || !adminPreviewOnlyIntegrations.has(type)),
    [isAdmin],
  );

  // Skill data
  const skillsList = useMemo(() => (Array.isArray(skills) ? skills : []), [skills]);
  const ownedSkillsList = useMemo(
    () => skillsList.filter((skill) => skill.isOwnedByCurrentUser),
    [skillsList],
  );
  const sharedSkillsList = useMemo(
    () =>
      skillsList.filter((skill) => !skill.isOwnedByCurrentUser && skill.visibility === "public"),
    [skillsList],
  );

  // ─── LinkedIn redirect handling ─────────────────────────────────────────────
  useEffect(() => {
    const accountId = searchParams.get("account_id");
    if (accountId && !linkedInLinkingRef.current) {
      linkedInLinkingRef.current = true;
      linkLinkedIn
        .mutateAsync(accountId)
        .then(() => {
          toast.success("LinkedIn connected successfully!");
          refetchIntegrations();
        })
        .catch(() => {
          toast.error("Failed to connect LinkedIn. Please try again.");
        })
        .finally(() => {
          window.history.replaceState({}, "", "/toolbox");
        });
    }
  }, [searchParams, linkLinkedIn, refetchIntegrations]);

  // ─── URL params handling (OAuth callback) ───────────────────────────────────
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    if (success) {
      queueMicrotask(() => {
        toast.success("Integration connected successfully!");
      });
      window.history.replaceState({}, "", "/toolbox");
      refetchIntegrations();
    } else if (error) {
      queueMicrotask(() => {
        toast.error(formatOAuthConnectionError(error));
      });
      window.history.replaceState({}, "", "/toolbox");
    }
  }, [searchParams, refetchIntegrations]);

  useEffect(() => {
    const input = folderImportInputRef.current;
    if (!input) {
      return;
    }

    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");

    const supportsDirectorySelection =
      "webkitdirectory" in (input as HTMLInputElement & { webkitdirectory?: boolean });
    setSupportsFolderImport(supportsDirectorySelection);
  }, []);

  // ─── Integration handlers ───────────────────────────────────────────────────
  const handleIntegrationConnect = useCallback(
    async (
      type: OAuthIntegrationType,
      options?: { mode?: "connect" | "connect_to_label" | "reauth" },
    ) => {
      setConnectingType(type);
      setIntegrationConnectErrors((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
      try {
        const result = await getAuthUrl.mutateAsync({
          type,
          redirectUrl: window.location.href,
          mode: options?.mode,
        });
        window.location.assign(result.authUrl);
      } catch (error) {
        const message = toErrorMessage(error, "");
        setConnectingType(null);
        setIntegrationConnectErrors((prev) => ({
          ...prev,
          [type]: isUnipileMissingCredentialsError(error)
            ? UNIPILE_MISSING_CREDENTIALS_MESSAGE
            : message.includes("admin approval")
              ? "Google access is restricted. Use Request access first."
              : "Failed to start connection. Please try again.",
        }));
      }
    },
    [getAuthUrl],
  );

  const handleIntegrationToggle = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await toggleIntegration.mutateAsync({ id, enabled });
        refetchIntegrations();
      } catch (error) {
        console.error("Failed to toggle integration:", error);
      }
    },
    [refetchIntegrations, toggleIntegration],
  );

  const handleIntegrationDisconnect = useCallback(
    async (id: string) => {
      try {
        await disconnectIntegration.mutateAsync(id);
        refetchIntegrations();
      } catch (error) {
        console.error("Failed to disconnect integration:", error);
      }
    },
    [disconnectIntegration, refetchIntegrations],
  );

  const handleRequestGoogleAccess = useCallback(
    async (type: GoogleIntegrationType) => {
      try {
        await requestGoogleAccess.mutateAsync({ integration: type, source: "integrations" });
        toast.success(
          "Access request sent. We notified the team and will approve your Google access.",
        );
      } catch {
        toast.error("Failed to send access request.");
      }
    },
    [requestGoogleAccess],
  );

  // ─── Skill handlers ────────────────────────────────────────────────────────
  const handleCreateSkill = useCallback(async () => {
    setIsCreating(true);
    try {
      const result = await createSkill.mutateAsync({
        displayName: "New Skill",
        description: "Add a description for this skill",
      });
      router.push(`/skills/${result.id}`);
    } catch {
      toast.error("Failed to create skill.");
      setIsCreating(false);
    }
  }, [createSkill, router]);

  const handleImportZipClick = useCallback(() => {
    if (importSkill.isPending) {
      return;
    }
    zipImportInputRef.current?.click();
  }, [importSkill.isPending]);

  const handleImportFolderClick = useCallback(() => {
    if (importSkill.isPending || !supportsFolderImport) {
      return;
    }
    folderImportInputRef.current?.click();
  }, [importSkill.isPending, supportsFolderImport]);

  const handleNewMcpSource = useCallback(() => {
    router.push("/toolbox/sources/new?kind=mcp");
  }, [router]);

  const handleImportZipChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }
      if (!file.name.toLowerCase().endsWith(".zip")) {
        toast.error("Select a .zip skill archive.");
        return;
      }

      try {
        const created = await importSkill.mutateAsync({
          mode: "zip",
          filename: file.name,
          contentBase64: await blobToBase64(file),
        });
        toast.success(`Imported ${created.displayName}. Review it before enabling.`);
        router.push(`/skills/${created.id}`);
      } catch (error) {
        console.error("Failed to import skill zip:", error);
        toast.error(toErrorMessage(error, "Failed to import skill."));
      }
    },
    [importSkill, router],
  );

  const handleImportFolderChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0) {
        return;
      }

      try {
        const importedFiles = await Promise.all(
          files.map(async (file) => {
            const relativePath =
              (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
            return {
              path: relativePath,
              mimeType: file.type || undefined,
              contentBase64: await blobToBase64(file),
            };
          }),
        );

        const created = await importSkill.mutateAsync({
          mode: "folder",
          files: importedFiles,
        });
        toast.success(`Imported ${created.displayName}. Review it before enabling.`);
        router.push(`/skills/${created.id}`);
      } catch (error) {
        console.error("Failed to import skill folder:", error);
        toast.error(toErrorMessage(error, "Failed to import skill."));
      }
    },
    [importSkill, router],
  );

  const handleSkillDelete = useCallback(
    async (id: string, displayName: string) => {
      if (!confirm(`Are you sure you want to delete "${displayName}"?`)) {
        return;
      }
      try {
        await deleteSkill.mutateAsync(id);
        toast.success(`Skill "${displayName}" deleted.`);
        refetchSkills();
      } catch {
        toast.error("Failed to delete skill.");
      }
    },
    [deleteSkill, refetchSkills],
  );

  const handleShareSkill = useCallback(
    async (id: string, displayName: string) => {
      try {
        await shareSkill.mutateAsync(id);
        toast.success(`Shared "${displayName}" with the workspace.`);
        refetchSkills();
      } catch (error) {
        toast.error(toErrorMessage(error, "Failed to share skill."));
      }
    },
    [refetchSkills, shareSkill],
  );

  const handleUnshareSkill = useCallback(
    async (id: string, displayName: string) => {
      try {
        await unshareSkill.mutateAsync(id);
        toast.success(`Unshared "${displayName}".`);
        refetchSkills();
      } catch (error) {
        toast.error(toErrorMessage(error, "Failed to unshare skill."));
      }
    },
    [refetchSkills, unshareSkill],
  );

  const handleSaveSharedSkill = useCallback(
    async (id: string, displayName: string) => {
      try {
        const saved = await saveSharedSkill.mutateAsync(id);
        toast.success(`Saved "${displayName}" to your skills.`);
        router.push(`/skills/${saved.id}`);
      } catch (error) {
        toast.error(toErrorMessage(error, "Failed to save shared skill."));
      }
    },
    [router, saveSharedSkill],
  );

  // ─── Community skill handlers ─────────────────────────────────────────────
  const handleCommunitySkillToggle = useCallback((id: string, value: boolean) => {
    setCommunitySkillToggles((prev) => ({ ...prev, [id]: value }));
  }, []);

  // ─── Search & filter ───────────────────────────────────────────────────────
  const q = search.toLowerCase().trim();

  const filteredIntegrations = useMemo(() => {
    return visibleIntegrations.filter(([type, config]) => {
      const integration = connectedIntegrations.get(type);
      const isConnected = !!integration;
      const isEnabled = integration?.enabled ?? false;

      // Search filter
      if (
        q &&
        !config.name.toLowerCase().includes(q) &&
        !config.description.toLowerCase().includes(q)
      ) {
        return false;
      }

      // Tab filter
      if (activeTab === "active") {
        return isConnected && isEnabled;
      }
      if (activeTab === "needs_setup") {
        return !isConnected && !adminPreviewOnlyIntegrations.has(type);
      }
      return true;
    });
  }, [visibleIntegrations, q, activeTab, connectedIntegrations]);

  const filteredOwnedSkills = useMemo(() => {
    let filtered = ownedSkillsList;
    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q),
      );
    }
    if (activeTab === "active") {
      filtered = filtered.filter((s) => s.enabled);
    }
    if (activeTab === "needs_setup") {
      return []; // skills never need setup
    }
    return filtered;
  }, [ownedSkillsList, q, activeTab]);

  const filteredSharedSkills = useMemo(() => {
    let filtered = sharedSkillsList;
    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.owner.name ?? s.owner.email ?? "").toLowerCase().includes(q),
      );
    }
    if (activeTab === "active") {
      filtered = filtered.filter((s) => s.enabled);
    }
    if (activeTab === "needs_setup") {
      return [];
    }
    return filtered;
  }, [activeTab, q, sharedSkillsList]);

  const filteredCommunitySkills = useMemo(() => {
    let filtered = COMMUNITY_SKILLS;
    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q),
      );
    }
    if (activeTab === "active") {
      filtered = filtered.filter((s) => communitySkillToggles[s.id] ?? s.enabled);
    }
    if (activeTab === "needs_setup") {
      return []; // skills never need setup
    }
    return filtered;
  }, [q, activeTab, communitySkillToggles]);

  const filteredWorkspaceMcpServers = useMemo(() => {
    let filtered = executorSources;
    if (q) {
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.namespace.toLowerCase().includes(q) ||
          s.endpoint.toLowerCase().includes(q),
      );
    }
    if (activeTab === "active") {
      filtered = filtered.filter((s) => s.enabled && s.connected && s.credentialEnabled);
    }
    if (activeTab === "needs_setup") {
      filtered = filtered.filter((s) => !s.connected);
    }
    return filtered;
  }, [executorSources, q, activeTab]);

  // ─── Counts ─────────────────────────────────────────────────────────────────
  const totalActive = useMemo(() => {
    const activeIntegrations = visibleIntegrations.filter(([type]) => {
      const integration = connectedIntegrations.get(type);
      return integration?.enabled;
    }).length;
    const activeCustom = skillsList.filter((s) => s.enabled).length;
    const activeCommunity = COMMUNITY_SKILLS.filter(
      (s) => communitySkillToggles[s.id] ?? s.enabled,
    ).length;
    const activeWorkspaceMcpServers = executorSources.filter(
      (s) => s.enabled && s.connected && s.credentialEnabled,
    ).length;
    return activeIntegrations + activeCustom + activeCommunity + activeWorkspaceMcpServers;
  }, [
    visibleIntegrations,
    connectedIntegrations,
    skillsList,
    communitySkillToggles,
    executorSources,
  ]);

  const totalNeedsSetup = useMemo(() => {
    const integrationNeedsSetup = visibleIntegrations.filter(([type]) => {
      return !connectedIntegrations.get(type) && !adminPreviewOnlyIntegrations.has(type);
    }).length;
    const executorNeedsSetup = executorSources.filter((s) => !s.connected).length;
    return integrationNeedsSetup + executorNeedsSetup;
  }, [visibleIntegrations, connectedIntegrations, executorSources]);

  const totalAll =
    visibleIntegrations.length +
    skillsList.length +
    COMMUNITY_SKILLS.length +
    executorSources.length;

  const hasResults =
    filteredIntegrations.length > 0 ||
    filteredOwnedSkills.length > 0 ||
    filteredSharedSkills.length > 0 ||
    filteredCommunitySkills.length > 0 ||
    filteredWorkspaceMcpServers.length > 0;

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: "all", label: "All", count: totalAll },
    { id: "active", label: "Active", count: totalActive },
    { id: "needs_setup", label: "Needs Setup", count: totalNeedsSetup },
  ];

  const handleTabChange = useCallback((key: string) => {
    setActiveTab(key as FilterTab);
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  // ─── Preview modal helpers ───────────────────────────────────────────────────
  const previewId = searchParams.get("preview");

  useEffect(() => {
    if (!isMobile || !previewId?.startsWith("integration:")) {
      return;
    }

    router.replace(`/integrations/${previewId.slice("integration:".length)}`, { scroll: false });
  }, [isMobile, previewId, router]);

  const getIntegrationConfig = useCallback((type: string) => integrationConfig[type], []);

  const getIntegration = useCallback(
    (type: string) => connectedIntegrations.get(type) ?? null,
    [connectedIntegrations],
  );

  const getIntegrationsForType = useCallback(
    (type: string) => integrationsList.filter((integration) => integration.type === type),
    [integrationsList],
  );

  const getConnectError = useCallback(
    (type: string) => integrationConnectErrors[type as OAuthIntegrationType],
    [integrationConnectErrors],
  );

  const isWhatsAppType = useCallback((type: string) => type === "whatsapp", []);

  const showGoogleRequestForType = useCallback(
    (type: string) => {
      const integration = connectedIntegrations.get(type);
      const isGoogleType =
        type !== "whatsapp" && isGoogleIntegrationType(type as OAuthIntegrationType);
      return !integration && isGoogleType && lacksGoogleAccess;
    },
    [connectedIntegrations, lacksGoogleAccess],
  );

  const handlePreviewConnect = useCallback(() => {
    if (!previewId) {
      return;
    }
    const parsed = previewId.startsWith("integration:")
      ? previewId.slice("integration:".length)
      : null;
    if (parsed && parsed !== "whatsapp") {
      void handleIntegrationConnect(parsed as OAuthIntegrationType);
    }
  }, [handleIntegrationConnect, previewId]);

  const handlePreviewConnectAnother = useCallback(() => {
    if (!previewId) {
      return;
    }
    const parsed = previewId.startsWith("integration:")
      ? previewId.slice("integration:".length)
      : null;
    if (parsed && parsed !== "whatsapp") {
      void handleIntegrationConnect(parsed as OAuthIntegrationType, { mode: "connect" });
    }
  }, [handleIntegrationConnect, previewId]);

  const handlePreviewToggle = useCallback(
    (enabled: boolean) => {
      if (!previewId) {
        return;
      }
      const parsed = previewId.startsWith("integration:")
        ? previewId.slice("integration:".length)
        : null;
      if (!parsed) {
        return;
      }
      const integration = connectedIntegrations.get(parsed);
      if (integration) {
        void handleIntegrationToggle(integration.id, enabled);
      }
    },
    [connectedIntegrations, handleIntegrationToggle, previewId],
  );

  const handlePreviewDisconnect = useCallback(() => {
    if (!previewId) {
      return;
    }
    const parsed = previewId.startsWith("integration:")
      ? previewId.slice("integration:".length)
      : null;
    if (!parsed) {
      return;
    }
    const integration = connectedIntegrations.get(parsed);
    if (integration) {
      void handleIntegrationDisconnect(integration.id);
    }
  }, [connectedIntegrations, handleIntegrationDisconnect, previewId]);

  const handlePreviewRequestGoogleAccess = useCallback(() => {
    if (!previewId) {
      return;
    }
    const parsed = previewId.startsWith("integration:")
      ? previewId.slice("integration:".length)
      : null;
    if (parsed && isGoogleIntegrationType(parsed as OAuthIntegrationType)) {
      void handleRequestGoogleAccess(parsed as GoogleIntegrationType);
    }
  }, [handleRequestGoogleAccess, previewId]);

  const previewIntegrationProps = useMemo(
    () => ({
      getIntegrationConfig,
      getIntegration,
      getIntegrations: getIntegrationsForType,
      getConnectError,
      isWhatsApp: isWhatsAppType,
      showGoogleRequest: showGoogleRequestForType,
      isConnecting: !!connectingType,
      onConnect: handlePreviewConnect,
      onConnectAnother: handlePreviewConnectAnother,
      onToggle: handlePreviewToggle,
      onToggleAccount: handleIntegrationToggle,
      onDisconnect: handlePreviewDisconnect,
      onDisconnectAccount: handleIntegrationDisconnect,
      onRequestGoogleAccess: handlePreviewRequestGoogleAccess,
      onRenameAccountLabel: renameAccountLabel.mutate,
    }),
    [
      connectingType,
      getConnectError,
      getIntegration,
      getIntegrationsForType,
      getIntegrationConfig,
      handlePreviewConnect,
      handlePreviewConnectAnother,
      handlePreviewDisconnect,
      handlePreviewRequestGoogleAccess,
      handlePreviewToggle,
      handleIntegrationToggle,
      handleIntegrationDisconnect,
      isWhatsAppType,
      renameAccountLabel.mutate,
      showGoogleRequestForType,
    ],
  );

  const previewCommunitySkillProps = useMemo(
    () => ({
      getEnabled: (slug: string) => communitySkillToggles[slug] ?? false,
      onToggle: handleCommunitySkillToggle,
    }),
    [communitySkillToggles, handleCommunitySkillToggle],
  );

  return (
    <>
      {/* Filters row */}
      <div className="mb-8 space-y-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <AnimatedTabs
              activeKey={activeTab}
              onTabChange={handleTabChange}
              className="w-full min-w-max grid-cols-3 sm:flex sm:w-fit sm:min-w-0"
            >
              {tabs.map((tab) => (
                <AnimatedTab key={tab.id} value={tab.id} className="text-[11px] sm:text-sm">
                  {tab.label}
                  <span
                    className={cn(
                      "ml-1 rounded-full px-1.5 py-0.5 text-[10px] sm:ml-1.5 sm:text-xs",
                      activeTab === tab.id
                        ? "bg-foreground/10 text-foreground/70"
                        : "bg-muted-foreground/15 text-muted-foreground",
                    )}
                  >
                    {tab.count}
                  </span>
                </AnimatedTab>
              ))}
            </AnimatedTabs>
          </div>
          <div className="shrink-0 xl:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={importSkill.isPending || isCreating}>
                  {importSkill.isPending || isCreating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-2 h-4 w-4" />
                  )}
                  Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isWorkspaceAdmin ? (
                  <>
                    <DropdownMenuItem onClick={handleNewMcpSource}>
                      <Puzzle className="h-4 w-4" />
                      Add MCP
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuItem onClick={handleImportZipClick} disabled={importSkill.isPending}>
                  <FileInput className="h-4 w-4" />
                  Import .zip
                </DropdownMenuItem>
                {supportsFolderImport ? (
                  <DropdownMenuItem
                    onClick={handleImportFolderClick}
                    disabled={importSkill.isPending}
                  >
                    <FileOutput className="h-4 w-4" />
                    Import folder
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={handleCreateSkill} disabled={isCreating}>
                  <Plus className="h-4 w-4" />
                  Create Skill
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="border-border flex w-full min-w-0 items-center gap-3 rounded-xl border px-4 py-2.5 xl:w-80 xl:flex-initial">
            <Search className="text-muted-foreground/60 size-4 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={handleSearchChange}
              placeholder="Search tools…"
              className="placeholder:text-muted-foreground/40 w-full bg-transparent text-sm outline-none"
            />
          </div>
          <div className="hidden items-center gap-2 xl:flex">
            {isWorkspaceAdmin && (
              <>
                <Button variant="outline" asChild>
                  <AppLink href="/toolbox/sources/new?kind=mcp">
                    <Puzzle className="mr-2 h-4 w-4" />
                    Add MCP
                  </AppLink>
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={importSkill.isPending}>
                  {importSkill.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileInput className="mr-2 h-4 w-4" />
                  )}
                  Import Skill
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleImportZipClick} disabled={importSkill.isPending}>
                  <FileInput className="h-4 w-4" />
                  Import .zip
                </DropdownMenuItem>
                {supportsFolderImport ? (
                  <DropdownMenuItem
                    onClick={handleImportFolderClick}
                    disabled={importSkill.isPending}
                  >
                    <FileOutput className="h-4 w-4" />
                    Import folder
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={handleCreateSkill} disabled={isCreating}>
              {isCreating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create Skill
            </Button>
          </div>
          <input
            ref={zipImportInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            aria-label="Import skill zip"
            onChange={handleImportZipChange}
          />
          <input
            ref={folderImportInputRef}
            type="file"
            multiple
            className="hidden"
            aria-label="Import skill folder"
            onChange={handleImportFolderChange}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : !hasResults ? (
        <motion.div
          initial={FADE_IN_MOTION.initial}
          animate={FADE_IN_MOTION.animate}
          className="py-16 text-center"
        >
          <p className="text-muted-foreground text-sm">
            {q
              ? "No tools match your search."
              : activeTab === "active"
                ? "No active tools yet."
                : activeTab === "needs_setup"
                  ? "All integrations are connected."
                  : "No tools available."}
          </p>
        </motion.div>
      ) : (
        <div className="space-y-10">
          {/* Personal skills section */}
          {filteredOwnedSkills.length > 0 && (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">My Skills</h2>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Private skills you own in this workspace
                  </p>
                </div>
                <p className="text-muted-foreground text-xs">
                  {filteredOwnedSkills.length} tool
                  {filteredOwnedSkills.length !== 1 ? "s" : ""}
                </p>
              </div>
              <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {filteredOwnedSkills.map((skill) => (
                    <CustomToolCard
                      key={skill.id}
                      skill={skill}
                      onDelete={handleSkillDelete}
                      onShare={handleShareSkill}
                      onUnshare={handleUnshareSkill}
                      onSaveShared={handleSaveSharedSkill}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            </section>
          )}

          {/* Shared skills section */}
          {filteredSharedSkills.length > 0 && (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Workspace Skills</h2>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Public skills shared by other people in your workspace
                  </p>
                </div>
                <p className="text-muted-foreground text-xs">
                  {filteredSharedSkills.length} tool
                  {filteredSharedSkills.length !== 1 ? "s" : ""}
                </p>
              </div>
              <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {filteredSharedSkills.map((skill) => (
                    <CustomToolCard
                      key={skill.id}
                      skill={skill}
                      onDelete={handleSkillDelete}
                      onShare={handleShareSkill}
                      onUnshare={handleUnshareSkill}
                      onSaveShared={handleSaveSharedSkill}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            </section>
          )}

          {/* Integrations section */}
          {filteredIntegrations.length > 0 && (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Integrations</h2>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Connect external services to your coworker
                  </p>
                </div>
                <p className="text-muted-foreground text-xs">
                  {filteredIntegrations.length} tool
                  {filteredIntegrations.length !== 1 ? "s" : ""}
                </p>
              </div>
              <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {filteredIntegrations.map(([type, config]) => {
                    const integration = connectedIntegrations.get(type) ?? null;
                    return (
                      <IntegrationToolCard
                        key={type}
                        config={config}
                        href={
                          isMobile
                            ? `/integrations/${type}`
                            : `/toolbox?preview=integration:${type}`
                        }
                        integration={integration}
                        connectError={
                          !integration
                            ? integrationConnectErrors[type as OAuthIntegrationType]
                            : undefined
                        }
                        isPreviewOnly={adminPreviewOnlyIntegrations.has(type)}
                      />
                    );
                  })}
                </AnimatePresence>
              </motion.div>
            </section>
          )}

          {/* Workspace MCP Servers section */}
          {filteredWorkspaceMcpServers.length > 0 && (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">MCP Servers</h2>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    MCP servers configured for your workspace
                  </p>
                </div>
                <p className="text-muted-foreground text-xs">
                  {filteredWorkspaceMcpServers.length} source
                  {filteredWorkspaceMcpServers.length !== 1 ? "s" : ""}
                </p>
              </div>
              <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {filteredWorkspaceMcpServers.map((source) => (
                    <WorkspaceMcpServerToolCard key={source.id} source={source} />
                  ))}
                </AnimatePresence>
              </motion.div>
            </section>
          )}

          {/* Community Skills section */}
          {filteredCommunitySkills.length > 0 && (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Community Skills</h2>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Pre-built skills ready to activate
                  </p>
                </div>
                <p className="text-muted-foreground text-xs">
                  {filteredCommunitySkills.length} tool
                  {filteredCommunitySkills.length !== 1 ? "s" : ""}
                </p>
              </div>
              <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {filteredCommunitySkills.map((skill) => (
                    <CommunityToolCard
                      key={skill.id}
                      skill={skill}
                      enabled={communitySkillToggles[skill.id] ?? skill.enabled}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            </section>
          )}
        </div>
      )}

      <ToolboxPreviewModal
        previewId={isMobile && previewId?.startsWith("integration:") ? null : previewId}
        integrationProps={previewIntegrationProps}
        communitySkillProps={previewCommunitySkillProps}
      />
    </>
  );
}
