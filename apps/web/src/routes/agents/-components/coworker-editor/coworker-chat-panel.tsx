import { T, useGT } from "gt-react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { ChatArea } from "@/components/chat/chat-area";
import { ChatCopyButton } from "@/components/chat/chat-copy-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AppLink as Link } from "../../-lib/app-link";

const CoworkerChatPanelBackHrefContext = createContext<string | undefined>(
  undefined,
);

export function CoworkerChatPanelBackHrefProvider({
  backHref,
  children,
}: {
  backHref?: string;
  children: ReactNode;
}) {
  return (
    <CoworkerChatPanelBackHrefContext.Provider value={backHref}>
      {children}
    </CoworkerChatPanelBackHrefContext.Provider>
  );
}

type CoworkerChatPanelProps = {
  conversationId: string | null;
  coworkerId: string;
  onCoworkerSync: (payload: {
    coworkerId: string;
    prompt?: string;
    updatedAt?: string;
  }) => void;
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
        <Loader2
          className={cn("h-5 w-5 animate-spin", !isLoading && "opacity-60")}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="bg-background/95 border-border/60 flex h-12 items-center gap-2 border-b px-4 py-2 backdrop-blur-sm">
        <BackToRunLink />
        <ChatCopyButton
          conversationId={conversationId}
          className="rounded-xl"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatArea
          conversationId={conversationId}
          compact
          forceCoworkerQuerySync
          onCoworkerSync={onCoworkerSync}
          coworkerIdForSync={coworkerId}
          skillSelectionScopeKey={skillSelectionScopeKey}
        />
      </div>
    </div>
  );
}

function BackToRunLink() {
  const t = useGT();
  const backHref = useContext(CoworkerChatPanelBackHrefContext);

  if (!backHref) {
    return <div className="h-9 w-9" aria-hidden="true" />;
  }

  return (
    <Link
      href={backHref}
      className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors"
      title={t("Back to run")}
      aria-label={t("Back to run")}
    >
      <ArrowLeft className="h-[18px] w-[18px]" />
      <T>Back to run</T>
    </Link>
  );
}
