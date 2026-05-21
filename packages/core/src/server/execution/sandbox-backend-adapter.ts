import type { SandboxBackend } from "../sandbox/types";

export type RuntimeSandboxLike = {
  sandboxId: string;
  exec(
    command: string,
    options?: {
      timeoutMs?: number;
      env?: Record<string, string | null | undefined>;
    },
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  writeFile(path: string, content: string | ArrayBuffer): Promise<void>;
  readFile(path: string): Promise<string>;
  teardown?: () => Promise<void>;
};

export function createSandboxBackend(runtimeSandbox: RuntimeSandboxLike): SandboxBackend {
  return {
    setup: async () => undefined,
    execute: async (command, opts) => {
      const result = await runtimeSandbox.exec(command, {
        timeoutMs: opts?.timeout,
        env: opts?.env,
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
    writeFile: async (filePath, content) => {
      if (typeof content === "string") {
        await runtimeSandbox.writeFile(filePath, content);
        return;
      }
      const buffer = Buffer.from(content);
      await runtimeSandbox.writeFile(
        filePath,
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      );
    },
    readFile: async (filePath) => runtimeSandbox.readFile(filePath),
    teardown: async () => {
      await runtimeSandbox.teardown?.();
    },
    isAvailable: () => true,
  };
}
