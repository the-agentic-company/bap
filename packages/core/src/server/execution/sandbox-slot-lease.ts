import { getSandboxSlotManager } from "../services/sandbox-slot-manager";
import type { GenerationRunMode } from "../services/generation/types";

const SANDBOX_SLOT_RETRY_DELAY_MS = 2_000;

export type SandboxSlotLeaseContext = {
  id: string;
  coworkerRunId?: string;
  sandboxSlotLeaseToken?: string;
  sandboxSlotLeaseRenewId?: ReturnType<typeof setInterval>;
};

type SandboxSlotLeaseDependencies<TRunType extends "chat" | "coworker"> = {
  getGenerationRunType: (ctx: SandboxSlotLeaseContext) => TRunType;
  enqueueGenerationRun: (
    generationId: string,
    runType: TRunType,
    options: {
      delayMs: number;
      dedupeKey: string;
      runMode: GenerationRunMode;
    },
  ) => Promise<unknown>;
  evictActiveGenerationContext: (generationId: string) => void;
  logRenewalError?: (generationId: string, error: unknown) => void;
};

export class SandboxSlotLeaseCoordinator<TRunType extends "chat" | "coworker"> {
  constructor(private readonly dependencies: SandboxSlotLeaseDependencies<TRunType>) {}

  async release(ctx: SandboxSlotLeaseContext): Promise<void> {
    if (ctx.sandboxSlotLeaseRenewId) {
      clearInterval(ctx.sandboxSlotLeaseRenewId);
      ctx.sandboxSlotLeaseRenewId = undefined;
    }
    if (!ctx.sandboxSlotLeaseToken) {
      return;
    }

    const token = ctx.sandboxSlotLeaseToken;
    ctx.sandboxSlotLeaseToken = undefined;
    await getSandboxSlotManager().releaseLease(ctx.id, token);
  }

  async ensure(
    ctx: SandboxSlotLeaseContext,
    options?: {
      allowWorkerRequeue?: boolean;
      runMode?: GenerationRunMode;
    },
  ): Promise<"acquired" | "requeued" | "waiting"> {
    if (ctx.sandboxSlotLeaseToken) {
      return "acquired";
    }

    const acquired = await getSandboxSlotManager().acquireLease(ctx.id);
    if (acquired.granted) {
      ctx.sandboxSlotLeaseToken = acquired.token;
      ctx.sandboxSlotLeaseRenewId = setInterval(() => {
        if (!ctx.sandboxSlotLeaseToken) {
          return;
        }
        void getSandboxSlotManager()
          .renewLease(ctx.id, ctx.sandboxSlotLeaseToken)
          .catch((error) => {
            this.dependencies.logRenewalError?.(ctx.id, error);
          });
      }, 30_000);
      return "acquired";
    }

    if (options?.allowWorkerRequeue ?? false) {
      await this.dependencies.enqueueGenerationRun(
        ctx.id,
        this.dependencies.getGenerationRunType(ctx),
        {
          delayMs: SANDBOX_SLOT_RETRY_DELAY_MS,
          dedupeKey: `slot-${Date.now()}`,
          runMode: options?.runMode ?? "normal_run",
        },
      );
      this.dependencies.evictActiveGenerationContext(ctx.id);
      return "requeued";
    }

    return "waiting";
  }

  async wait(
    ctx: SandboxSlotLeaseContext,
    options?: {
      allowWorkerRequeue?: boolean;
      runMode?: GenerationRunMode;
    },
  ): Promise<"acquired" | "requeued"> {
    while (true) {
      const status = await this.ensure(ctx, options);
      if (status === "acquired" || status === "requeued") {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, SANDBOX_SLOT_RETRY_DELAY_MS));
    }
  }
}
