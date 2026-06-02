"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { use, useEffect, useMemo } from "react";
import { ChatArea } from "@/components/chat/chat-area";
import { ImpersonationRequiredPage } from "@/components/impersonation/impersonation-required-page";
import { client } from "@/orpc/client";
import { useConversation, useConversationImpersonationTarget } from "@/orpc/hooks";

type Props = {
  params: Promise<{ conversationId: string }>;
};

export default function ConversationPage({ params }: Props) {
  const { conversationId } = use(params);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const authComplete = searchParams.get("auth_complete");
  const interruptId = searchParams.get("interrupt_id");
  const { data: conversation, isLoading } = useConversation(conversationId);
  const shouldLoadImpersonationTarget = Boolean(conversationId && !isLoading && !conversation);
  const { data: impersonationTarget, isLoading: isImpersonationTargetLoading } =
    useConversationImpersonationTarget(conversationId, {
      enabled: shouldLoadImpersonationTarget,
    });
  const redirectPath = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const authCompletion = useMemo(
    () => (authComplete && interruptId ? { integration: authComplete, interruptId } : null),
    [authComplete, interruptId],
  );

  // Handle OAuth callback
  useEffect(() => {
    if (authComplete && interruptId) {
      // Notify server that auth is complete
      client.generation
        .submitAuthResult({
          interruptId,
          integration: authComplete,
          success: true,
        })
        .then(() => {
          // Clear URL params
          window.history.replaceState({}, "", `/chat/${conversationId}`);
        })
        .catch((err) => {
          console.error("Failed to submit auth result:", err);
        });
    }
  }, [authComplete, conversationId, interruptId]);

  if (isLoading || (shouldLoadImpersonationTarget && isImpersonationTargetLoading)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!conversation) {
    if (impersonationTarget) {
      return <ImpersonationRequiredPage target={impersonationTarget} redirectPath={redirectPath} />;
    }

    return <div className="text-muted-foreground p-6 text-sm">Conversation not found.</div>;
  }

  return (
    <ChatArea conversationId={conversationId} authCompletion={authCompletion} enableOutputPreview />
  );
}
