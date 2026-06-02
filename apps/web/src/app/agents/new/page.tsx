"use client";

import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@cmdclaw/core/lib/chat-model-defaults";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  clearPendingCoworkerPrompt,
  getPendingCoworkerGenerationContent,
  readPendingCoworkerPrompt,
} from "@/components/landing/pending-coworker-prompt";
import { getCoworkerEditHref } from "@/lib/coworker-routes";
import { normalizeGenerationError } from "@/lib/generation-errors";
import { COWORKER_AVAILABLE_INTEGRATION_TYPES } from "@/lib/integration-icons";
import { client } from "@/orpc/client";
import { useCreateCoworker } from "@/orpc/hooks";

const DEFAULT_COWORKER_BUILDER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;

export default function NewCoworkerPage() {
  const router = useRouter();
  const createCoworker = useCreateCoworker();
  const hasStartedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }

    const pendingPrompt = readPendingCoworkerPrompt();
    const initialMessage = pendingPrompt
      ? getPendingCoworkerGenerationContent(pendingPrompt)
      : null;
    if (!pendingPrompt || !initialMessage) {
      router.replace("/");
      return;
    }

    hasStartedRef.current = true;

    void (async () => {
      try {
        const result = await createCoworker.mutateAsync({
          name: "",
          triggerType: "manual",
          prompt: "",
          model: DEFAULT_COWORKER_BUILDER_MODEL,
          authSource: "shared",
          allowedIntegrations: COWORKER_AVAILABLE_INTEGRATION_TYPES,
        });

        try {
          const { conversationId } = await client.coworker.getOrCreateBuilderConversation({
            id: result.id,
          });
          await client.generation.startGeneration({
            conversationId,
            content: initialMessage,
            model: DEFAULT_COWORKER_BUILDER_MODEL,
            authSource: "shared",
            autoApprove: true,
            fileAttachments: pendingPrompt.attachments,
          });
        } catch (error) {
          console.error("Failed to start coworker builder generation:", error);
          setError(normalizeGenerationError(error, "start_rpc").message);
          return;
        }

        clearPendingCoworkerPrompt();
        window.location.assign(getCoworkerEditHref(result));
      } catch (error) {
        console.error("Failed to resume coworker builder creation:", error);
        clearPendingCoworkerPrompt();
        router.replace("/");
      }
    })();
  }, [createCoworker, router]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center">
      {error ? (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          <p className="text-muted-foreground text-sm">Preparing your coworker builder...</p>
        </div>
      )}
    </div>
  );
}
