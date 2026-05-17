import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import type { IntegrationType } from "../oauth/config";
import { db } from "@cmdclaw/db/client";
import {
  conversation,
  customIntegrationCredential,
  generation,
  coworker,
  coworkerRun,
  coworkerRunEvent,
  workspaceExecutorSource,
} from "@cmdclaw/db/schema";
import {
  normalizeCoworkerAllowedSkillSlugs,
  normalizeCoworkerToolAccessMode,
} from "../../lib/coworker-tool-policy";
import { getEnabledIntegrationTypes } from "../integrations/cli-env";
import {
  getRemoteIntegrationCredentials,
  type RemoteIntegrationSource,
} from "../integrations/remote-integrations";
import { logServerEvent } from "../utils/observability";
import { generationManager } from "./generation-manager";
import { generationInterruptService } from "./generation-interrupt-service";

type CoworkerFileAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

const ACTIVE_COWORKER_RUN_STATUSES = [
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
] as const;
const DISABLED_COWORKER_TRIGGER_TYPES = ["gmail.new_email"] as const;
const TERMINAL_GENERATION_STATUSES = [
  "completed",
  "cancelled",
  "error",
] as const;
const ORPHAN_RUN_GRACE_MS = 2 * 60 * 1000;
const COWORKER_PREPARING_TIMEOUT_MS = (() => {
  const seconds = Number(
    process.env.COWORKER_PREPARING_TIMEOUT_SECONDS ?? "300",
  );
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 5 * 60 * 1000;
  }
  return Math.floor(seconds * 1000);
})();

function mapGenerationStatusToCoworkerRunStatus(
  status: (typeof TERMINAL_GENERATION_STATUSES)[number],
): "completed" | "cancelled" | "error" {
  if (status === "completed") {
    return "completed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "error";
}

function isDisabledCoworkerTriggerType(triggerType: string): boolean {
  return DISABLED_COWORKER_TRIGGER_TYPES.includes(
    triggerType as (typeof DISABLED_COWORKER_TRIGGER_TYPES)[number],
  );
}

export function isDisabledCoworkerTriggerError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };

  return (
    maybeError.code === "BAD_REQUEST" &&
    maybeError.status === 400 &&
    typeof maybeError.message === "string" &&
    maybeError.message.includes("Coworker trigger type is disabled")
  );
}

export async function reconcileStaleCoworkerRunsForCoworker(
  coworkerId: string,
): Promise<void> {
  const candidateRuns = await db.query.coworkerRun.findMany({
    where: and(
      eq(coworkerRun.coworkerId, coworkerId),
      inArray(coworkerRun.status, [...ACTIVE_COWORKER_RUN_STATUSES]),
    ),
    with: {
      generation: {
        columns: {
          id: true,
          conversationId: true,
          status: true,
          startedAt: true,
          completedAt: true,
          contentParts: true,
          errorMessage: true,
        },
      },
    },
    limit: 20,
  });

  const updates = candidateRuns.map(async (run) => {
    const gen = run.generation;
    if (!gen) {
      const isLikelyOrphan =
        run.status === "running" &&
        Date.now() - run.startedAt.getTime() > ORPHAN_RUN_GRACE_MS;
      if (!isLikelyOrphan) {
        return;
      }

      await db
        .update(coworkerRun)
        .set({
          status: "error",
          finishedAt: run.finishedAt ?? new Date(),
          errorMessage:
            run.errorMessage ??
            "Coworker run failed before generation could start.",
        })
        .where(eq(coworkerRun.id, run.id));

      return;
    }

    if (
      !TERMINAL_GENERATION_STATUSES.includes(
        gen.status as (typeof TERMINAL_GENERATION_STATUSES)[number],
      )
    ) {
      const pendingInterrupt =
        await generationInterruptService.getPendingInterruptForGeneration(
          gen.id,
        );
      const isPreparingTimeout =
        run.status === "running" &&
        gen.status === "running" &&
        Date.now() - gen.startedAt.getTime() > COWORKER_PREPARING_TIMEOUT_MS &&
        (gen.contentParts?.length ?? 0) === 0 &&
        !pendingInterrupt;

      if (isPreparingTimeout) {
        const errorMessage = "Coworker run timed out while preparing agent.";

        await db
          .update(generation)
          .set({
            status: "error",
            completedAt: new Date(),
            errorMessage,
          })
          .where(eq(generation.id, gen.id));

        await db
          .update(conversation)
          .set({ generationStatus: "error" })
          .where(eq(conversation.id, gen.conversationId));

        await db
          .update(coworkerRun)
          .set({
            status: "error",
            finishedAt: run.finishedAt ?? new Date(),
            errorMessage,
          })
          .where(eq(coworkerRun.id, run.id));

        return;
      }

      return;
    }

    const mappedStatus = mapGenerationStatusToCoworkerRunStatus(
      gen.status as (typeof TERMINAL_GENERATION_STATUSES)[number],
    );

    await db
      .update(coworkerRun)
      .set({
        status: mappedStatus,
        finishedAt: run.finishedAt ?? gen.completedAt ?? new Date(),
        errorMessage: run.errorMessage ?? gen.errorMessage ?? null,
      })
      .where(eq(coworkerRun.id, run.id));
  });

  await Promise.all(updates);
}

export async function reconcileStaleCoworkerRunsForCoworkers(
  coworkerIds: string[],
): Promise<void> {
  const uniqueCoworkerIds = [
    ...new Set(coworkerIds.filter((id) => id.length > 0)),
  ];
  await Promise.all(
    uniqueCoworkerIds.map((coworkerId) =>
      reconcileStaleCoworkerRunsForCoworker(coworkerId),
    ),
  );
}

export async function triggerCoworkerRun(params: {
  coworkerId: string;
  triggerPayload: unknown;
  userId?: string;
  userRole?: string | null;
  fileAttachments?: CoworkerFileAttachment[];
  remoteIntegrationSource?: RemoteIntegrationSource;
}): Promise<{
  coworkerId: string;
  runId: string;
  generationId: string;
  conversationId: string;
}> {
  const wf = await db.query.coworker.findFirst({
    where: params.userId
      ? and(
          eq(coworker.id, params.coworkerId),
          eq(coworker.ownerId, params.userId),
        )
      : eq(coworker.id, params.coworkerId),
  });

  if (!wf) {
    throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
  }

  if (wf.status !== "on") {
    throw new ORPCError("BAD_REQUEST", { message: "Coworker is turned off" });
  }

  if (isDisabledCoworkerTriggerType(wf.triggerType)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Coworker trigger type is disabled: ${wf.triggerType}`,
    });
  }

  // Defensive reconciliation for runs that were left active while their generation already ended.
  // This avoids permanently blocking future triggers for the coworker.
  await reconcileStaleCoworkerRunsForCoworker(wf.id);

  const activeRun = await db.query.coworkerRun.findFirst({
    where: and(
      eq(coworkerRun.coworkerId, wf.id),
      inArray(coworkerRun.status, [...ACTIVE_COWORKER_RUN_STATUSES]),
    ),
    orderBy: (run, { desc }) => [desc(run.startedAt)],
  });

  if (params.userRole !== "admin" && activeRun) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Coworker already has an active run",
    });
  }

  const [run] = await db
    .insert(coworkerRun)
    .values({
      coworkerId: wf.id,
      ownerId: wf.ownerId,
      workspaceId: wf.workspaceId,
      status: "running",
      triggerPayload: params.triggerPayload,
    })
    .returning();

  await db.insert(coworkerRunEvent).values({
    coworkerRunId: run.id,
    type: "trigger",
    payload: params.triggerPayload ?? {},
  });

  const payloadText = JSON.stringify(params.triggerPayload ?? {}, null, 2);
  const coworkerSections = [
    wf.prompt?.trim() ? `## Coworker Instructions\n${wf.prompt}` : null,
    wf.promptDo?.trim() ? `## Do\n${wf.promptDo}` : null,
    wf.promptDont?.trim() ? `## Don't\n${wf.promptDont}` : null,
    `## Trigger Payload\n${payloadText}`,
  ].filter(Boolean);
  const userContent = coworkerSections.join("\n\n");

  const toolAccessMode = normalizeCoworkerToolAccessMode(
    wf.toolAccessMode,
    wf.allowedIntegrations,
  );
  let allowedIntegrations =
    toolAccessMode === "all"
      ? await getEnabledIntegrationTypes(wf.ownerId)
      : (wf.allowedIntegrations ?? []).filter(
          (value): value is IntegrationType => typeof value === "string",
        );
  const allowedCustomIntegrations =
    toolAccessMode === "all"
      ? (
          await db.query.customIntegrationCredential.findMany({
            where: and(
              eq(customIntegrationCredential.userId, wf.ownerId),
              eq(customIntegrationCredential.enabled, true),
            ),
            with: {
              customIntegration: {
                columns: {
                  slug: true,
                },
              },
            },
          })
        ).map((entry) => entry.customIntegration.slug)
      : Array.isArray(wf.allowedCustomIntegrations)
        ? wf.allowedCustomIntegrations.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
  const allowedExecutorSourceIds =
    toolAccessMode === "all"
      ? (
          await db.query.workspaceExecutorSource.findMany({
            where: and(
              eq(workspaceExecutorSource.workspaceId, wf.workspaceId ?? ""),
              eq(workspaceExecutorSource.enabled, true),
            ),
            columns: {
              id: true,
            },
          })
        ).map((entry) => entry.id)
      : Array.isArray(wf.allowedExecutorSourceIds)
        ? wf.allowedExecutorSourceIds.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
  const allowedSkillSlugs =
    toolAccessMode === "all"
      ? undefined
      : normalizeCoworkerAllowedSkillSlugs(wf.allowedSkillSlugs);
  let resolvedRemoteIntegrationSource: RemoteIntegrationSource | undefined;

  if (params.remoteIntegrationSource) {
    const remoteCredentials = await getRemoteIntegrationCredentials({
      targetEnv: params.remoteIntegrationSource.targetEnv,
      remoteUserId: params.remoteIntegrationSource.remoteUserId,
      integrationTypes: allowedIntegrations,
      requestedByUserId: params.remoteIntegrationSource.requestedByUserId,
      requestedByEmail: params.remoteIntegrationSource.requestedByEmail ?? null,
    });

    resolvedRemoteIntegrationSource = {
      ...params.remoteIntegrationSource,
      remoteUserEmail: remoteCredentials.remoteUserEmail,
    };

    if (toolAccessMode === "all") {
      allowedIntegrations = remoteCredentials.enabledIntegrations;
    }

    logServerEvent(
      "info",
      "COWORKER_REMOTE_INTEGRATION_SOURCE_SELECTED",
      {
        coworkerId: wf.id,
        coworkerRunId: run.id,
        targetEnv: resolvedRemoteIntegrationSource.targetEnv,
        remoteUserId: resolvedRemoteIntegrationSource.remoteUserId,
        remoteUserEmail:
          resolvedRemoteIntegrationSource.remoteUserEmail ?? null,
        allowedIntegrations: [...allowedIntegrations].toSorted(),
        attachedTokenEnvVarNames: Object.keys(
          remoteCredentials.tokens,
        ).toSorted(),
        actorUserId: resolvedRemoteIntegrationSource.requestedByUserId ?? null,
        actorUserEmail:
          resolvedRemoteIntegrationSource.requestedByEmail ?? null,
      },
      {
        source: "coworker-service",
        userId: wf.ownerId,
      },
    );

    await db.insert(coworkerRunEvent).values({
      coworkerRunId: run.id,
      type: "remote_integration_source",
      payload: {
        targetEnv: resolvedRemoteIntegrationSource.targetEnv,
        remoteUserId: resolvedRemoteIntegrationSource.remoteUserId,
        remoteUserEmail:
          resolvedRemoteIntegrationSource.remoteUserEmail ?? null,
        allowedIntegrations: [...allowedIntegrations].toSorted(),
        attachedTokenEnvVarNames: Object.keys(
          remoteCredentials.tokens,
        ).toSorted(),
        actorUserId: resolvedRemoteIntegrationSource.requestedByUserId ?? null,
        actorUserEmail:
          resolvedRemoteIntegrationSource.requestedByEmail ?? null,
      },
    });
  }

  let generationId: string;
  let conversationId: string;
  try {
    const startResult = await generationManager.startCoworkerGeneration({
      coworkerId: wf.id,
      coworkerRunId: run.id,
      content: userContent,
      model: wf.model,
      authSource: wf.authSource,
      userId: wf.ownerId,
      workspaceId: wf.workspaceId ?? null,
      autoApprove: wf.autoApprove,
      allowedIntegrations,
      allowedCustomIntegrations,
      allowedExecutorSourceIds,
      allowedSkillSlugs,
      fileAttachments: params.fileAttachments,
      remoteIntegrationSource: resolvedRemoteIntegrationSource,
    });

    generationId = startResult.generationId;
    conversationId = startResult.conversationId;

    await db
      .update(coworkerRun)
      .set({ generationId })
      .where(eq(coworkerRun.id, run.id));
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to start coworker generation";

    await db
      .update(coworkerRun)
      .set({
        status: "error",
        finishedAt: new Date(),
        errorMessage,
      })
      .where(eq(coworkerRun.id, run.id));

    await db.insert(coworkerRunEvent).values({
      coworkerRunId: run.id,
      type: "error",
      payload: { message: errorMessage, stage: "start_generation" },
    });

    throw error;
  }

  return {
    coworkerId: wf.id,
    runId: run.id,
    generationId: generationId!,
    conversationId: conversationId!,
  };
}
