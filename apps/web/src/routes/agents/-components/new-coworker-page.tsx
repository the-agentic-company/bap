import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@cmdclaw/core/lib/chat-model-defaults";
import { useNavigate } from "@tanstack/react-router";
import { T } from "gt-react";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  clearPendingCoworkerPrompt,
  getPendingCoworkerGenerationContent,
  readPendingCoworkerPrompt,
} from "@/components/landing/pending-coworker-prompt";
import { startCoworkerBuilderGeneration } from "@/components/landing/start-coworker-builder-generation";
import { COWORKER_AVAILABLE_INTEGRATION_TYPES } from "@/lib/integration-icons";
import { useCreateCoworker } from "@/orpc/hooks/coworkers";

const DEFAULT_COWORKER_BUILDER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;

let activeNewCoworkerCreation: Promise<void> | null = null;

export default function NewCoworkerPage() {
  const navigate = useNavigate();
  const createCoworker = useCreateCoworker();
  const hasStartedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }

    if (activeNewCoworkerCreation) {
      activeNewCoworkerCreation.catch((error) => {
        console.error("Failed to resume coworker builder creation:", error);
        setError("Failed to create coworker.");
      });
      return;
    }

    const pendingPrompt = readPendingCoworkerPrompt();
    const initialMessage = pendingPrompt
      ? getPendingCoworkerGenerationContent(pendingPrompt)
      : null;
    if (!pendingPrompt || !initialMessage) {
      void navigate({ to: "/", replace: true });
      return;
    }

    hasStartedRef.current = true;

    activeNewCoworkerCreation = (async () => {
      try {
        const result = await createCoworker.mutateAsync({
          name: "",
          triggerType: "manual",
          prompt: "",
          model: DEFAULT_COWORKER_BUILDER_MODEL,
          authSource: "shared",
          allowedIntegrations: COWORKER_AVAILABLE_INTEGRATION_TYPES,
        });

        await startCoworkerBuilderGeneration({
          coworkerId: result.id,
          content: initialMessage,
          model: DEFAULT_COWORKER_BUILDER_MODEL,
          authSource: "shared",
          attachments: pendingPrompt.attachments,
        });
        clearPendingCoworkerPrompt();
        void navigate({
          to: "/agents/edit/$id",
          params: { id: result.id },
          replace: true,
        });
        window.setTimeout(() => {
          activeNewCoworkerCreation = null;
        }, 10_000);
      } catch (error) {
        activeNewCoworkerCreation = null;
        clearPendingCoworkerPrompt();
        throw error;
      }
    })();
    activeNewCoworkerCreation.catch((error) => {
      console.error("Failed to resume coworker builder creation:", error);
      setError("Failed to create coworker.");
    });
  }, [createCoworker, navigate]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center">
      {error ? (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          <p className="text-muted-foreground text-sm">
            <T>Preparing your coworker builder...</T>
          </p>
        </div>
      )}
    </div>
  );
}
