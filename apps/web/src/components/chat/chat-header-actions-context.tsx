"use client";

import { createContext, useContext } from "react";

type ChatHeaderActionsContextValue = {
  setHeaderActions: (node: React.ReactNode) => void;
};

const ChatHeaderActionsContext = createContext<ChatHeaderActionsContextValue | null>(null);

export function ChatHeaderActionsProvider({
  value,
  children,
}: {
  value: ChatHeaderActionsContextValue;
  children: React.ReactNode;
}) {
  return (
    <ChatHeaderActionsContext.Provider value={value}>{children}</ChatHeaderActionsContext.Provider>
  );
}

export function useChatHeaderActions() {
  const context = useContext(ChatHeaderActionsContext);
  if (!context) {
    return {
      setHeaderActions: () => {},
    };
  }
  return context;
}
