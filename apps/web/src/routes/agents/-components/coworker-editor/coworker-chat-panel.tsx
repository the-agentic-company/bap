import { T } from "gt-react";
import { Loader2 } from "lucide-react";
import { ChatArea } from "@/components/chat/chat-area";
import { ChatCopyButton } from "@/components/chat/chat-copy-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CoworkerChatPanelProps = {
  conversationId: string | null;
  coworkerId: string;
  onCoworkerSync: (payload: { coworkerId: string; prompt?: string; updatedAt?: string }) => void;
  skillSelectionScopeKey: string;
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
};

export function CoworkerChatPanel({
  conversationId,
  coworkerId,
  onCoworkerSync,
  skillSelectionScopeKey,
  isLoading,
  errorMessage,
  onRetry,
}: CoworkerChatPanelProps) {
  if (!conversationId) {
    if (errorMessage) {
      return (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <p className="text-sm font-medium">
              <T>Failed to load builder chat</T>
            </p>
            <p className="text-muted-foreground text-xs">{errorMessage}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <T>Retry</T>
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className={cn("h-5 w-5 animate-spin", !isLoading && "opacity-60")} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-end px-4 py-2">
        <ChatCopyButton conversationId={conversationId} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatArea
          conversationId={conversationId}
          forceCoworkerQuerySync
          onCoworkerSync={onCoworkerSync}
          coworkerIdForSync={coworkerId}
          skillSelectionScopeKey={skillSelectionScopeKey}
        />
      </div>
    </div>
  );
}
