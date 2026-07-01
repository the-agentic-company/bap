// oxlint-disable jsx-a11y/control-has-associated-label

import { useNavigate } from "@tanstack/react-router";
import { T, useMessages } from "gt-react";
import { ArrowUp, Copy, Pencil, Plug, Share2, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useCallback } from "react";
import { IntegrationBadges } from "@/components/chat/integration-badges";
import { WorkspaceMcpServerLogo } from "@/components/executor-source-logo";
import { Button } from "@/components/ui/button";
import { IconDisplay } from "@/components/ui/icon-picker";
import { type DisplayIntegrationType } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import { formatCredentialExpiryShort } from "../credential-expiry";
import { AppImage } from "../../-lib/app-image";
import { AppLink } from "../../-lib/app-link";
import { CARD_MOTION, type CommunitySkill } from "./data";

export function IntegrationToolCard({
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
  const m = useMessages();
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
                      {isEnabled ? <T>Connected</T> : <T>Disabled</T>}
                    </span>
                  </>
                ) : isPreviewOnly ? (
                  <span className="text-muted-foreground/60 text-[10px] font-medium">
                    <T>Coming soon</T>
                  </span>
                ) : connectError ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span className="text-[10px] font-medium text-red-500">
                      <T>Error</T>
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground text-[10px] font-medium">
                    <T>Not connected</T>
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
              {isConnected && isEnabled ? <T>On</T> : <T>Off</T>}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-relaxed">
          {m(config.description)}
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
            <T>Integration</T>
          </span>
          <ArrowUp className="text-muted-foreground/30 group-hover:text-muted-foreground size-3.5 rotate-45 transition-colors" />
        </div>
      </AppLink>
    </motion.div>
  );
}

export function CommunityToolCard({ skill, enabled }: { skill: CommunitySkill; enabled: boolean }) {
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

export function CustomToolCard({
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
  const navigate = useNavigate();

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
      void navigate({ to: "/skills/$id", params: { id: skill.id } });
    },
    [navigate, skill.id],
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

type WorkspaceMcpServerCardSource = {
  id: string;
  name: string;
  namespace: string;
  kind: "mcp";
  endpoint: string;
  enabled: boolean;
  connected: boolean;
  credentialEnabled: boolean;
  credentialExpiresAt?: Date | string | null;
};

function WorkspaceMcpServerStatus({ source }: { source: WorkspaceMcpServerCardSource }) {
  const isActive = source.enabled && source.connected && source.credentialEnabled;
  if (isActive) {
    return (
      <>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
          <T>Connected</T>
        </span>
      </>
    );
  }

  if (source.connected && !source.credentialEnabled) {
    return (
      <>
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
        <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
          <T>Paused</T>
        </span>
      </>
    );
  }

  if (!source.connected) {
    return (
      <span className="text-muted-foreground text-[10px] font-medium">
        <T>Not connected</T>
      </span>
    );
  }

  return (
    <>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
        <T>Disabled</T>
      </span>
    </>
  );
}

function WorkspaceMcpServerPowerState({ isActive }: { isActive: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span
        className={cn("mt-0.5 size-2 rounded-full", isActive ? "bg-green-500" : "bg-muted-foreground/30")}
      />
      <span className="text-muted-foreground text-xs">{isActive ? "On" : "Off"}</span>
    </div>
  );
}

export function WorkspaceMcpServerToolCard({ source }: { source: WorkspaceMcpServerCardSource }) {
  const isActive = source.enabled && source.connected && source.credentialEnabled;
  const credentialExpiryLabel = formatCredentialExpiryShort(source.credentialExpiresAt);

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
                <WorkspaceMcpServerStatus source={source} />
              </div>
            </div>
          </div>

          <WorkspaceMcpServerPowerState isActive={isActive} />
        </div>

        {/* Description */}
        <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-relaxed">
          {source.namespace} · {source.endpoint}
        </p>
        {source.connected && credentialExpiryLabel ? (
          <p className="text-muted-foreground mt-2 text-[11px]">{credentialExpiryLabel}</p>
        ) : null}

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
