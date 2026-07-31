import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@bap/db/client";
import {
  conversation,
  generation,
  generationInterrupt,
  type GenerationInterruptDisplay,
  type GenerationInterruptResponsePayload,
} from "@bap/db/schema";

export type GenerationInterruptKind =
  | "plugin_write"
  | "runtime_permission"
  | "runtime_question"
  | "auth";

export type GenerationInterruptStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";

export type GenerationInterruptRecord = typeof generationInterrupt.$inferSelect;

export type GenerationInterruptEventPayload = {
  interruptId: string;
  generationId: string;
  runtimeId: string | null;
  conversationId: string;
  turnSeq: number | null;
  kind: GenerationInterruptKind;
  status: GenerationInterruptStatus;
  providerToolUseId: string;
  display: GenerationInterruptDisplay;
  responsePayload?: GenerationInterruptResponsePayload;
};

function getGenerationRecordStatusForInterrupt(
  interrupt: Pick<GenerationInterruptRecord, "status" | "kind"> | null,
): "running" | "awaiting_approval" | "awaiting_auth" {
  if (!interrupt || interrupt.status !== "pending") {
    return "running";
  }
  return interrupt.kind === "auth" ? "awaiting_auth" : "awaiting_approval";
}

function getConversationStatusForInterrupt(
  interrupt: Pick<GenerationInterruptRecord, "status" | "kind"> | null,
): "generating" | "awaiting_approval" | "awaiting_auth" {
  if (!interrupt || interrupt.status !== "pending") {
    return "generating";
  }
  return interrupt.kind === "auth" ? "awaiting_auth" : "awaiting_approval";
}

class GenerationInterruptService {
  async createInterrupt(input: {
    generationId: string;
    runtimeId: string;
    conversationId: string;
    turnSeq: number;
    kind: GenerationInterruptKind;
    display: GenerationInterruptDisplay;
    provider: "plugin" | "runtime";
    providerRequestId?: string;
    providerToolUseId: string;
    expiresAt?: Date;
    requestedByUserId?: string | null;
  }): Promise<GenerationInterruptRecord> {
    const existingPending = await this.getPendingInterruptForGeneration(input.generationId);
    if (existingPending) {
      if (existingPending.providerToolUseId === input.providerToolUseId) {
        return existingPending;
      }
      throw new Error(
        `Generation ${input.generationId} already has a pending interrupt (${existingPending.id})`,
      );
    }

    const [created] = await db
      .insert(generationInterrupt)
      .values({
        generationId: input.generationId,
        runtimeId: input.runtimeId,
        conversationId: input.conversationId,
        turnSeq: input.turnSeq,
        kind: input.kind,
        status: "pending",
        display: input.display,
        provider: input.provider,
        providerRequestId: input.providerRequestId,
        providerToolUseId: input.providerToolUseId,
        expiresAt: input.expiresAt,
        requestedByUserId: input.requestedByUserId ?? null,
      })
      .returning();

    await this.syncGenerationState(input.generationId, input.conversationId, created);
    return created;
  }

  async getInterrupt(interruptId: string): Promise<GenerationInterruptRecord | null> {
    return (
      (await db.query.generationInterrupt.findFirst({
        where: eq(generationInterrupt.id, interruptId),
      })) ?? null
    );
  }

  async getPendingInterruptForGeneration(
    generationId: string,
  ): Promise<GenerationInterruptRecord | null> {
    return (
      (await db.query.generationInterrupt.findFirst({
        where: and(
          eq(generationInterrupt.generationId, generationId),
          eq(generationInterrupt.status, "pending"),
        ),
        orderBy: [desc(generationInterrupt.requestedAt)],
      })) ?? null
    );
  }

  async listPendingInterruptsForGeneration(
    generationId: string,
  ): Promise<GenerationInterruptRecord[]> {
    return await db.query.generationInterrupt.findMany({
      where: and(
        eq(generationInterrupt.generationId, generationId),
        eq(generationInterrupt.status, "pending"),
      ),
      orderBy: [desc(generationInterrupt.requestedAt)],
    });
  }

  async findPendingInterruptByToolUseId(params: {
    generationId: string;
    providerToolUseId: string;
  }): Promise<GenerationInterruptRecord | null> {
    return (
      (await db.query.generationInterrupt.findFirst({
        where: and(
          eq(generationInterrupt.generationId, params.generationId),
          eq(generationInterrupt.providerToolUseId, params.providerToolUseId),
          eq(generationInterrupt.status, "pending"),
        ),
      })) ?? null
    );
  }

  async findInterruptByProviderRequestId(params: {
    generationId: string;
    providerRequestId: string;
  }): Promise<GenerationInterruptRecord | null> {
    return (
      (await db.query.generationInterrupt.findFirst({
        where: and(
          eq(generationInterrupt.generationId, params.generationId),
          eq(generationInterrupt.providerRequestId, params.providerRequestId),
        ),
        orderBy: [desc(generationInterrupt.requestedAt)],
      })) ?? null
    );
  }

  async findPendingAuthInterruptByIntegration(params: {
    generationId: string;
    integration: string;
  }): Promise<GenerationInterruptRecord | null> {
    const interrupts = await this.listPendingInterruptsForGeneration(params.generationId);
    return (
      interrupts.find(
        (interrupt) =>
          interrupt.kind === "auth" &&
          interrupt.display.authSpec?.integrations.includes(params.integration),
      ) ?? null
    );
  }

  async resolveInterrupt(params: {
    interruptId: string;
    status: Exclude<GenerationInterruptStatus, "pending">;
    responsePayload?: GenerationInterruptResponsePayload;
    resolvedByUserId?: string | null;
  }): Promise<GenerationInterruptRecord | null> {
    const existing = await this.getInterrupt(params.interruptId);
    if (!existing) {
      return null;
    }

    const [resolved] = await db
      .update(generationInterrupt)
      .set({
        status: params.status,
        responsePayload: params.responsePayload,
        resolvedAt: new Date(),
        resolvedByUserId: params.resolvedByUserId ?? null,
      })
      .where(eq(generationInterrupt.id, params.interruptId))
      .returning();

    if (!resolved) {
      return null;
    }

    const nextPending = await this.getPendingInterruptForGeneration(resolved.generationId);
    await this.syncGenerationState(resolved.generationId, resolved.conversationId, nextPending);
    return resolved;
  }

  async expireInterrupt(interruptId: string): Promise<GenerationInterruptRecord | null> {
    return this.resolveInterrupt({ interruptId, status: "expired" });
  }

  async markInterruptApplied(interruptId: string): Promise<GenerationInterruptRecord | null> {
    const [updated] = await db
      .update(generationInterrupt)
      .set({
        appliedAt: new Date(),
      })
      .where(eq(generationInterrupt.id, interruptId))
      .returning();

    return updated ?? null;
  }

  async claimInterruptApplicationByProviderRequestId(input: {
    generationId: string;
    providerRequestId: string;
  }): Promise<GenerationInterruptRecord | null> {
    const interrupt = await this.findInterruptByProviderRequestId(input);
    if (!interrupt) {
      return null;
    }
    const [updated] = await db
      .update(generationInterrupt)
      .set({ appliedAt: new Date() })
      .where(
        and(
          eq(generationInterrupt.id, interrupt.id),
          eq(generationInterrupt.status, "accepted"),
          isNull(generationInterrupt.appliedAt),
        ),
      )
      .returning();
    return updated ?? null;
  }

  async refreshInterruptExpiry(
    interruptId: string,
    expiresAt: Date,
  ): Promise<GenerationInterruptRecord | null> {
    const [updated] = await db
      .update(generationInterrupt)
      .set({
        expiresAt,
      })
      .where(
        and(eq(generationInterrupt.id, interruptId), eq(generationInterrupt.status, "pending")),
      )
      .returning();

    return updated ?? null;
  }

  async updateInterruptDisplay(
    interruptId: string,
    display: GenerationInterruptDisplay,
  ): Promise<GenerationInterruptRecord | null> {
    const [updated] = await db
      .update(generationInterrupt)
      .set({ display })
      .where(eq(generationInterrupt.id, interruptId))
      .returning();

    return updated ?? null;
  }

  async cancelInterruptsForGeneration(generationId: string): Promise<void> {
    const pending = await this.listPendingInterruptsForGeneration(generationId);
    if (pending.length === 0) {
      return;
    }

    await db
      .update(generationInterrupt)
      .set({
        status: "cancelled",
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(generationInterrupt.generationId, generationId),
          eq(generationInterrupt.status, "pending"),
        ),
      );

    const first = pending[0];
    if (first) {
      await this.syncGenerationState(generationId, first.conversationId, null);
    }
  }

  projectInterruptEvent(interrupt: GenerationInterruptRecord): GenerationInterruptEventPayload {
    return {
      interruptId: interrupt.id,
      generationId: interrupt.generationId,
      runtimeId: interrupt.runtimeId,
      conversationId: interrupt.conversationId,
      turnSeq: interrupt.turnSeq,
      kind: interrupt.kind,
      status: interrupt.status,
      providerToolUseId: interrupt.providerToolUseId,
      display: interrupt.display,
      responsePayload: interrupt.responsePayload ?? undefined,
    };
  }

  private async syncGenerationState(
    generationId: string,
    conversationId: string,
    interrupt: Pick<GenerationInterruptRecord, "status" | "kind"> | null,
  ): Promise<void> {
    await db
      .update(generation)
      .set({
        status: getGenerationRecordStatusForInterrupt(interrupt),
        pendingApproval: null,
        pendingAuth: null,
      })
      .where(eq(generation.id, generationId));

    await db
      .update(conversation)
      .set({
        generationStatus: getConversationStatusForInterrupt(interrupt),
      })
      .where(eq(conversation.id, conversationId));
  }
}

export const generationInterruptService = new GenerationInterruptService();
