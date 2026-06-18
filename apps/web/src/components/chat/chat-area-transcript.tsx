import { useMemo } from "react";
import type React from "react";
import {
  isContinueMessage,
  renderHistoricalActivityBlock,
  type HistoricalActivityBlock,
} from "./generation-stream/chat-generation-interrupts";
import { MessageList, type Message } from "./message-list";

export function useChatAreaTranscriptNodes({
  historicalActivityBlocks,
  messages,
}: {
  historicalActivityBlocks: HistoricalActivityBlock[];
  messages: Message[];
}) {
  return useMemo(() => {
    const continueMessageIndices = messages.reduce<number[]>((indices, message, index) => {
      if (isContinueMessage(message)) {
        indices.push(index);
      }
      return indices;
    }, []);

    const pairedBlockCount = Math.min(
      historicalActivityBlocks.length,
      continueMessageIndices.length,
    );
    const pairedBlocks = historicalActivityBlocks.slice(0, pairedBlockCount);
    const trailingBlocks = historicalActivityBlocks.slice(pairedBlockCount);

    const nodes: React.ReactNode[] = [];
    let cursor = 0;

    for (let index = 0; index < pairedBlockCount; index += 1) {
      const continueIndex = continueMessageIndices[index];
      const messageSlice = messages.slice(cursor, continueIndex);
      if (messageSlice.length > 0) {
        nodes.push(
          <MessageList key={`messages-before-${continueIndex}`} messages={messageSlice} />,
        );
      }

      const block = pairedBlocks[index];
      if (block) {
        nodes.push(renderHistoricalActivityBlock(block));
      }

      const continueMessage = messages.slice(continueIndex, continueIndex + 1);
      if (continueMessage.length > 0) {
        nodes.push(
          <MessageList key={`messages-continue-${continueIndex}`} messages={continueMessage} />,
        );
      }

      if (continueIndex !== undefined && block) {
        cursor = continueIndex + 1;
      }
    }

    const remainingMessages = messages.slice(cursor);
    if (remainingMessages.length > 0) {
      nodes.push(<MessageList key="messages-remaining" messages={remainingMessages} />);
    }

    for (const block of trailingBlocks) {
      nodes.push(renderHistoricalActivityBlock(block));
    }

    return nodes;
  }, [historicalActivityBlocks, messages]);
}
