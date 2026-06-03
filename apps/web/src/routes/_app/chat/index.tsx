"use client";

import { createFileRoute } from "@tanstack/react-router";
import { ChatArea } from "@/components/chat/chat-area";

type ChatIndexSearch = {
  prefill?: string;
};

export const Route = createFileRoute("/_app/chat/")({
  // `prefill` seeds the new-chat composer; validate it at the route boundary so the
  // search state is typed and explicit.
  validateSearch: (search: Record<string, unknown>): ChatIndexSearch => {
    const prefill = typeof search.prefill === "string" ? search.prefill : undefined;
    return prefill ? { prefill } : {};
  },
  head: () => ({
    meta: [{ title: "New chat | CmdClaw" }],
  }),
  component: NewChatPage,
});

function NewChatPage() {
  const { prefill } = Route.useSearch();
  const initialPrefillText = prefill ?? null;

  return <ChatArea initialPrefillText={initialPrefillText} enableOutputPreview />;
}
