import { db } from "@cmdclaw/db/client";
import { coworkerRun, generation } from "@cmdclaw/db/schema";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { logger } from "../../../utils/observability";
import { generationInterruptService } from "../../generation-interrupt-service";
import {
  generationLifecyclePolicy,
  isApprovalExpired,
  isAuthExpired,
  type GenerationCompletionReason,
} from "../../lifecycle-policy";
import type { FinalizeStaleGenerationsInput } from "../core/lifecycle-store";

const STALE_REAPER_RUNNING_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STALE_REAPER_AWAITING_APPROVAL_MAX_AGE_MS = 30 * 60 * 1000;
const STALE_REAPER_AWAITING_AUTH_MAX_AGE_MS = 60 * 60 * 1000;
const AGENT_PREPARING_TIMEOUT_MS = generationLifecyclePolicy.bootstrapTimeoutMs;

export type GenerationTimeoutKind = "approval" | "auth";

export type StaleGenerationReapSummary = {
  scanned: number;
  stale: number;
  finalizedRunningAsError: number;
  finalizedWaitingAsError: number;
};

export type GenerationMaintenanceDependencies = {
  abortAndEvictActiveGeneration(generationId: string): void;
  hasActiveGeneration(generationId: string): boolean;
  expireActiveGenerationTimeout(input: {
    generationId: string;
    kind: GenerationTimeoutKind;
    message: string;
    completionReason: GenerationCompletionReason;
  }): Promise<void>;
  finalizeDetachedGenerationError(input: {
    generationId: string;
    conversationId: string;
    runtimeId?: string;
    coworkerRunId?: string;
    message: string;
    completionReason: GenerationCompletionReason;
  }): Promise<void>;
  finalizeStaleGenerationsAsError(input: FinalizeStaleGenerationsInput): Promise<void>;
};

export class GenerationMaintenance {
  constructor(private readonly deps: GenerationMaintenanceDependencies) {}

  async processGenerationTimeout(generationId: string, kind: GenerationTimeoutKind): Promise<void> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return;
    }

    const now = new Date();
    const pendingInterrupt =
      await generationInterruptService.getPendingInterruptForGeneration(generationId);

    if (kind === "approval") {
      if (
        !pendingInterrupt ||
        pendingInterrupt.kind === "auth" ||
        genRecord.status !== "awaiting_approval"
      ) {
        return;
      }
      if (
        !isApprovalExpired(
          {
            requestedAt: pendingInterrupt.requestedAt,
            expiresAt: pendingInterrupt.expiresAt,
          },
          now,
        )
      ) {
        return;
      }
      await this.expireGenerationTimeout({
        generationId,
        conversationId: genRecord.conversationId,
        runtimeId: genRecord.runtimeId ?? undefined,
        interruptId: pendingInterrupt.id,
        kind,
        message: "Approval request expired before the run could continue.",
        completionReason: "approval_timeout",
      });
      return;
    }

    if (
      !pendingInterrupt ||
      pendingInterrupt.kind !== "auth" ||
      genRecord.status !== "awaiting_auth"
    ) {
      return;
    }
    if (
      !isAuthExpired(
        {
          requestedAt: pendingInterrupt.requestedAt,
          expiresAt: pendingInterrupt.expiresAt,
        },
        now,
      )
    ) {
      return;
    }
    await this.expireGenerationTimeout({
      generationId,
      conversationId: genRecord.conversationId,
      runtimeId: genRecord.runtimeId ?? undefined,
      interruptId: pendingInterrupt.id,
      kind,
      message: "Authentication request expired before the run could continue.",
      completionReason: "auth_timeout",
    });
  }

  async processPreparingStuckCheck(generationId: string): Promise<void> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: {
        conversation: {
          columns: {
            id: true,
            userId: true,
            type: true,
          },
        },
      },
    });
    if (!genRecord) {
      return;
    }
    if (genRecord.status !== "running" || genRecord.sandboxId || genRecord.completedAt) {
      return;
    }

    const elapsedMs = Date.now() - genRecord.startedAt.getTime();
    if (elapsedMs < AGENT_PREPARING_TIMEOUT_MS) {
      return;
    }

    const userId = genRecord.conversation.userId ?? undefined;
    const details = {
      generationId: genRecord.id,
      conversationId: genRecord.conversation.id,
      userId,
      elapsedMs,
      thresholdMs: AGENT_PREPARING_TIMEOUT_MS,
      status: genRecord.status,
    };

    logger.warn({
      event: "GENERATION_PREPARING_STUCK_DETECTED",
      ...{
        source: "generation-maintenance",
        generationId: genRecord.id,
        conversationId: genRecord.conversation.id,
        userId,
      },
      ...details,
    });

    if (!this.deps.hasActiveGeneration(generationId)) {
      const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
        where: eq(coworkerRun.generationId, generationId),
        columns: { id: true },
      });
      await this.deps.finalizeDetachedGenerationError({
        generationId: genRecord.id,
        conversationId: genRecord.conversation.id,
        runtimeId: genRecord.runtimeId ?? undefined,
        coworkerRunId: linkedCoworkerRun?.id,
        message: "Agent preparation timed out before the runtime became ready.",
        completionReason: "bootstrap_timeout",
      });
      return;
    }

    const pushUrl = process.env.KUMA_PUSH_URL?.trim();
    if (!pushUrl) {
      return;
    }

    const monitorUrl = new URL(pushUrl);
    monitorUrl.searchParams.set("status", "down");
    monitorUrl.searchParams.set(
      "msg",
      `preparing agent timeout generation=${genRecord.id} conversation=${genRecord.conversation.id} user=${userId ?? "unknown"} elapsedMs=${elapsedMs}`,
    );
    monitorUrl.searchParams.set("ping", String(Math.max(1, Math.round(elapsedMs))));

    try {
      const response = await fetch(monitorUrl.toString(), { method: "GET" });
      if (!response.ok) {
        throw new Error(`Kuma push failed (${response.status})`);
      }
      logger.warn({
        event: "GENERATION_PREPARING_STUCK_KUMA_PUSHED",
        ...{
          source: "generation-maintenance",
          generationId: genRecord.id,
          conversationId: genRecord.conversation.id,
          userId,
        },
        ...details,
      });
    } catch (error) {
      logger.error({
        event: "GENERATION_PREPARING_STUCK_KUMA_PUSH_FAILED",
        ...{
          source: "generation-maintenance",
          generationId: genRecord.id,
          conversationId: genRecord.conversation.id,
          userId,
        },
        ...{
          ...details,
          error: formatErrorMessage(error),
        },
      });
    }
  }

  async reapStaleGenerations(): Promise<StaleGenerationReapSummary> {
    const candidates = await db.query.generation.findMany({
      where: and(
        isNull(generation.completedAt),
        inArray(generation.status, ["running", "awaiting_approval", "awaiting_auth"]),
        lt(
          generation.startedAt,
          new Date(
            Date.now() -
              Math.min(
                STALE_REAPER_RUNNING_MAX_AGE_MS,
                STALE_REAPER_AWAITING_APPROVAL_MAX_AGE_MS,
                STALE_REAPER_AWAITING_AUTH_MAX_AGE_MS,
              ),
          ),
        ),
      ),
      columns: {
        id: true,
        status: true,
        startedAt: true,
      },
    });

    const nowMs = Date.now();
    const staleRows = candidates.filter((row) => {
      const ageMs = nowMs - row.startedAt.getTime();
      if (row.status !== "running") {
        if (row.status === "awaiting_approval") {
          return ageMs > STALE_REAPER_AWAITING_APPROVAL_MAX_AGE_MS;
        }
        if (row.status === "awaiting_auth") {
          return ageMs > STALE_REAPER_AWAITING_AUTH_MAX_AGE_MS;
        }
        return false;
      }
      return ageMs > STALE_REAPER_RUNNING_MAX_AGE_MS;
    });

    if (staleRows.length === 0) {
      return {
        scanned: candidates.length,
        stale: 0,
        finalizedRunningAsError: 0,
        finalizedWaitingAsError: 0,
      };
    }

    const staleRunningIds = staleRows
      .filter((row) => row.status === "running")
      .map((row) => row.id);
    const staleApprovalIds = staleRows
      .filter((row) => row.status === "awaiting_approval")
      .map((row) => row.id);
    const staleAuthIds = staleRows
      .filter((row) => row.status === "awaiting_auth")
      .map((row) => row.id);
    const staleWaitingIds = [...staleApprovalIds, ...staleAuthIds];

    const completedAt = new Date();
    const staleRunningMessage =
      "Generation was marked as stale by the worker reaper after exceeding max running age.";
    const staleApprovalMessage = "Approval request expired before the run could continue.";
    const staleAuthMessage = "Authentication request expired before the run could continue.";

    if (staleRunningIds.length > 0) {
      await Promise.all(
        staleRunningIds.map((id) => generationInterruptService.cancelInterruptsForGeneration(id)),
      );
    }

    if (staleWaitingIds.length > 0) {
      for (const id of staleWaitingIds) {
        const pendingInterrupt =
          await generationInterruptService.getPendingInterruptForGeneration(id);
        if (pendingInterrupt) {
          await generationInterruptService.resolveInterrupt({
            interruptId: pendingInterrupt.id,
            status: "expired",
          });
        }
      }
      await Promise.all(
        staleWaitingIds.map((id) => generationInterruptService.cancelInterruptsForGeneration(id)),
      );
    }

    await this.deps.finalizeStaleGenerationsAsError({
      completedAt,
      running: {
        ids: staleRunningIds,
        message: staleRunningMessage,
      },
      approval: {
        ids: staleApprovalIds,
        message: staleApprovalMessage,
      },
      auth: {
        ids: staleAuthIds,
        message: staleAuthMessage,
      },
    });

    for (const row of staleRows) {
      this.deps.abortAndEvictActiveGeneration(row.id);
    }

    return {
      scanned: candidates.length,
      stale: staleRows.length,
      finalizedRunningAsError: staleRunningIds.length,
      finalizedWaitingAsError: staleWaitingIds.length,
    };
  }

  private async expireGenerationTimeout(input: {
    generationId: string;
    conversationId: string;
    runtimeId?: string;
    interruptId: string;
    kind: GenerationTimeoutKind;
    message: string;
    completionReason: GenerationCompletionReason;
  }): Promise<void> {
    const linkedCoworkerRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, input.generationId),
      columns: { id: true },
    });

    if (this.deps.hasActiveGeneration(input.generationId)) {
      await this.deps.expireActiveGenerationTimeout({
        generationId: input.generationId,
        kind: input.kind,
        message: input.message,
        completionReason: input.completionReason,
      });
      return;
    }

    await generationInterruptService.resolveInterrupt({
      interruptId: input.interruptId,
      status: "expired",
    });
    await this.deps.finalizeDetachedGenerationError({
      generationId: input.generationId,
      conversationId: input.conversationId,
      runtimeId: input.runtimeId,
      coworkerRunId: linkedCoworkerRun?.id,
      message: input.message,
      completionReason: input.completionReason,
    });
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
