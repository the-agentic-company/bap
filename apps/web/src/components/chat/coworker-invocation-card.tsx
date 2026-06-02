"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";

type CoworkerInvocationCardProps = {
  coworkerId: string;
  username: string;
  name: string;
  runId: string;
  conversationId: string;
  status:
    | "running"
    | "needs_user_input"
    | "awaiting_approval"
    | "awaiting_auth"
    | "paused"
    | "completed"
    | "error"
    | "cancelled";
  attachmentNames: string[];
  message: string;
};

const ACTIVE_STATUSES = new Set([
  "running",
  "needs_user_input",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);

function getStatusLabel(status: CoworkerInvocationCardProps["status"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "needs_user_input":
      return "Needs your input";
    case "awaiting_approval":
      return "Awaiting approval";
    case "awaiting_auth":
      return "Awaiting auth";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "error":
      return "Error";
    case "cancelled":
      return "Cancelled";
  }
}

function getStatusClassName(status: CoworkerInvocationCardProps["status"]): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500/10 text-emerald-700";
    case "error":
      return "bg-red-500/10 text-red-700";
    case "cancelled":
      return "bg-stone-500/10 text-stone-700";
    case "paused":
      return "bg-amber-500/10 text-amber-700";
    case "needs_user_input":
      return "bg-emerald-500/10 text-emerald-700";
    default:
      return "bg-sky-500/10 text-sky-700";
  }
}

export function CoworkerInvocationCard(props: CoworkerInvocationCardProps) {
  const { data } = useQuery({
    queryKey: ["coworker", "run", props.runId, "invocation-card"],
    queryFn: () => client.coworker.getRun({ id: props.runId }),
    refetchInterval: (query) => {
      const status = (query.state.data?.status ??
        props.status) as CoworkerInvocationCardProps["status"];
      return ACTIVE_STATUSES.has(status) ? 3000 : false;
    },
  });

  const effectiveStatus =
    (data?.status as CoworkerInvocationCardProps["status"] | undefined) ?? props.status;
  const runHref = useMemo(
    () => `/agents/runs/${props.runId}?coworkerId=${props.coworkerId}`,
    [props.coworkerId, props.runId],
  );

  return (
    <div className="border-border/60 bg-card rounded-xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <CoworkerAvatar username={props.username} size={32} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{props.name}</p>
              <p className="text-muted-foreground text-xs">@{props.username}</p>
            </div>
          </div>
          <p className="text-foreground/90 text-sm leading-relaxed">{props.message}</p>
          {props.attachmentNames.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Files: {props.attachmentNames.join(", ")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
              getStatusClassName(effectiveStatus),
            )}
          >
            {ACTIVE_STATUSES.has(effectiveStatus) && <Loader2 className="h-3 w-3 animate-spin" />}
            {getStatusLabel(effectiveStatus)}
          </span>
          <Link
            href={runHref}
            className="border-border/70 text-foreground hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
          >
            Open
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
