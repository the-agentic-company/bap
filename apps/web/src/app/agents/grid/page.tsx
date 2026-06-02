"use client";

import { BarChart3, Loader2 } from "lucide-react";
import Link from "next/link";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import { cn } from "@/lib/utils";
import { useCoworkerList } from "@/orpc/hooks";

type CoworkerItem = {
  id: string;
  name?: string | null;
  status: "on" | "off";
  triggerType: string;
  recentRuns?: {
    id: string;
    status: string;
    startedAt?: Date | string | null;
    conversationId?: string | null;
    source?: string;
  }[];
};

function formatDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
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

function getCoworkerDisplayName(name?: string | null) {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "New Coworker";
}

function CoworkerCard({ coworker }: { coworker: CoworkerItem }) {
  const isOn = coworker.status === "on";
  const recentRun = Array.isArray(coworker.recentRuns) ? coworker.recentRuns[0] : null;

  return (
    <Link
      href={`/agents/${coworker.id}`}
      className="border-border/40 bg-card hover:border-border hover:bg-muted/30 group flex flex-col gap-3 rounded-xl border p-4 shadow-sm transition-all duration-150"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm leading-tight font-medium">{getCoworkerDisplayName(coworker.name)}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "mt-0.5 size-2 rounded-full",
              isOn ? "bg-green-500" : "bg-muted-foreground/30",
            )}
          />
          <span className="text-muted-foreground text-xs">{isOn ? "On" : "Off"}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          {getTriggerLabel(coworker.triggerType)}
        </span>
      </div>

      <div className="text-muted-foreground/70 mt-auto text-xs">
        {recentRun ? (
          <span>
            Last run:{" "}
            <span className="text-muted-foreground">
              {getCoworkerRunStatusLabel(recentRun.status)}
            </span>{" "}
            · {formatDate(recentRun.startedAt) ?? "—"}
          </span>
        ) : (
          <span>No runs yet</span>
        )}
      </div>
    </Link>
  );
}

export default function CoworkersGridPage() {
  const { data: coworkers, isLoading } = useCoworkerList();
  const coworkerList = Array.isArray(coworkers) ? coworkers : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">All Coworkers</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {coworkerList.length} coworker{coworkerList.length === 1 ? "" : "s"} in grid view
          </p>
        </div>
        <Link
          href="/agents/overview"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors"
        >
          <BarChart3 className="size-3.5" />
          Overview
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : coworkerList.length === 0 ? (
        <div className="border-border/40 rounded-xl border border-dashed p-10 text-center">
          <p className="text-muted-foreground text-sm">No coworkers found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {coworkerList.map((wf) => (
            <CoworkerCard key={wf.id} coworker={wf} />
          ))}
        </div>
      )}
    </div>
  );
}
