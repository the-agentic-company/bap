import { LoaderCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConversationUsage } from "@/orpc/hooks/conversation";

type ConversationUsageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId?: string | null;
  entityType?: "conversation" | "run";
  entityTitle?: string | null;
  pending?: boolean;
};

function formatTokenCount(value: number): string {
  return value.toLocaleString();
}

export function ConversationUsageDialog({
  open,
  onOpenChange,
  conversationId,
  entityType = "conversation",
  entityTitle,
  pending = false,
}: ConversationUsageDialogProps) {
  const usageQuery = useConversationUsage(conversationId ?? null, open && !pending);
  const title = entityType === "run" ? "Run usage" : "Conversation usage";
  const description = entityTitle
    ? `Token usage for ${entityTitle || "Untitled"}.`
    : entityType === "run"
      ? "Token usage for this run."
      : "Token usage for this conversation.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {pending || usageQuery.isLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            <span>Loading stored usage...</span>
          </div>
        ) : !conversationId ? (
          <div className="space-y-1 py-2">
            <p className="text-sm font-medium">Usage unavailable</p>
            <p className="text-muted-foreground text-sm">
              This {entityType} does not have a linked conversation yet.
            </p>
          </div>
        ) : usageQuery.isError ? (
          <div className="space-y-1 py-2">
            <p className="text-sm font-medium">Usage unavailable</p>
            <p className="text-muted-foreground text-sm">
              We couldn&apos;t load usage for this {entityType}.
            </p>
          </div>
        ) : usageQuery.data ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground text-xs">Input</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatTokenCount(usageQuery.data.inputTokens)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground text-xs">Output</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatTokenCount(usageQuery.data.outputTokens)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground text-xs">Total</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatTokenCount(usageQuery.data.totalTokens)}
                </p>
              </div>
            </div>
            <p className="text-muted-foreground text-sm">
              Stored across {usageQuery.data.assistantMessageCount} assistant messages.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
