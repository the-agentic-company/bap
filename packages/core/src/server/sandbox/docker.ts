import type Dockerode from "dockerode";
import type { ExecuteResult, SandboxBackend } from "./types";
import {
  canConnectDockerDaemon,
  createDockerClient,
  createRuntimeContainer,
  ensureDockerRuntimeImage,
  execInContainer,
  isDockerLikelyConfigured,
  readFileInContainer,
  removeContainerBestEffort,
  writeFileInContainer,
} from "./docker-runtime";

const DEFAULT_WORKDIR = "/app";
const LEGACY_RUNTIME_PORT = 4096;

export class DockerSandboxBackend implements SandboxBackend {
  private docker: Dockerode;
  private container: Dockerode.Container | null = null;

  constructor() {
    this.docker = createDockerClient();
  }

  async setup(conversationId: string, _workDir?: string): Promise<void> {
    const imageTag = await ensureDockerRuntimeImage(this.docker);
    this.container = await createRuntimeContainer({
      docker: this.docker,
      imageTag,
      runtimePort: LEGACY_RUNTIME_PORT,
      env: {
        CONVERSATION_ID: conversationId,
      },
    });
  }

  async execute(
    command: string,
    opts?: { timeout?: number; env?: Record<string, string> },
  ): Promise<ExecuteResult> {
    if (!this.container) {
      throw new Error("DockerSandboxBackend not set up");
    }

    const result = await execInContainer({
      container: this.container,
      command,
      cwd: DEFAULT_WORKDIR,
      env: opts?.env,
      timeoutMs: opts?.timeout,
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (!this.container) {
      throw new Error("DockerSandboxBackend not set up");
    }

    await writeFileInContainer(this.container, path, content);
  }

  async readFile(path: string): Promise<string> {
    if (!this.container) {
      throw new Error("DockerSandboxBackend not set up");
    }

    return readFileInContainer(this.container, path);
  }

  async teardown(): Promise<void> {
    if (!this.container) {
      return;
    }

    await removeContainerBestEffort(this.container);
    this.container = null;
  }

  isAvailable(): boolean {
    return isDockerConfigured();
  }
}

function isDockerConfigured(): boolean {
  return isDockerLikelyConfigured();
}

async function isDockerReachable(): Promise<boolean> {
  return canConnectDockerDaemon();
}
