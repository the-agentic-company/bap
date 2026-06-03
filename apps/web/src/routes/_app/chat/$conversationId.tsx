"use client";

import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { ChatArea } from "@/components/chat/chat-area";
import { ImpersonationRequiredPage } from "@/components/impersonation/impersonation-required-page";
import { client } from "@/orpc/client";
import { useConversation, useConversationImpersonationTarget } from "@/orpc/hooks";

type ConversationSearch = {
  auth_complete?: string;
  interrupt_id?: string;
};

export const Route = createFileRoute("/_app/chat/$conversationId")({
  // OAuth completion flags drive the post-auth resume flow; validate them at the boundary.
  validateSearch: (search: Record<string, unknown>): ConversationSearch => {
    const authComplete = typeof search.auth_complete === "string" ? search.auth_complete : undefined;
    const interruptId = typeof search.interrupt_id === "string" ? search.interrupt_id : undefined;
    return {
      ...(authComplete ? { auth_complete: authComplete } : {}),
      ...(interruptId ? { interrupt_id: interruptId } : {}),
    };
  },
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = Route.useParams();
  const search = Route.useSearch();
  const authComplete = search.auth_complete ?? null;
  const interruptId = search.interrupt_id ?? null;
  const { data: conversation, isLoading } = useConversation(conversationId);
  const shouldLoadImpersonationTarget = Boolean(conversationId && !isLoading && !conversation);
  const { data: impersonationTarget, isLoading: isImpersonationTargetLoading } =
    useConversationImpersonationTarget(conversationId, {
      enabled: shouldLoadImpersonationTarget,
    });
  const redirectPath = useMemo(() => {
    const params = new URLSearchParams();
    if (authComplete) {
      params.set("auth_complete", authComplete);
    }
    if (interruptId) {
      params.set("interrupt_id", interruptId);
    }
    const query = params.toString();
    return query ? `/chat/${conversationId}?${query}` : `/chat/${conversationId}`;
  }, [authComplete, conversationId, interruptId]);
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
