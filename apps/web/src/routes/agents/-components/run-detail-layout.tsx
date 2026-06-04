import { BarChart3, MoreHorizontal, Pencil } from "lucide-react";
import { Outlet } from "@tanstack/react-router";
import { AppLink as Link } from "../-lib/app-link";
import { useParams } from "../-lib/next-navigation-compat";
import { useCallback, useState } from "react";
import { ChatCopyButton } from "@/components/chat/chat-copy-button";
import { ChatShareControls } from "@/components/chat/chat-share-controls";
import { ConversationUsageDialog } from "@/components/conversation-usage-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { getCoworkerEditHref } from "@/lib/coworker-routes";
import { useCoworkerRun } from "@/orpc/hooks/coworkers";

export default function CoworkerRunLayout() {
  const { isAdmin } = useIsAdmin();
  const params = useParams<{ id: string }>();
  const runId = params?.id;
  const { data: run } = useCoworkerRun(runId);
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const conversationId = run?.conversationId ?? undefined;
  const runLabel = run?.coworkerUsername
    ? `@${run.coworkerUsername}`
    : run?.coworkerName || (isAdmin && runId ? `ID: ${runId}` : null);
  const handleUsageOpenChange = useCallback((open: boolean) => {
    setIsUsageOpen(open);
  }, []);
  const handleUsageMenuSelect = useCallback(() => {
    setIsUsageOpen(true);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden pb-[calc(3.5rem+var(--safe-area-inset-bottom))] md:pb-0">
      <header className="bg-background flex shrink-0 items-center gap-2 px-4 pt-[max(0.5rem,var(--safe-area-inset-top))] pb-2 md:h-14 md:pt-0 md:pb-0">
        {runLabel ? (
          <span
            className={
              run?.coworkerUsername
                ? "text-foreground max-w-[min(55vw,20rem)] truncate text-sm font-medium"
                : "text-muted-foreground max-w-[min(55vw,20rem)] truncate text-xs"
            }
            title={runLabel}
          >
            {runLabel}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
                aria-label="Run actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleUsageMenuSelect}>
                <BarChart3 className="h-4 w-4" />
                <span>Show usage</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {run?.coworkerId && (
            <Link
              href={getCoworkerEditHref({
                id: run.coworkerId,
                username: run.coworkerUsername,
              })}
              className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
              title="Open in Builder"
            >
              <Pencil className="h-4 w-4" />
            </Link>
          )}
          <ChatCopyButton conversationId={conversationId} />
          <ChatShareControls conversationId={conversationId} />
        </div>
      </header>
      <ConversationUsageDialog
        open={isUsageOpen}
        onOpenChange={handleUsageOpenChange}
        conversationId={run?.conversationId}
        entityType="run"
        entityTitle={runLabel}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
