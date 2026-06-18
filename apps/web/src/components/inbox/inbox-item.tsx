// oxlint-disable jsx-a11y/control-has-associated-label react/no-unstable-nested-components

import { T, useGT } from "gt-react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Loader2,
  Pencil,
  Send,
  MessageCircleQuestion,
  ShieldCheck,
  Square,
  TimerReset,
  Wrench,
} from "lucide-react";
import { useCallback, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { AuthRequestCard } from "@/components/chat/auth-request-card";
import { ToolApprovalCard } from "@/components/chat/tool-approval-card";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InboxItem as InboxItemType, ToolApprovalData } from "./types";
import { InboxEditForm } from "./inbox-edit-form";

const STATUS_CONFIG = {
  needs_user_input: { color: "bg-emerald-500", icon: MessageCircleQuestion },
  running: { color: "bg-sky-500", icon: Loader2 },
  awaiting_approval: { color: "bg-amber-500", icon: ShieldCheck },
  awaiting_auth: { color: "bg-orange-500", icon: KeyRound },
  paused: { color: "bg-blue-500", icon: TimerReset },
  cancelling: { color: "bg-amber-500", icon: Loader2 },
  completed: { color: "bg-emerald-500", icon: Check },
  error: { color: "bg-red-500", icon: AlertTriangle },
  cancelled: { color: "bg-muted-foreground/45", icon: Square },
} as const;

const STATUS_LABELS: Record<InboxItemType["status"], string> = {
  needs_user_input: "Needs your input",
  running: "running",
  awaiting_approval: "awaiting approval",
  awaiting_auth: "awaiting auth",
  paused: "needs continuation",
  cancelling: "cancelling",
  completed: "completed",
  error: "error",
  cancelled: "cancelled",
};

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const EXPANDABLE_MESSAGE_LENGTH = 360;
const INBOX_MARKDOWN_COMPONENTS = {
  a: ({ children, ...props }: ComponentPropsWithoutRef<"a">) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }: ComponentPropsWithoutRef<"table">) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }: ComponentPropsWithoutRef<"th">) => (
    <th className="border-border border-b px-2 py-1 text-left font-medium whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }: ComponentPropsWithoutRef<"td">) => (
    <td className="border-border border-b px-2 py-1 align-top whitespace-nowrap">{children}</td>
  ),
};

function formatRelative(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function StatusDot({ status }: { status: InboxItemType["status"] }) {
  const config = STATUS_CONFIG[status];
  const isActive = !["completed", "cancelled", "error"].includes(status);
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {isActive ? (
        <span
          className={cn("absolute inset-0 animate-ping rounded-full opacity-40", config.color)}
        />
      ) : null}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", config.color)} />
    </span>
  );
}

function AgentMessagePreview({ content }: { content: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandable =
    content.length > EXPANDABLE_MESSAGE_LENGTH ||
    content.includes("\n") ||
    content.includes("|") ||
    content.includes("```");
  const handleToggleExpanded = useCallback(() => {
    setIsExpanded((current) => !current);
  }, []);

  return (
    <div className="min-w-0 space-y-1">
      <div className="relative min-w-0">
        <div
          className={cn(
            "prose prose-sm dark:prose-invert prose-p:my-2 prose-headings:my-2 prose-headings:text-sm prose-headings:font-semibold prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:my-2 prose-pre:whitespace-pre-wrap prose-code:text-xs text-muted-foreground max-w-none break-words text-[12px] leading-5",
            isExpandable && !isExpanded && "max-h-32 overflow-hidden",
          )}
        >
          <ReactMarkdown
            remarkPlugins={MARKDOWN_REMARK_PLUGINS}
            components={INBOX_MARKDOWN_COMPONENTS}
          >
            {content}
          </ReactMarkdown>
        </div>
        {isExpandable && !isExpanded ? (
          <div className="from-card pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-start bg-gradient-to-t to-transparent pt-8">
            <span aria-hidden="true" className="text-muted-foreground bg-card pr-1 text-[12px]">
              ...
            </span>
          </div>
        ) : null}
      </div>
      {isExpandable ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-7 px-0 text-[12px]"
          aria-expanded={isExpanded}
          onClick={handleToggleExpanded}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="mr-1 h-3.5 w-3.5" />
              <T>Show less</T>
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-3.5 w-3.5" />
              <T>Show full message</T>
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}

function ReplyField({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (message: string) => void;
}) {
  const t = useGT();

  const [value, setValue] = useState("");
  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    onSend(trimmed);
    setValue("");
  }, [onSend, value]);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={t("Reply and open thread...")}
        disabled={disabled}
        className="border-border/50 bg-background text-foreground placeholder:text-muted-foreground/50 focus:border-ring focus:ring-ring/50 h-8 w-full rounded-md border px-3 text-[12px] outline-none focus:ring-1 disabled:opacity-50"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={disabled || !value.trim()}
        onClick={handleSend}
      >
        <Send className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

type Props = {
  item: InboxItemType;
  isEditing: boolean;
  isBusy?: boolean;
  onToggleEditing: () => void;
  onApprove: (questionAnswers?: string[][]) => void;
  onDeny: () => void;
  onStop: () => void;
  onContinue: () => void;
  onAuthConnect: (integration: string) => void;
  onAuthCancel: () => void;
  onSaveEdit: (updated: ToolApprovalData) => void;
  onReply: (message: string) => void;
  onOpenTarget: () => void;
  onOpenBuilder?: () => void;
  onMarkAsRead: () => void;
};

export function InboxItem({
  item,
  isEditing,
  isBusy: _isBusy,
  onToggleEditing,
  onApprove,
  onDeny,
  onStop,
  onContinue,
  onAuthConnect,
  onAuthCancel,
  onSaveEdit,
  onReply,
  onOpenTarget,
  onOpenBuilder,
  onMarkAsRead,
}: Props) {
  const statusConfig = STATUS_CONFIG[item.status];
  const StatusIcon = statusConfig.icon;

  const showStop =
    (item.status === "running" ||
      item.status === "awaiting_approval" ||
      item.status === "awaiting_auth" ||
      item.status === "needs_user_input") &&
    (Boolean(item.generationId) || item.status === "needs_user_input");
  const showContinue = item.status === "paused" && item.pauseReason === "run_deadline";
  const showBuilder = item.kind === "coworker" && item.status === "error" && item.builderAvailable;
  const showReply = item.status === "needs_user_input" || item.status === "paused";

  return (
    <div className="border-border bg-card group/item overflow-hidden rounded-lg border shadow-sm transition-colors">
      <div className="bg-muted/10 min-w-0 overflow-hidden px-5 py-4">
        <div className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-x-3.5 gap-y-4">
          <div className="flex h-7 items-center justify-center">
            <StatusDot status={item.status} />
          </div>

          <div className="flex min-w-0 items-center gap-3">
            {item.kind === "coworker" ? (
              <CoworkerAvatar username={item.coworkerName} size={28} className="rounded-full" />
            ) : null}

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-semibold">{item.title}</span>
                <span className="text-muted-foreground/70 shrink-0 text-[12px] tabular-nums">
                  {formatRelative(item.updatedAt)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-center pt-0.5">
            <StatusIcon
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                item.status === "awaiting_approval" && "text-amber-400",
                item.status === "needs_user_input" && "text-emerald-400",
                item.status === "running" && "text-sky-400",
                item.status === "awaiting_auth" && "text-orange-400",
                item.status === "paused" && "text-blue-400",
                item.status === "cancelling" && "text-amber-400",
                item.status === "completed" && "text-emerald-400",
                item.status === "error" && "text-red-400",
                item.status === "cancelled" && "text-muted-foreground",
              )}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="text-muted-foreground min-w-0 text-[12px]">
              {item.lastAgentMessage ? (
                <AgentMessagePreview content={item.lastAgentMessage} />
              ) : (
                <span className="min-w-0 font-mono text-[11px] leading-5 tracking-wide break-words uppercase">
                  {STATUS_LABELS[item.status]}
                </span>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90 h-8 border-transparent px-3 text-[12px] shadow-sm"
                onClick={onOpenTarget}
              >
                <T>Chat</T>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="bg-background/80 hover:bg-accent h-8 px-3 text-[12px] shadow-sm"
                onClick={onMarkAsRead}
              >
                <T>Mark read</T>
              </Button>
              {showBuilder && onOpenBuilder ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-background/80 hover:bg-accent h-8 px-3 text-[12px] shadow-sm"
                  onClick={onOpenBuilder}
                >
                  <Wrench className="mr-1 h-3.5 w-3.5" />
                  <T>Builder</T>
                </Button>
              ) : null}
              {showStop ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-background/80 hover:bg-accent h-8 px-3 text-[12px] shadow-sm"
                  onClick={onStop}
                >
                  <Square className="mr-1 h-3.5 w-3.5" />
                  {item.status === "needs_user_input" ? "Dismiss" : "Stop"}
                </Button>
              ) : null}
              {showContinue ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-background/80 hover:bg-accent h-8 px-3 text-[12px] shadow-sm"
                  onClick={onContinue}
                >
                  <TimerReset className="mr-1 h-3.5 w-3.5" />
                  <T>Continue</T>
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {item.pendingApproval && !isEditing ? (
          <div className="space-y-2">
            <div className="[&_.whitespace-pre-wrap]:break-words [&_pre]:break-words [&_pre]:whitespace-pre-wrap">
              <ToolApprovalCard
                toolUseId={item.pendingApproval.toolUseId}
                toolName={item.pendingApproval.toolName}
                toolInput={item.pendingApproval.toolInput}
                integration={item.pendingApproval.integration}
                operation={item.pendingApproval.operation}
                command={item.pendingApproval.command}
                status="pending"
                onApprove={onApprove}
                onDeny={onDeny}
                isLoading={_isBusy}
              />
            </div>
            <div className="flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2">
              <Pencil className="h-3.5 w-3.5 shrink-0 text-blue-400" />
              <span className="text-muted-foreground flex-1 text-[12px]">
                <T>Want to modify the action before approving?</T>
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-blue-500/30 text-[12px] text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
                onClick={onToggleEditing}
              >
                <Pencil className="mr-1.5 h-3 w-3" />
                <T>Edit</T>
              </Button>
            </div>
          </div>
        ) : null}

        {item.pendingApproval && isEditing ? (
          <InboxEditForm
            toolApproval={item.pendingApproval}
            onSave={onSaveEdit}
            onCancel={onToggleEditing}
          />
        ) : null}

        {item.pendingAuth ? (
          <AuthRequestCard
            integrations={item.pendingAuth.integrations}
            connectedIntegrations={item.pendingAuth.connectedIntegrations}
            reason={item.pendingAuth.reason}
            status="pending"
            onConnect={onAuthConnect}
            onCancel={onAuthCancel}
            isLoading={_isBusy}
          />
        ) : null}

        {item.errorMessage ? (
          <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
            <p className="font-mono text-[12px] text-red-400">{item.errorMessage}</p>
          </div>
        ) : null}

        {showContinue ? (
          <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[12px] text-blue-300">
            <T>
              This run hit the max runtime and can be continued from the saved conversation state.
            </T>
          </div>
        ) : null}

        {showReply ? <ReplyField disabled={_isBusy} onSend={onReply} /> : null}
      </div>
    </div>
  );
}
