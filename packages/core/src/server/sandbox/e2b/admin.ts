import { Sandbox } from "e2b";
import { env } from "../../../env";
import { conversationRuntimeService } from "../../services/conversation-runtime-service";
import { connectSandboxById, getConversationRuntimeState, logLifecycle } from "./runtime";

async function killConnectedSandbox(
  runtimeId: string,
  conversationId: string,
  sandbox: Sandbox,
  reason: "manual_kill" | "paused_cleanup",
): Promise<void> {
  try {
    await sandbox.kill();
    await conversationRuntimeService.markRuntimeDead(runtimeId);
    logLifecycle(
      "VM_TERMINATED",
      {
        conversationId,
        sandboxId: sandbox.sandboxId,
        reason,
      },
      { source: "e2b", conversationId, sandboxId: sandbox.sandboxId },
    );
  } catch (error) {
    console.error("[E2B] Failed to kill sandbox:", error);
  }
}

/**
 * Kill a sandbox for a conversation.
 */
export async function killSandbox(
  conversationId: string,
  reason: "manual_kill" | "paused_cleanup" = "manual_kill",
): Promise<void> {
  const runtimeState = await getConversationRuntimeState(conversationId);
  const sandboxId = runtimeState?.sandboxId ?? null;

  if (!sandboxId) {
    return;
  }

  const sandbox = await connectSandboxById(sandboxId);
  if (!sandbox) {
    if (runtimeState) {
      await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
    }
    return;
  }

  if (!runtimeState) {
    return;
  }

  await killConnectedSandbox(runtimeState.runtimeId, conversationId, sandbox, reason);
}

/**
 * Check if E2B is configured.
 */
export function isE2BConfigured(): boolean {
  return !!env.E2B_API_KEY;
}

// ---------------------------------------------------------------------------
// Admin utilities for listing and killing sandboxes
// ---------------------------------------------------------------------------

export async function listAllE2BSandboxes(): Promise<
  Array<{
    sandboxId: string;
    templateId: string;
    state: "running" | "paused";
    startedAt: Date;
    endAt: Date;
    cpuCount: number;
    memoryMB: number;
    metadata: Record<string, string>;
  }>
> {
  const paginator = Sandbox.list();
  const results: Array<{
    sandboxId: string;
    templateId: string;
    state: "running" | "paused";
    startedAt: Date;
    endAt: Date;
    cpuCount: number;
    memoryMB: number;
    metadata: Record<string, string>;
  }> = [];

  while (paginator.hasNext) {
    const page = await paginator.nextItems();
    for (const s of page) {
      results.push({
        sandboxId: s.sandboxId,
        templateId: s.templateId,
        state: s.state,
        startedAt: s.startedAt,
        endAt: s.endAt,
        cpuCount: s.cpuCount,
        memoryMB: s.memoryMB,
        metadata: s.metadata,
      });
    }
  }

  return results;
}

export async function killE2BSandboxById(sandboxId: string): Promise<boolean> {
  return Sandbox.kill(sandboxId);
}
