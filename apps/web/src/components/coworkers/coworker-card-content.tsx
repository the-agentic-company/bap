import { T } from "gt-react";
import { Star } from "lucide-react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { cn } from "@/lib/utils";

export type CoworkerCardData = {
  name?: string | null;
  username?: string | null;
  description?: string | null;
  status: "on" | "off";
  triggerType: string;
  isPinned?: boolean;
  sharedAt?: Date | string | null;
  recentRuns?: {
    id?: string;
    status: string;
    startedAt?: Date | string | null;
  }[];
};

function formatDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 1) {
    return "just now";
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffH < 24) {
    return `${diffH}h ago`;
  }
  if (diffD < 7) {
    return `${diffD}d ago`;
  }
  return date.toLocaleDateString();
}

function getTriggerLabel(triggerType: string) {
  const map: Record<string, string> = {
    manual: "Manual",
    schedule: "Scheduled",
    email: "Email",
    webhook: "Webhook",
  };
  return map[triggerType] ?? triggerType;
}

export function getCoworkerDisplayName(name?: string | null) {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "New Coworker";
}

/**
 * Shared visual content for coworker cards.
 * Used by the main coworkers page card.
 * Does NOT render a wrapper element — the caller provides the container (div, Link, etc.)
 * along with any interactive controls (dropdown menu, status toggle, action buttons).
 */
export function CoworkerCardContent({
  coworker,
  statusSlot,
  actionsSlot,
  badgesSlot,
  runsSlot,
  footerSlot,
}: {
  coworker: CoworkerCardData;
  /** Top-right status badge area. If omitted, renders a default on/off pill. */
  statusSlot?: React.ReactNode;
  /** Extra action buttons in the header row (e.g. dropdown menu). Rendered before the status slot. */
  actionsSlot?: React.ReactNode;
  /** Extra badges after the trigger badge (e.g. integration icons, skill count). */
  badgesSlot?: React.ReactNode;
  /** Runs section override. If omitted, renders the default static last-run text. */
  runsSlot?: React.ReactNode;
  /** Footer row override. If omitted, renders the default "Coworker" label. */
  footerSlot?: React.ReactNode;
}) {
  const isOn = coworker.status === "on";
  const recentRun = coworker.recentRuns?.[0];
  const hasRuns = Array.isArray(coworker.recentRuns) && coworker.recentRuns.length > 0;

  return (
    <>
      {/* Header: avatar + name + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <CoworkerAvatar
            username={coworker.username}
            size={36}
            className="shrink-0 rounded-full"
          />
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-1 truncate text-sm leading-tight font-medium">
              {coworker.isPinned && <Star className="text-brand size-3 shrink-0 fill-current" />}
              {getCoworkerDisplayName(coworker.name)}
            </p>
            {coworker.username ? (
              <p className="text-muted-foreground bg-muted/60 inline-flex rounded-full px-2 py-0.5 font-mono text-[10px]">
                @{coworker.username}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actionsSlot}
          {statusSlot ?? (
            <div
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
                isOn
                  ? "border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400"
                  : "border-border bg-muted/60 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  isOn ? "bg-green-500" : "bg-muted-foreground/40",
                )}
              />
              {isOn ? "On" : "Off"}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {coworker.description ? (
        <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
          {coworker.description}
        </p>
      ) : null}

      {/* Badges: trigger + shared + extras */}
      <div className="flex items-center gap-2">
        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          {getTriggerLabel(coworker.triggerType)}
        </span>
        {coworker.sharedAt ? (
          <span className="text-foreground/70 bg-foreground/[0.06] inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
            <T>Shared</T>
          </span>
        ) : null}
        {badgesSlot}
      </div>

      {/* Last run */}
      {runsSlot ??
        (hasRuns ? (
          <div className="text-muted-foreground/70 text-xs">
            {recentRun ? (
              <span>
                <T>Last run:</T>{" "}
                <span className="text-muted-foreground">
                  {getCoworkerRunStatusLabel(recentRun.status)}
                </span>{" "}
                · {formatDate(recentRun.startedAt) ?? "—"}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="text-muted-foreground/70 text-xs">
            <span>
              <T>No runs yet</T>
            </span>
          </div>
        ))}

      {/* Footer */}
      {footerSlot ?? (
        <div className="mt-auto flex items-center pt-3">
          <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
            <T>Coworker</T>
          </span>
        </div>
      )}
    </>
  );
}
