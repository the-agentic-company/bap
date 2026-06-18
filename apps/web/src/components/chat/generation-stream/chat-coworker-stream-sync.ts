import { useCallback, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

function extractCoworkerSyncDataFromToolResult(result: unknown): {
  coworkerId?: string;
  prompt?: string;
  updatedAt?: string;
} {
  if (typeof result === "object" && result !== null) {
    const maybeCoworkerId = (result as { coworkerId?: unknown }).coworkerId;
    const maybeCoworker = (
      result as {
        coworker?: { prompt?: unknown; updatedAt?: unknown };
      }
    ).coworker;
    return {
      coworkerId: typeof maybeCoworkerId === "string" ? maybeCoworkerId : undefined,
      prompt: typeof maybeCoworker?.prompt === "string" ? maybeCoworker.prompt : undefined,
      updatedAt: typeof maybeCoworker?.updatedAt === "string" ? maybeCoworker.updatedAt : undefined,
    };
  }

  if (typeof result !== "string") {
    return {};
  }

  try {
    return extractCoworkerSyncDataFromToolResult(JSON.parse(result));
  } catch {
    return {};
  }
}

export type CoworkerStreamSyncAdapter = {
  clearTrackedCoworkerEditToolUses: () => void;
  triggerCoworkerSync: (payload: {
    coworkerId: string;
    prompt?: string;
    updatedAt?: string;
  }) => void;
  trackCoworkerEditToolUse: (payload: {
    toolUseId?: string;
    integration?: string;
    operation?: string;
  }) => void;
  syncCoworkerAfterToolResult: (toolUseId: string | undefined, result: unknown) => void;
};

export function useCoworkerStreamSyncAdapter({
  queryClient,
  forceCoworkerQuerySync,
  coworkerIdForSync,
  onCoworkerSync,
}: {
  queryClient: QueryClient;
  forceCoworkerQuerySync: boolean;
  coworkerIdForSync?: string;
  onCoworkerSync?: (payload: { coworkerId: string; prompt?: string; updatedAt?: string }) => void;
}): CoworkerStreamSyncAdapter {
  const coworkerEditToolUseIdsRef = useRef(new Set<string>());

  const clearTrackedCoworkerEditToolUses = useCallback(() => {
    coworkerEditToolUseIdsRef.current.clear();
  }, []);

  const triggerCoworkerSync = useCallback(
    ({
      coworkerId,
      prompt,
      updatedAt,
    }: {
      coworkerId: string;
      prompt?: string;
      updatedAt?: string;
    }) => {
      queryClient.invalidateQueries({ queryKey: ["coworker"] });
      queryClient.invalidateQueries({ queryKey: ["coworker", "get", coworkerId] });
      onCoworkerSync?.({ coworkerId, prompt, updatedAt });
    },
    [onCoworkerSync, queryClient],
  );

  const trackCoworkerEditToolUse = useCallback(
    ({
      toolUseId,
      integration,
      operation,
    }: {
      toolUseId?: string;
      integration?: string;
      operation?: string;
    }) => {
      if (!forceCoworkerQuerySync || !toolUseId) {
        return;
      }

      if (integration === "coworker" && operation === "edit") {
        coworkerEditToolUseIdsRef.current.add(toolUseId);
        return;
      }

      coworkerEditToolUseIdsRef.current.delete(toolUseId);
    },
    [forceCoworkerQuerySync],
  );

  const syncCoworkerAfterToolResult = useCallback(
    (toolUseId: string | undefined, result: unknown) => {
      if (!forceCoworkerQuerySync || !toolUseId) {
        return;
      }

      if (!coworkerEditToolUseIdsRef.current.has(toolUseId)) {
        return;
      }
      coworkerEditToolUseIdsRef.current.delete(toolUseId);

      const syncData = extractCoworkerSyncDataFromToolResult(result);
      const syncedCoworkerId = syncData.coworkerId ?? coworkerIdForSync;
      if (!syncedCoworkerId) {
        return;
      }

      triggerCoworkerSync({
        coworkerId: syncedCoworkerId,
        prompt: syncData.prompt,
        updatedAt: syncData.updatedAt,
      });
    },
    [coworkerIdForSync, forceCoworkerQuerySync, triggerCoworkerSync],
  );

  return {
    clearTrackedCoworkerEditToolUses,
    triggerCoworkerSync,
    trackCoworkerEditToolUse,
    syncCoworkerAfterToolResult,
  };
}
