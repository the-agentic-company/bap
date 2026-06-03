"use client";

import type React from "react";
import { Check, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppImage } from "@/components/app-image";
import { AppLink } from "@/components/app-link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getIntegrationActions } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type IntegrationInfo = {
  id: string;
  type: string;
  enabled: boolean;
  displayName: string | null;
  accountLabelId?: string | null;
  accountLabel?: string | null;
  setupRequired?: boolean;
};

export type IntegrationDetailProps = {
  type: string;
  config: { name: string; description: string; icon: string };
  integration: IntegrationInfo | null;
  integrations?: IntegrationInfo[];
  isWhatsApp: boolean;
  connectError?: string;
  showGoogleRequest: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onConnectAnother?: () => void;
  onToggle: (enabled: boolean) => void;
  onToggleAccount?: (id: string, enabled: boolean) => void;
  onDisconnect: () => void;
  onDisconnectAccount?: (id: string) => void;
  onRequestGoogleAccess: () => void;
  onRenameAccountLabel?: (input: { id: string; accountLabel: string }) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function IntegrationDetailContent({
  type,
  config,
  integration,
  integrations = integration ? [integration] : [],
  isWhatsApp,
  connectError,
  showGoogleRequest,
  isConnecting,
  onConnect,
  onConnectAnother,
  onToggle,
  onToggleAccount,
  onDisconnect,
  onDisconnectAccount,
  onRequestGoogleAccess,
  onRenameAccountLabel,
}: IntegrationDetailProps) {
  const actions = isWhatsApp ? [] : getIntegrationActions(type);
  const isConnected = !!integration;
  const isEnabled = integration?.enabled ?? false;
  const connectedAccounts =
    integrations.length > 0 ? integrations : integration ? [integration] : [];
  const connectedAccountCount = connectedAccounts.length;

  const handleToggle = useCallback(
    (value: boolean) => {
      onToggle(value);
    },
    [onToggle],
  );

  return (
    <div className="mx-auto max-w-3xl pb-8">
      {/* ── Hero section ── */}
      <div className="grid grid-cols-1 gap-12 pb-16 md:grid-cols-[1fr_1.3fr] md:gap-16">
        {/* Intro */}
        <div className="flex flex-col">
          {/* Integration icon */}
          <div className="mb-5 inline-flex size-14 items-center justify-center rounded-xl border bg-white p-2.5 shadow-sm dark:bg-gray-800">
            <AppImage
              src={config.icon}
              alt={config.name}
              width={28}
              height={28}
              className="h-auto max-h-7 w-auto max-w-7 object-contain"
            />
          </div>

          <h1 className="text-foreground text-xl font-semibold tracking-tight md:text-2xl md:leading-snug">
            {config.name}
          </h1>
          <p className="text-muted-foreground mt-4 max-w-[38ch] text-sm leading-relaxed">
            {config.description}
          </p>

          {/* Status */}
          <div className="mt-5 flex items-center gap-2">
            {isConnected ? (
              <>
                <span
                  className={cn(
                    "inline-block size-2 rounded-full",
                    isEnabled ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-medium",
                    isEnabled
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {connectedAccountCount > 1
                    ? `${connectedAccountCount} connected accounts`
                    : isEnabled
                      ? "Connected"
                      : "Disabled"}
                </span>
                {connectedAccountCount <= 1 && integration.displayName && (
                  <span className="text-muted-foreground text-xs">· {integration.displayName}</span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground text-xs font-medium">Not connected</span>
            )}
          </div>

          {/* Actions */}
          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
            {isConnected && !integration.setupRequired ? (
              <>
                {connectedAccounts.length === 0 ? (
                  <label className="flex cursor-pointer items-center gap-2">
                    <Switch checked={isEnabled} onCheckedChange={handleToggle} />
                    <span className="text-muted-foreground text-sm">
                      {isEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </label>
                ) : null}
                {onConnectAnother ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 rounded-md"
                    onClick={onConnectAnother}
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    Add account
                  </Button>
                ) : null}
                {connectedAccounts.length === 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={onDisconnect}
                  >
                    Disconnect
                  </Button>
                ) : null}
              </>
            ) : isWhatsApp ? (
              <Button className="gap-1.5 rounded-lg px-5" asChild>
                <AppLink href="/integrations/whatsapp">
                  Setup
                  <ExternalLink className="size-3.5" />
                </AppLink>
              </Button>
            ) : showGoogleRequest ? (
              <Button
                variant="outline"
                className="gap-1.5 rounded-lg px-5"
                onClick={onRequestGoogleAccess}
              >
                Request access
              </Button>
            ) : (
              <Button
                className="gap-1.5 rounded-lg px-5"
                onClick={onConnect}
                disabled={isConnecting}
                variant={connectError ? "destructive" : "default"}
              >
                {isConnecting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="size-3.5" />
                )}
                {isConnecting ? "Connecting" : connectError ? "Retry" : "Connect"}
              </Button>
            )}
          </div>

          {connectError && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
              {connectError}
            </div>
          )}

          {connectedAccounts.length > 0 ? (
            <div className="mt-8">
              <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-widest uppercase">
                Connected Accounts
              </p>
              <div className="divide-border bg-background overflow-hidden rounded-lg border">
                {connectedAccounts.map((account) => (
                  <ConnectedAccountRow
                    key={account.id}
                    account={account}
                    onToggleAccount={onToggleAccount}
                    onDisconnectAccount={onDisconnectAccount ?? onDisconnect}
                    onRenameAccountLabel={onRenameAccountLabel}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* Metadata */}
          <div className="mt-12 space-y-6">
            <div>
              <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-widest uppercase">
                Type
              </p>
              <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                Integration
              </span>
            </div>

            <div>
              <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-widest uppercase">
                Capabilities
              </p>
              <p className="text-sm">
                {actions.length} action{actions.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>

        {/* Capabilities */}
        <div>
          <section>
            <div className="mb-5">
              <h2 className="text-sm font-semibold">Available actions</h2>
              <p className="text-muted-foreground mt-1 text-xs">
                What your coworker can do with this integration
              </p>
            </div>

            {actions.length > 0 ? (
              <div className="grid grid-cols-1 gap-3.5">
                {actions.map((action) => (
                  <div
                    key={action.key}
                    className="border-border/40 bg-card rounded-xl border p-5 shadow-sm"
                  >
                    <p className="text-sm leading-snug font-medium">{action.label}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-border/40 bg-card rounded-xl border p-6 shadow-sm">
                <p className="text-muted-foreground text-sm">
                  No capabilities are listed for this integration yet.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ConnectedAccountRow({
  account,
  onDisconnectAccount,
  onToggleAccount,
  onRenameAccountLabel,
}: {
  account: IntegrationInfo;
  onDisconnectAccount?: (id: string) => void;
  onToggleAccount?: (id: string, enabled: boolean) => void;
  onRenameAccountLabel?: (input: { id: string; accountLabel: string }) => void;
}) {
  const [draft, setDraft] = useState(account.accountLabel ?? "");
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setDraft(account.accountLabel ?? "");
  }, [account.accountLabel]);

  const handleDraftChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  }, []);

  const handleSave = useCallback(() => {
    if (!account.accountLabelId || !draft.trim()) {
      return;
    }
    onRenameAccountLabel?.({
      id: account.accountLabelId,
      accountLabel: draft.trim(),
    });
    setIsEditing(false);
  }, [account.accountLabelId, draft, onRenameAccountLabel]);

  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleCancel = useCallback(() => {
    setDraft(account.accountLabel ?? "");
    setIsEditing(false);
  }, [account.accountLabel]);

  const handleDisconnect = useCallback(() => {
    onDisconnectAccount?.(account.id);
  }, [account.id, onDisconnectAccount]);

  const handleToggleAccount = useCallback(
    (enabled: boolean) => {
      onToggleAccount?.(account.id, enabled);
    },
    [account.id, onToggleAccount],
  );

  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              className="border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 text-sm font-medium"
              value={draft}
              onChange={handleDraftChange}
              aria-label={`Account Label for ${account.displayName ?? account.type}`}
              autoFocus
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              onClick={handleSave}
              disabled={!account.accountLabelId || !draft.trim() || draft === account.accountLabel}
              title="Save Account Label"
            >
              <Check className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={handleCancel}
              title="Cancel"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="text-muted-foreground mb-1 text-[10px] font-medium tracking-widest uppercase">
              Account Label
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <span className="bg-muted text-foreground inline-flex max-w-full rounded-md px-2 py-1 text-sm font-medium">
                <span className="truncate">{account.accountLabel ?? "unlabeled"}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground size-7 shrink-0"
                onClick={handleEdit}
                disabled={!account.accountLabelId}
                title="Rename Account Label"
              >
                <Pencil className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
        {account.displayName ? (
          <p className="text-muted-foreground mt-1 truncate text-xs">{account.displayName}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2">
          <Switch
            checked={account.enabled}
            onCheckedChange={handleToggleAccount}
            disabled={!onToggleAccount}
          />
          <span
            className={cn(
              "w-14 text-xs font-medium",
              account.enabled ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {account.enabled ? "Enabled" : "Disabled"}
          </span>
        </label>
        {onDisconnectAccount ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-8"
            onClick={handleDisconnect}
            title="Disconnect Connected Account"
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
