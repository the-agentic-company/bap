import { db } from "@bap/db/client";
import {
  coworker,
  coworkerRun,
  generation,
  type ContentPart,
  type GenerationExecutionPolicy,
  type PendingApproval,
} from "@bap/db/schema";
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
import type { GenerationLifecycleStore } from "../core/lifecycle-store";
import type { GenerationContext, GenerationStatus, GenerationRunMode } from "../types";
import { isUserFileAttachment, type UserFileAttachment } from "../attachments";

export function getExecutionPolicyFromRecord(
  genRecord: typeof generation.$inferSelect,
  fallbackAutoApprove: boolean,
): {
  allowedIntegrations?: IntegrationType[];
  allowedCustomIntegrations?: string[];
  allowedWorkspaceMcpServerIds?: string[];
  allowedSkillSlugs?: string[];
  remoteIntegrationSource?: RemoteIntegrationSource;
  autoApprove?: boolean;
  sandboxProvider?: "e2b" | "daytona" | "docker";
  selectedPlatformSkillSlugs?: string[];
  allowSnapshotRestoreOnRun?: boolean;
  debugRunDeadlineMs?: number;
  debugApprovalHotWaitMs?: number;
  debugRuntimeNoProgressTimeoutMs?: number;
  debugForceRuntimeNoProgressAfterPrompt?: boolean;
  queuedFileAttachments?: UserFileAttachment[];
  queuedUserMessageContent?: string;
} {
  const policy =
    (genRecord.executionPolicy as GenerationExecutionPolicy | null | undefined) ?? undefined;
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
    allowedWorkspaceMcpServerIds: policy?.allowedWorkspaceMcpServerIds,
    // Preserve the difference between no per-Generation override and an
    // explicit empty override. The runner uses undefined to inherit the
    // Coworker's configured skill policy on follow-up turns.
    allowedSkillSlugs: Array.isArray(policy?.allowedSkillSlugs)
      ? normalizeCoworkerAllowedSkillSlugs(policy.allowedSkillSlugs)
      : undefined,
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
    selectedPlatformSkillSlugs: Array.isArray(policy?.selectedPlatformSkillSlugs)
      ? policy.selectedPlatformSkillSlugs.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : undefined,
    allowSnapshotRestoreOnRun: policy?.allowSnapshotRestoreOnRun ?? true,
    debugRunDeadlineMs: policy?.debugRunDeadlineMs,
    debugApprovalHotWaitMs: policy?.debugApprovalHotWaitMs,
    debugRuntimeNoProgressTimeoutMs: policy?.debugRuntimeNoProgressTimeoutMs,
    debugForceRuntimeNoProgressAfterPrompt: policy?.debugForceRuntimeNoProgressAfterPrompt,
    queuedFileAttachments: Array.isArray(policy?.queuedFileAttachments)
      ? policy.queuedFileAttachments.filter(isUserFileAttachment)
      : undefined,
    queuedUserMessageContent:
      typeof policy?.queuedUserMessageContent === "string"
        ? policy.queuedUserMessageContent
        : undefined,
  };
}

type GenerationControlDependencies = {
  activeGenerations: Map<string, GenerationContext>;
  lifecycleStore: GenerationLifecycleStore;
  releaseSandboxSlotLease(ctx: GenerationContext): Promise<void>;
};

export class GenerationControl {
  constructor(private readonly deps: GenerationControlDependencies) {}

  async cancelGeneration(generationId: string, userId: string): Promise<boolean> {
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
      await generationInterruptService.getPendingInterruptForGeneration(generationId);
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

  private projectPendingApproval(interrupt: GenerationInterruptRecord): PendingApproval {
    return {
      toolUseId: interrupt.providerToolUseId,
      toolName: interrupt.display.title,
      toolInput: interrupt.display.toolInput ?? {},
      requestedAt: interrupt.requestedAt.toISOString(),
      expiresAt: interrupt.expiresAt?.toISOString(),
      integration: interrupt.display.integration ?? "bap",
      operation: interrupt.display.operation ?? "unknown",
      command: interrupt.display.command,
    };
  }
}
