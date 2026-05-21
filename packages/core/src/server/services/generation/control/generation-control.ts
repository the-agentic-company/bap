import { db } from "@cmdclaw/db/client";
import {
  coworker,
  coworkerRun,
  generation,
  type ContentPart,
  type GenerationExecutionPolicy,
  type PendingApproval,
} from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import type { IntegrationType } from "../../../oauth/config";
import { normalizeCoworkerAllowedSkillSlugs } from "../../../../lib/coworker-tool-policy";
import {
  remoteIntegrationSourceSchema,
  type RemoteIntegrationSource,
} from "../../../integrations/remote-integrations";
import { getSandboxSlotManager } from "../../sandbox-slot-manager";
import {
  generationInterruptService,
  type GenerationInterruptRecord,
} from "../../generation-interrupt-service";
import { generationLifecyclePolicy } from "../../lifecycle-policy";
import type { GenerationLifecycleStore } from "../core/lifecycle-store";
import type {
  GenerationContext,
  GenerationStatus,
  GenerationRunMode,
} from "../types";
import type { UserFileAttachment } from "../queue/conversation-turn-queue";
import type { GenerationRunQueue } from "../queue/generation-run-queue";

const APPROVAL_TIMEOUT_MS = generationLifecyclePolicy.approvalTimeoutMs;
const AUTH_TIMEOUT_MS = generationLifecyclePolicy.authTimeoutMs;

function computeExpiryIso(timeoutMs: number): string {
  return new Date(Date.now() + timeoutMs).toISOString();
}

export function getExecutionPolicyFromRecord(
  genRecord: typeof generation.$inferSelect,
  fallbackAutoApprove: boolean,
): {
  allowedIntegrations?: IntegrationType[];
  allowedCustomIntegrations?: string[];
  allowedExecutorSourceIds?: string[];
  allowedSkillSlugs?: string[];
  remoteIntegrationSource?: RemoteIntegrationSource;
  autoApprove?: boolean;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  selectedPlatformSkillSlugs?: string[];
  allowSnapshotRestoreOnRun?: boolean;
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
  queuedFileAttachments?: UserFileAttachment[];
} {
  const policy =
    (genRecord.executionPolicy as
      | GenerationExecutionPolicy
      | null
      | undefined) ?? undefined;
  const allowedIntegrations = Array.isArray(policy?.allowedIntegrations)
    ? (policy.allowedIntegrations.filter(
        (entry): entry is IntegrationType => typeof entry === "string",
      ) as IntegrationType[])
    : undefined;
  const remoteIntegrationSource = remoteIntegrationSourceSchema.safeParse(
    policy?.remoteIntegrationSource,
  );
  return {
    allowedIntegrations,
    allowedCustomIntegrations: policy?.allowedCustomIntegrations,
    allowedExecutorSourceIds: policy?.allowedExecutorSourceIds,
    allowedSkillSlugs: normalizeCoworkerAllowedSkillSlugs(
      policy?.allowedSkillSlugs,
    ),
    remoteIntegrationSource: remoteIntegrationSource.success
      ? remoteIntegrationSource.data
      : undefined,
    autoApprove: policy?.autoApprove ?? fallbackAutoApprove,
    sandboxProvider:
      policy?.sandboxProvider === "e2b" ||
      policy?.sandboxProvider === "daytona" ||
      policy?.sandboxProvider === "docker"
        ? policy.sandboxProvider
        : undefined,
    selectedPlatformSkillSlugs: Array.isArray(
      policy?.selectedPlatformSkillSlugs,
    )
      ? policy.selectedPlatformSkillSlugs.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : undefined,
    allowSnapshotRestoreOnRun: policy?.allowSnapshotRestoreOnRun ?? true,
    debugRunDeadlineMs: policy?.debugRunDeadlineMs,
    debugApprovalHotWaitMs: policy?.debugApprovalHotWaitMs,
    queuedFileAttachments: Array.isArray(policy?.queuedFileAttachments)
      ? policy.queuedFileAttachments.filter(
          (entry): entry is UserFileAttachment =>
            !!entry &&
            typeof entry === "object" &&
            typeof entry.name === "string" &&
            typeof entry.mimeType === "string" &&
            typeof entry.dataUrl === "string",
        )
      : undefined,
  };
}

type GenerationControlDependencies = {
  activeGenerations: Map<string, GenerationContext>;
  lifecycleStore: GenerationLifecycleStore;
  generationRunQueue: GenerationRunQueue;
  releaseSandboxSlotLease(ctx: GenerationContext): Promise<void>;
  enqueueGenerationTimeout(
    generationId: string,
    kind: "approval" | "auth",
    expiresAtIso: string,
  ): Promise<void>;
};

export class GenerationControl {
  constructor(private readonly deps: GenerationControlDependencies) {}

  async cancelGeneration(
    generationId: string,
    userId: string,
  ): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
      columns: {
        id: true,
        status: true,
      },
    });
    if (!genRecord) {
      return false;
    }

    if (genRecord.conversation.userId !== userId) {
      throw new Error("Access denied");
    }

    if (
      genRecord.status === "completed" ||
      genRecord.status === "cancelled" ||
      genRecord.status === "error"
    ) {
      return true;
    }

    await this.deps.lifecycleStore.requestCancellation({
      generationId,
      userId,
    });
    await getSandboxSlotManager().clearPendingRequest(generationId);

    const ctx = this.deps.activeGenerations.get(generationId);
    if (ctx) {
      await this.deps.releaseSandboxSlotLease(ctx);
      ctx.abortController.abort();
    }

    return true;
  }

  async resumeGeneration(
    generationId: string,
    userId: string,
  ): Promise<boolean> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
      with: { conversation: true },
    });
    if (!genRecord) {
      return false;
    }
    if (
      !genRecord.conversation.userId ||
      genRecord.conversation.userId !== userId
    ) {
      throw new Error("Access denied");
    }
    if (
      genRecord.status === "completed" ||
      genRecord.status === "cancelled" ||
      genRecord.status === "error"
    ) {
      return false;
    }

    let pendingInterrupt =
      await generationInterruptService.getPendingInterruptForGeneration(
        generationId,
      );
    if (pendingInterrupt) {
      pendingInterrupt =
        (await generationInterruptService.refreshInterruptExpiry(
          pendingInterrupt.id,
          new Date(
            pendingInterrupt.kind === "auth"
              ? computeExpiryIso(AUTH_TIMEOUT_MS)
              : computeExpiryIso(APPROVAL_TIMEOUT_MS),
          ),
        )) ?? pendingInterrupt;
    }
    const nextStatus: GenerationStatus = pendingInterrupt
      ? pendingInterrupt.kind === "auth"
        ? "awaiting_auth"
        : "awaiting_approval"
      : "running";
    let nextExecutionPolicy = getExecutionPolicyFromRecord(
      genRecord,
      genRecord.conversation.autoApprove,
    );
    if (genRecord.status === "paused") {
      nextExecutionPolicy = {
        ...nextExecutionPolicy,
        allowSnapshotRestoreOnRun: true,
      };
    }

    const linkedRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, generationId),
      columns: { id: true },
    });
    await this.deps.lifecycleStore.resumeGenerationRequest({
      generationId,
      conversationId: genRecord.conversationId,
      coworkerRunId: linkedRun?.id,
      status: nextStatus,
      executionPolicy: nextExecutionPolicy,
    });

    const runType: "chat" | "coworker" = linkedRun ? "coworker" : "chat";
    await this.enqueuePendingInterruptTimeout(generationId, pendingInterrupt);
    await this.deps.generationRunQueue.enqueueGenerationRun(
      generationId,
      runType,
    );
    return true;
  }

  async getAllowedIntegrationsForGeneration(
    generationId: string,
  ): Promise<IntegrationType[] | null> {
    const linkedRun = await db.query.coworkerRun.findFirst({
      where: eq(coworkerRun.generationId, generationId),
      columns: { coworkerId: true },
    });
    if (!linkedRun) {
      return null;
    }

    const wf = await db.query.coworker.findFirst({
      where: eq(coworker.id, linkedRun.coworkerId),
      columns: { allowedIntegrations: true },
    });

    return (wf?.allowedIntegrations as IntegrationType[] | undefined) ?? null;
  }

  async getGenerationStatus(generationId: string): Promise<{
    status: GenerationStatus;
    contentParts: ContentPart[];
    pendingApproval: PendingApproval | null;
    usage: { inputTokens: number; outputTokens: number };
  } | null> {
    const genRecord = await db.query.generation.findFirst({
      where: eq(generation.id, generationId),
    });

    if (!genRecord) {
      return null;
    }

    const pendingInterrupt =
      await generationInterruptService.getPendingInterruptForGeneration(
        generationId,
      );
    const pendingApproval =
      pendingInterrupt && pendingInterrupt.kind !== "auth"
        ? this.projectPendingApproval(pendingInterrupt)
        : null;

    return {
      status: genRecord.status as GenerationStatus,
      contentParts: genRecord.contentParts ?? [],
      pendingApproval,
      usage: {
        inputTokens: genRecord.inputTokens,
        outputTokens: genRecord.outputTokens,
      },
    };
  }

  private async enqueuePendingInterruptTimeout(
    generationId: string,
    pendingInterrupt: GenerationInterruptRecord | null,
  ): Promise<void> {
    if (pendingInterrupt?.kind !== "auth" && pendingInterrupt?.expiresAt) {
      await this.deps.enqueueGenerationTimeout(
        generationId,
        "approval",
        pendingInterrupt.expiresAt.toISOString(),
      );
    }
    if (pendingInterrupt?.kind === "auth" && pendingInterrupt.expiresAt) {
      await this.deps.enqueueGenerationTimeout(
        generationId,
        "auth",
        pendingInterrupt.expiresAt.toISOString(),
      );
    }
  }

  private projectPendingApproval(
    interrupt: GenerationInterruptRecord,
  ): PendingApproval {
    return {
      toolUseId: interrupt.providerToolUseId,
      toolName: interrupt.display.title,
      toolInput: interrupt.display.toolInput ?? {},
      requestedAt: interrupt.requestedAt.toISOString(),
      expiresAt: interrupt.expiresAt?.toISOString(),
      integration: interrupt.display.integration ?? "cmdclaw",
      operation: interrupt.display.operation ?? "unknown",
      command: interrupt.display.command,
    };
  }
}
