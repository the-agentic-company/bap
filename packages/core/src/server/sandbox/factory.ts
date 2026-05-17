/**
 * Factory for selecting the appropriate SandboxBackend based on context.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { SandboxBackend } from "./types";

export type CloudSandboxProvider = "e2b" | "daytona" | "docker";

function getConfiguredSandboxDefault(): CloudSandboxProvider {
  const configuredDefault = process.env.SANDBOX_DEFAULT;

  if (
    configuredDefault === "e2b" ||
    configuredDefault === "daytona" ||
    configuredDefault === "docker"
  ) {
    return configuredDefault;
  }

  throw new Error(`Unsupported SANDBOX_DEFAULT value: ${configuredDefault}`);
}

function isE2BConfigured(): boolean {
  return Boolean(process.env.E2B_API_KEY);
}

function isDaytonaConfigured(): boolean {
  return Boolean(process.env.DAYTONA_API_KEY);
}

function isDockerConfigured(): boolean {
  if (process.env.DOCKER_HOST) {
    return true;
  }

  const home = homedir();
  return (
    existsSync("/var/run/docker.sock") ||
    existsSync(path.join(home, ".docker", "run", "docker.sock"))
  );
}

class DeferredSandboxBackend implements SandboxBackend {
  private backendPromise: Promise<SandboxBackend> | null = null;

  constructor(
    private readonly loadBackend: () => Promise<SandboxBackend>,
    private readonly availabilityCheck: () => boolean,
  ) {}

  private async getBackend(): Promise<SandboxBackend> {
    this.backendPromise ??= this.loadBackend();
    return this.backendPromise;
  }

  async setup(conversationId: string, workDir?: string): Promise<void> {
    const backend = await this.getBackend();
    await backend.setup(conversationId, workDir);
  }

  async execute(
    command: string,
    opts?: { timeout?: number; env?: Record<string, string> },
  ) {
    const backend = await this.getBackend();
    return backend.execute(command, opts);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const backend = await this.getBackend();
    await backend.writeFile(path, content);
  }

  async readFile(path: string): Promise<string> {
    const backend = await this.getBackend();
    return backend.readFile(path);
  }

  async teardown(): Promise<void> {
    const backend = await this.getBackend();
    await backend.teardown();
  }

  isAvailable(): boolean {
    return this.availabilityCheck();
  }
}

/**
 * SANDBOX_DEFAULT is authoritative: if it points to a provider that is not configured,
 * throw immediately instead of falling back to the other provider.
 */
export function getPreferredCloudSandboxProvider(): CloudSandboxProvider {
  const configuredDefault = getConfiguredSandboxDefault();

  if (configuredDefault === "e2b") {
    if (!isE2BConfigured()) {
      throw new Error("SANDBOX_DEFAULT is set to 'e2b' but E2B_API_KEY is not configured");
    }
    return "e2b";
  }

  if (configuredDefault === "daytona") {
    if (!isDaytonaConfigured()) {
      throw new Error("SANDBOX_DEFAULT is set to 'daytona' but DAYTONA_API_KEY is not configured");
    }
    return "daytona";
  }

  if (configuredDefault === "docker") {
    if (!isDockerConfigured()) {
      throw new Error(
        "SANDBOX_DEFAULT is set to 'docker' but Docker is not configured (missing Docker socket/DOCKER_HOST)",
      );
    }
    return "docker";
  }

  throw new Error(`Unsupported SANDBOX_DEFAULT value: ${configuredDefault}`);
}

/**
 * Get a SandboxBackend for a generation.
 */
function getSandboxBackend(conversationId: string, userId: string): SandboxBackend {
  // Silence lint about unused params while preserving public API.
  void conversationId;
  void userId;

  const provider = getPreferredCloudSandboxProvider();
  if (provider === "e2b") {
    return new DeferredSandboxBackend(async () => {
      const { E2BSandboxBackend } = await import("./e2b");
      return new E2BSandboxBackend();
    }, isE2BConfigured);
  }
  if (provider === "daytona") {
    return new DeferredSandboxBackend(async () => {
      const { DaytonaSandboxBackend } = await import("./daytona");
      return new DaytonaSandboxBackend();
    }, isDaytonaConfigured);
  }
  return new DeferredSandboxBackend(async () => {
    const { DockerSandboxBackend } = await import("./docker");
    return new DockerSandboxBackend();
  }, isDockerConfigured);
}
