"use client";

import type { TemplateCatalogTemplate } from "@cmdclaw/db/template-catalog";
import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@cmdclaw/core/lib/chat-model-defaults";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCoworkerEditHref } from "@/lib/coworker-routes";
import { normalizeGenerationError } from "@/lib/generation-errors";
import { COWORKER_AVAILABLE_INTEGRATION_TYPES } from "@/lib/integration-icons";
import { buildTemplateDeployPayload } from "@/lib/template-deploy";
import { client } from "@/orpc/client";
import { useCreateCoworker } from "@/orpc/hooks";

const DEFAULT_COWORKER_BUILDER_MODEL = DEFAULT_CONNECTED_CHATGPT_MODEL;

export function TemplateDeployPage({ template }: { template: TemplateCatalogTemplate | null }) {
  const createCoworker = useCreateCoworker();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    if (!template) {
      setError("Template not found.");
      return;
    }

    startedRef.current = true;
    let cancelled = false;

    const deploy = async () => {
      try {
        const response = await fetch("/api/prompts/template-deploy");
        if (!response.ok) {
          throw new Error("Failed to load template deploy prompt.");
        }

        const promptTemplate = await response.text();
        const deployPayload = buildTemplateDeployPayload(template, promptTemplate);
        const result = await createCoworker.mutateAsync({
          ...deployPayload.createPayload,
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
            content: deployPayload.initialBuilderMessage,
            model: DEFAULT_COWORKER_BUILDER_MODEL,
            authSource: "shared",
            autoApprove: true,
          });
        } catch (builderError) {
          console.error("Failed to start coworker builder generation:", builderError);
          if (cancelled) {
            return;
          }
          startedRef.current = false;
          setError(normalizeGenerationError(builderError, "start_rpc").message);
          return;
        }

        window.location.assign(getCoworkerEditHref(result));
      } catch (deployError) {
        console.error("Failed to deploy coworker from template:", deployError);
        if (cancelled) {
          return;
        }
        startedRef.current = false;
        setError("Failed to deploy coworker. Please try again.");
      }
    };

    void deploy();

    return () => {
      cancelled = true;
    };
  }, [createCoworker, template]);

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] w-full items-center justify-center">
      {error ? (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      ) : (
        <div className="text-muted-foreground flex items-center gap-3 text-sm">
          <Loader2 className="size-4 animate-spin" />
          <span>Deploying coworker template…</span>
        </div>
      )}
    </div>
  );
}
