import {
  generationInterruptService,
  type GenerationInterruptRecord,
} from "../../generation-interrupt-service";
import {
  GenerationSuspendedError,
  type GenerationTurnSuspender,
} from "../core/turn-suspension";
import type { GenerationContext, GenerationEvent } from "../types";
import {
  computeParkedInterruptExpiryDate,
  getRuntimeToolRefForInterrupt,
} from "./decision-shared";

type InterruptParkingDependencies = {
  activeGenerations: Map<string, GenerationContext>;
  getApprovalHotWaitMs(
    ctx: Pick<GenerationContext, "approvalHotWaitMs">,
  ): number;
  broadcast(ctx: GenerationContext, event: GenerationEvent): void;
  suspendGenerationForInterrupt: GenerationTurnSuspender["suspendGenerationForInterrupt"];
  getPluginApprovalStatus(
    generationId: string,
    interruptId: string,
  ): Promise<"pending" | "allow" | "deny">;
};

export class InterruptParking {
  constructor(private readonly deps: InterruptParkingDependencies) {}

  async parkGenerationForInterrupt(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
  ): Promise<never> {
    const latest = await generationInterruptService.getInterrupt(interrupt.id);
    if (!latest || latest.status !== "pending") {
      throw new GenerationSuspendedError(
        interrupt.id,
        interrupt.kind === "auth" ? "auth" : "approval",
      );
    }

    const enrichedInterrupt = await this.enrichPluginWriteInterruptRuntimeTool(
      ctx,
      latest,
    );
    const parkedInterrupt =
      await this.refreshInterruptForPark(enrichedInterrupt);
    const releasedSandboxId = ctx.sandboxId;
    this.broadcastApprovalParked(ctx, parkedInterrupt, releasedSandboxId);
    return await this.deps.suspendGenerationForInterrupt(ctx, parkedInterrupt);
  }

  scheduleApprovalPark(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
  ): void {
    if (ctx.approvalParkTimeoutId) {
      clearTimeout(ctx.approvalParkTimeoutId);
    }
    ctx.approvalParkTimeoutId = setTimeout(() => {
      ctx.approvalParkTimeoutId = undefined;
      void (async () => {
        const activeCtx = this.deps.activeGenerations.get(ctx.id);
        if (!activeCtx || activeCtx.currentInterruptId !== interrupt.id) {
          return;
        }
        const latest = await generationInterruptService.getInterrupt(
          interrupt.id,
        );
        if (!latest || latest.status !== "pending") {
          return;
        }
        activeCtx.abortForInterruptPark = true;
        try {
          await this.parkGenerationForInterrupt(activeCtx, latest);
        } catch (error) {
          if (error instanceof GenerationSuspendedError) {
            activeCtx.abortController.abort();
            return;
          }
          activeCtx.abortForInterruptPark = false;
          console.error(
            "[GenerationManager] Failed to park approval interrupt:",
            error,
          );
        }
      })();
    }, this.deps.getApprovalHotWaitMs(ctx));
    ctx.approvalParkTimeoutId.unref?.();
  }

  startExternalInterruptPolling(ctx: GenerationContext): void {
    if (ctx.externalInterruptPollIntervalId) {
      return;
    }

    ctx.externalInterruptPollIntervalId = setInterval(() => {
      const activeCtx = this.deps.activeGenerations.get(ctx.id);
      if (!activeCtx) {
        this.stopExternalInterruptPolling(ctx);
        return;
      }
      void this.pollExternalInterruptAndSuspendIfNeeded(activeCtx).catch(
        (error) => {
          if (error instanceof GenerationSuspendedError) {
            activeCtx.abortController.abort();
            return;
          }
          console.error(
            "[GenerationManager] External interrupt poll failed:",
            error,
          );
        },
      );
    }, 1_000);
    ctx.externalInterruptPollIntervalId.unref?.();
  }

  stopExternalInterruptPolling(ctx: GenerationContext): void {
    if (!ctx.externalInterruptPollIntervalId) {
      return;
    }
    clearInterval(ctx.externalInterruptPollIntervalId);
    ctx.externalInterruptPollIntervalId = undefined;
  }

  async pollExternalInterruptAndSuspendIfNeeded(
    ctx: GenerationContext,
  ): Promise<void> {
    if (ctx.currentInterruptId) {
      const current = await generationInterruptService.getInterrupt(
        ctx.currentInterruptId,
      );
      if (current && current.status !== "pending") {
        if (current.kind === "plugin_write") {
          await this.deps.getPluginApprovalStatus(ctx.id, current.id);
        }
        ctx.currentInterruptId = undefined;
        ctx.status = "running";
        if (ctx.approvalParkTimeoutId) {
          clearTimeout(ctx.approvalParkTimeoutId);
          ctx.approvalParkTimeoutId = undefined;
        }
      }
      return;
    }

    const pendingInterrupt =
      await generationInterruptService.getPendingInterruptForGeneration(ctx.id);
    if (!pendingInterrupt) {
      return;
    }

    const enrichedInterrupt = await this.enrichPluginWriteInterruptRuntimeTool(
      ctx,
      pendingInterrupt,
    );
    ctx.currentInterruptId = enrichedInterrupt.id;
    ctx.status =
      enrichedInterrupt.kind === "auth" ? "awaiting_auth" : "awaiting_approval";
    this.scheduleApprovalPark(ctx, enrichedInterrupt);
  }

  private broadcastApprovalParked(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
    releasedSandboxId?: string,
  ): void {
    this.deps.broadcast(ctx, {
      type: "status_change",
      status: "approval_parked",
      metadata: {
        runtimeId: ctx.runtimeId,
        sandboxId: releasedSandboxId,
        releasedSandboxId,
        parkedInterruptId: interrupt.id,
      },
    });
  }

  private async refreshInterruptForPark(
    interrupt: GenerationInterruptRecord,
  ): Promise<GenerationInterruptRecord> {
    if (interrupt.status !== "pending") {
      return interrupt;
    }
    return (
      (await generationInterruptService.refreshInterruptExpiry(
        interrupt.id,
        computeParkedInterruptExpiryDate(),
      )) ?? interrupt
    );
  }

  private async enrichPluginWriteInterruptRuntimeTool(
    ctx: GenerationContext,
    interrupt: GenerationInterruptRecord,
  ): Promise<GenerationInterruptRecord> {
    if (interrupt.kind !== "plugin_write" || interrupt.display.runtimeTool) {
      return interrupt;
    }
    const command = interrupt.display.command;
    if (!command) {
      return interrupt;
    }
    const runtimeTool = getRuntimeToolRefForInterrupt(ctx, {
      providerRequestId: interrupt.providerRequestId,
      command,
    });
    if (!runtimeTool) {
      return interrupt;
    }
    return (
      (await generationInterruptService.updateInterruptDisplay(interrupt.id, {
        ...interrupt.display,
        runtimeTool,
      })) ?? interrupt
    );
  }
}
