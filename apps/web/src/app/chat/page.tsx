"use client";

import { useSearchParams } from "next/navigation";
import { ChatArea } from "@/components/chat/chat-area";

export default function NewChatPage() {
  const searchParams = useSearchParams();
  const initialPrefillText = searchParams?.get("prefill") ?? null;

  return <ChatArea initialPrefillText={initialPrefillText} enableOutputPreview />;
}
