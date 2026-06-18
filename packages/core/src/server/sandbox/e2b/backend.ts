import type { Sandbox } from "e2b";
import type { SandboxBackend, ExecuteResult } from "../types";
import { isE2BConfigured, killSandbox } from "./admin";
import { getSandboxStateDurable } from "./provisioning";

/**
 * SandboxBackend implementation backed by E2B cloud sandboxes.
 * Wraps existing E2B functions into the SandboxBackend interface.
 */
export class E2BSandboxBackend implements SandboxBackend {
  private sandbox: Sandbox | null = null;
  private conversationId: string | null = null;

  async setup(conversationId: string): Promise<void> {
    this.conversationId = conversationId;
    // Sandbox is lazily created via getOrCreateSandbox
  }

  async execute(
    command: string,
    opts?: { timeout?: number; env?: Record<string, string> },
  ): Promise<ExecuteResult> {
    if (!this.conversationId) {
      throw new Error("E2BSandboxBackend not set up");
    }
    const state = await getSandboxStateDurable(this.conversationId);
    if (!state) {
      throw new Error("No active sandbox for conversation");
    }

    const result = await state.sandbox.commands.run(command, {
      timeoutMs: opts?.timeout,
      envs: opts?.env,
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (!this.conversationId) {
      throw new Error("E2BSandboxBackend not set up");
    }
    const state = await getSandboxStateDurable(this.conversationId);
    if (!state) {
      throw new Error("No active sandbox for conversation");
    }

    if (typeof content === "string") {
      await state.sandbox.files.write(path, content);
    } else {
      await state.sandbox.files.write(path, content.buffer as ArrayBuffer);
    }
  }

  async readFile(path: string): Promise<string> {
    if (!this.conversationId) {
      throw new Error("E2BSandboxBackend not set up");
    }
    const state = await getSandboxStateDurable(this.conversationId);
    if (!state) {
      throw new Error("No active sandbox for conversation");
    }

    return await state.sandbox.files.read(path);
  }

  async teardown(): Promise<void> {
    if (this.conversationId) {
      await killSandbox(this.conversationId);
      this.conversationId = null;
      this.sandbox = null;
    }
  }

  isAvailable(): boolean {
    return isE2BConfigured();
  }
}
