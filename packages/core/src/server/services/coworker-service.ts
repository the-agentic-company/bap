import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import type { IntegrationType } from "../oauth/config";
import { db } from "@cmdclaw/db/client";
import {
  conversation,
  customIntegrationCredential,
  generation,
  message,
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
import { sanitizeJsonForPostgres, sanitizePostgresText } from "../utils/postgres-json";
import { generationManager } from "./generation-manager";
import { generationInterruptService } from "./generation-interrupt-service";
import { emitPreGenerationCoworkerRunFailureSloEvent } from "./slo-journey";

type CoworkerFileAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

type CoworkerRecord = typeof coworker.$inferSelect;
type CoworkerRunRecord = typeof coworkerRun.$inferSelect;

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

function normalizeTriggerPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function getPayloadSource(payload: Record<string, unknown>): string {
  return typeof payload.source === "string" && payload.source.trim()
    ? payload.source
    : Object.keys(payload).length === 0
      ? "manual"
      : "trigger";
}

function normalizeTrustedUserInput(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeUserInputPrompt(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeFileAttachments(value: unknown): CoworkerFileAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((attachment): attachment is CoworkerFileAttachment => {
    if (!attachment || typeof attachment !== "object") {
      return false;
    }

    const candidate = attachment as Record<string, unknown>;
    return (
      typeof candidate.name === "string" &&
      typeof candidate.mimeType === "string" &&
      typeof candidate.dataUrl === "string"
    );
  });
}

function buildUserInputRunPayload(params: {
  triggerPayload: Record<string, unknown>;
  userInputPrompt: string | null;
  triggerFileAttachments?: CoworkerFileAttachment[];
  trustedUserInput?: string | null;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    source: getPayloadSource(params.triggerPayload),
    trigger: params.triggerPayload,
  };
  if (params.userInputPrompt) {
    payload.userInputPrompt = params.userInputPrompt;
  }
  if (params.triggerFileAttachments && params.triggerFileAttachments.length > 0) {
    payload.triggerFileAttachments = params.triggerFileAttachments;
  }
  if (params.trustedUserInput) {
    payload.userInput = params.trustedUserInput;
  }
  return payload;
}

function buildCoworkerModelInput(params: {
  triggerPayload: unknown;
  trustedUserInput?: string | null;
}): string {
  const sections = [
    "## Trigger Payload",
    JSON.stringify(sanitizeJsonForPostgres(params.triggerPayload ?? {}), null, 2),
  ];
  if (params.trustedUserInput) {
    sections.push("", "## User Input", params.trustedUserInput);
  }
  return sections.join("\n");
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

async function resolveCoworkerExecutionOptions(params: {
  wf: CoworkerRecord;
  run: CoworkerRunRecord;
  remoteIntegrationSource?: RemoteIntegrationSource;
  autoApprove?: boolean;
  syntheticKind?: "slo_replay";
}): Promise<{
  allowedIntegrations: IntegrationType[];
  allowedCustomIntegrations: string[];
  allowedExecutorSourceIds: string[];
  allowedSkillSlugs?: string[];
  resolvedRemoteIntegrationSource?: RemoteIntegrationSource;
}> {
  const { wf, run } = params;
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

  return {
    allowedIntegrations,
    allowedCustomIntegrations,
    allowedExecutorSourceIds,
    allowedSkillSlugs,
    resolvedRemoteIntegrationSource,
  };
}

async function startGenerationForCoworkerRun(params: {
  wf: CoworkerRecord;
  run: CoworkerRunRecord;
  content: string;
  conversationId?: string;
  existingUserMessageId?: string;
  fileAttachments?: CoworkerFileAttachment[];
  remoteIntegrationSource?: RemoteIntegrationSource;
  autoApprove?: boolean;
  debugRunDeadlineMs?: number;
  syntheticKind?: "slo_replay";
}): Promise<{ generationId: string; conversationId: string }> {
  const options = await resolveCoworkerExecutionOptions({
    wf: params.wf,
    run: params.run,
    remoteIntegrationSource: params.remoteIntegrationSource,
  });

  const startResult = await generationManager.startCoworkerGeneration({
    coworkerId: params.wf.id,
    coworkerRunId: params.run.id,
    conversationId: params.conversationId,
    existingUserMessageId: params.existingUserMessageId,
    content: params.content,
    model: params.wf.model,
    authSource: params.wf.authSource,
    userId: params.wf.ownerId,
    workspaceId: params.wf.workspaceId ?? null,
    autoApprove: params.autoApprove ?? params.wf.autoApprove,
    allowedIntegrations: options.allowedIntegrations,
    allowedCustomIntegrations: options.allowedCustomIntegrations,
    allowedExecutorSourceIds: options.allowedExecutorSourceIds,
    allowedSkillSlugs: options.allowedSkillSlugs,
    fileAttachments: params.fileAttachments,
    remoteIntegrationSource: options.resolvedRemoteIntegrationSource,
    debugRunDeadlineMs: params.debugRunDeadlineMs,
    syntheticKind: params.syntheticKind,
  });

  await db
    .update(coworkerRun)
    .set({
      status: "running",
      generationId: startResult.generationId,
      conversationId: startResult.conversationId,
    })
    .where(eq(coworkerRun.id, params.run.id));

  return startResult;
}

export async function triggerCoworkerRun(params: {
  coworkerId: string;
  triggerPayload: unknown;
  trustedUserInput?: string | null;
  userId?: string;
  userRole?: string | null;
  fileAttachments?: CoworkerFileAttachment[];
  remoteIntegrationSource?: RemoteIntegrationSource;
  autoApprove?: boolean;
  debugRunDeadlineMs?: number;
  syntheticKind?: "slo_replay";
}): Promise<{
  coworkerId: string;
  runId: string;
  generationId: string | null;
  conversationId: string;
}> {
  const triggerPayload = normalizeTriggerPayload(params.triggerPayload);
  const trustedUserInput = normalizeTrustedUserInput(params.trustedUserInput);
  const isManualRun =
    Object.keys(triggerPayload).length === 0 ||
    triggerPayload.source === "manual";

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

  if (wf.status !== "on" && !isManualRun) {
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

  const userInputPrompt = normalizeUserInputPrompt(wf.userInputPrompt);
  if (wf.requiresUserInput && !userInputPrompt) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Coworker requires user input but has no user input prompt",
    });
  }

  if (wf.requiresUserInput && !trustedUserInput) {
    const pendingPayload = buildUserInputRunPayload({
      triggerPayload,
      userInputPrompt,
      triggerFileAttachments: params.fileAttachments,
    });
    const [conv] = await db
      .insert(conversation)
      .values({
        userId: wf.ownerId,
        workspaceId: wf.workspaceId ?? null,
        title: userInputPrompt ?? "Needs your input",
        type: "coworker",
        model: wf.model,
        authSource: wf.authSource,
        autoApprove: wf.autoApprove,
      })
      .returning();
    const [run] = await db
      .insert(coworkerRun)
      .values({
        coworkerId: wf.id,
        ownerId: wf.ownerId,
        workspaceId: wf.workspaceId,
        status: "needs_user_input",
        triggerPayload: sanitizeJsonForPostgres(pendingPayload),
        conversationId: conv.id,
        syntheticKind: params.syntheticKind,
      })
      .returning();

    await db.insert(message).values({
      conversationId: conv.id,
      role: "assistant",
      content: userInputPrompt ?? "What input should I use before I start?",
    });
    await db.insert(coworkerRunEvent).values({
      coworkerRunId: run.id,
      type: "trigger",
      payload: sanitizeJsonForPostgres(pendingPayload),
    });

    return {
      coworkerId: wf.id,
      runId: run.id,
      generationId: null,
      conversationId: conv.id,
    };
  }

  const runPayload = trustedUserInput
    ? buildUserInputRunPayload({
        triggerPayload,
        userInputPrompt,
        triggerFileAttachments: params.fileAttachments,
        trustedUserInput,
      })
    : params.triggerPayload;
  const [run] = await db
    .insert(coworkerRun)
    .values({
      coworkerId: wf.id,
      ownerId: wf.ownerId,
      workspaceId: wf.workspaceId,
      status: "running",
      triggerPayload: sanitizeJsonForPostgres(runPayload),
      syntheticKind: params.syntheticKind,
    })
    .returning();

  await db.insert(coworkerRunEvent).values({
    coworkerRunId: run.id,
    type: "trigger",
    payload: sanitizeJsonForPostgres(runPayload ?? {}),
  });

  let generationId: string;
  let conversationId: string;
  try {
    const startResult = await startGenerationForCoworkerRun({
      wf,
      run,
      content: buildCoworkerModelInput({
        triggerPayload: runPayload,
        trustedUserInput,
      }),
      fileAttachments: params.fileAttachments,
      remoteIntegrationSource: params.remoteIntegrationSource,
      autoApprove: params.autoApprove,
      debugRunDeadlineMs: params.debugRunDeadlineMs,
      syntheticKind: params.syntheticKind,
    });

    generationId = startResult.generationId;
    conversationId = startResult.conversationId;
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? sanitizePostgresText(error.message)
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

    try {
      await emitPreGenerationCoworkerRunFailureSloEvent({
        coworkerRunId: run.id,
        coworkerId: wf.id,
        ownerId: wf.ownerId,
        workspaceId: wf.workspaceId,
        syntheticKind: params.syntheticKind,
        normalizedErrorCode: "start_generation_failed",
      });
    } catch (sloError) {
      console.error("[CoworkerService] Failed to emit pre-Generation Coworker Run SLO event", {
        coworkerRunId: run.id,
        error: sloError instanceof Error ? sloError.message : String(sloError),
      });
    }

    throw error;
  }

  return {
    coworkerId: wf.id,
    runId: run.id,
    generationId: generationId!,
    conversationId: conversationId!,
  };
}

export async function startPendingCoworkerRun(params: {
  conversationId: string;
  userId: string;
  userInput: string;
  fileAttachments?: CoworkerFileAttachment[];
}): Promise<{
  coworkerId: string;
  runId: string;
  generationId: string;
  conversationId: string;
}> {
  const trustedUserInput = normalizeTrustedUserInput(params.userInput);
  const hasAttachments = (params.fileAttachments?.length ?? 0) > 0;
  if (!trustedUserInput && !hasAttachments) {
    throw new ORPCError("BAD_REQUEST", { message: "User input is required" });
  }

  const pendingRun = await db.query.coworkerRun.findFirst({
    where: and(
      eq(coworkerRun.conversationId, params.conversationId),
      eq(coworkerRun.ownerId, params.userId),
      eq(coworkerRun.status, "needs_user_input"),
    ),
    with: {
      coworker: true,
    },
  });

  if (!pendingRun?.coworker) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This coworker has already started or is no longer waiting for input.",
    });
  }

  const originalPayload = normalizeTriggerPayload(pendingRun.triggerPayload);
  const triggerPayload = normalizeTriggerPayload(originalPayload.trigger);
  const userInputPrompt = normalizeUserInputPrompt(originalPayload.userInputPrompt);
  const triggerFileAttachments = normalizeFileAttachments(originalPayload.triggerFileAttachments);
  const fileAttachments = [...triggerFileAttachments, ...(params.fileAttachments ?? [])];
  const runPayload = buildUserInputRunPayload({
    triggerPayload,
    userInputPrompt,
    triggerFileAttachments,
    trustedUserInput,
  });

  const [claimedRun] = await db
    .update(coworkerRun)
    .set({
      status: "running",
      triggerPayload: sanitizeJsonForPostgres(runPayload),
    })
    .where(
      and(
        eq(coworkerRun.id, pendingRun.id),
        eq(coworkerRun.status, "needs_user_input"),
      ),
    )
    .returning();

  if (!claimedRun) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This coworker has already started.",
    });
  }

  const [userMessage] = await db
    .insert(message)
    .values({
      conversationId: params.conversationId,
      role: "user",
      content: trustedUserInput ?? "",
    })
    .returning({ id: message.id });

  await db.insert(coworkerRunEvent).values({
    coworkerRunId: pendingRun.id,
    type: "user_input",
    payload: sanitizeJsonForPostgres(runPayload),
  });

  try {
    const startResult = await startGenerationForCoworkerRun({
      wf: pendingRun.coworker,
      run: claimedRun,
      conversationId: params.conversationId,
      existingUserMessageId: userMessage.id,
      content: buildCoworkerModelInput({
        triggerPayload: runPayload,
        trustedUserInput,
      }),
      fileAttachments,
    });

    return {
      coworkerId: pendingRun.coworker.id,
      runId: pendingRun.id,
      generationId: startResult.generationId,
      conversationId: startResult.conversationId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? sanitizePostgresText(error.message)
        : "Failed to start coworker generation";

    await db
      .update(coworkerRun)
      .set({
        status: "error",
        finishedAt: new Date(),
        errorMessage,
      })
      .where(eq(coworkerRun.id, pendingRun.id));

    await db.insert(coworkerRunEvent).values({
      coworkerRunId: pendingRun.id,
      type: "error",
      payload: { message: errorMessage, stage: "start_pending_generation" },
    });

    throw error;
  }
}
