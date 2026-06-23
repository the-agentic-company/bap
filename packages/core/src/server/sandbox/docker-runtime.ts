import {
  SANDBOX_COMMON_ROOT as COMMON_TEMPLATE_ROOT,
  SANDBOX_DOCKER_RUNTIME_DOCKERFILE as DOCKERFILE_RUNTIME_ABSOLUTE,
  SANDBOX_REPO_ROOT as TEMPLATE_ROOT,
} from "@bap/sandbox/paths";
import { OPENCODE_AGENT_DEFINITIONS_DIR } from "@bap/prompts";
import type { Headers as TarHeader } from "tar-stream";
import Dockerode from "dockerode";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import tar from "tar-stream";

const DOCKERFILE_RUNTIME_RELATIVE = "apps/sandbox/src/docker/Dockerfile.runtime";
const DOCKER_BUILD_TIMEOUT_MS = 15 * 60 * 1000;
const DOCKER_BUILD_TRANSCRIPT_LIMIT = 200;

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(absolute);
      }
      if (entry.isFile()) {
        return [absolute];
      }
      return [] as string[];
    }),
  );
  return files.flat();
}

async function computeTemplateHash(): Promise<string> {
  const hasher = createHash("sha256");
  const commonFiles = (await listFilesRecursive(COMMON_TEMPLATE_ROOT)).toSorted();
  const agentDefinitionFiles = (await listFilesRecursive(OPENCODE_AGENT_DEFINITIONS_DIR)).toSorted();
  const included = [DOCKERFILE_RUNTIME_ABSOLUTE, ...commonFiles, ...agentDefinitionFiles];

  const entries = await Promise.all(
    included.map(async (absolutePath) => ({
      absolutePath,
      content: await readFile(absolutePath),
    })),
  );

  for (const { absolutePath, content } of entries) {
    const relativePath = path.relative(TEMPLATE_ROOT, absolutePath).replaceAll(path.sep, "/");
    hasher.update(relativePath);
    hasher.update("\n");
    hasher.update(content);
    hasher.update("\n");
  }

  return hasher.digest("hex");
}

function pushDockerTranscriptLine(transcript: string[], line: string): void {
  transcript.push(line);
  if (transcript.length > DOCKER_BUILD_TRANSCRIPT_LIMIT) {
    transcript.shift();
  }
}

function formatDockerBuildErrorMessage(input: {
  imageTag: string;
  error: unknown;
  transcript: string[];
}): string {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const transcriptBlock =
    input.transcript.length > 0
      ? `\nRecent Docker build output:\n${input.transcript.join("\n")}`
      : "";
  return `Failed to build Docker runtime image ${input.imageTag}: ${message}${transcriptBlock}`;
}

async function buildDockerRuntimeImageWithCli(imageTag: string): Promise<void> {
  const transcript: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const dockerfilePath = path.join(TEMPLATE_ROOT, DOCKERFILE_RUNTIME_RELATIVE);
    const child = spawn(
      "docker",
      ["build", "--progress=plain", "-t", imageTag, "-f", dockerfilePath, TEMPLATE_ROOT],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const clearBuildTimeout = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const refreshTimeout = () => {
      clearBuildTimeout();
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(
          new Error(
            formatDockerBuildErrorMessage({
              imageTag,
              error: `Timed out after ${DOCKER_BUILD_TIMEOUT_MS}ms while waiting for docker build`,
              transcript,
            }),
          ),
        );
      }, DOCKER_BUILD_TIMEOUT_MS);
    };

    const appendChunk = (chunk: Buffer | string, source: "stdout" | "stderr") => {
      refreshTimeout();
      const next = (source === "stdout" ? stdoutBuffer : stderrBuffer) + chunk.toString("utf8");
      const lines = next.split("\n");
      const remainder = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (trimmed.length > 0) {
          pushDockerTranscriptLine(transcript, trimmed);
        }
      }
      if (source === "stdout") {
        stdoutBuffer = remainder;
      } else {
        stderrBuffer = remainder;
      }
    };

    const flushBuffers = () => {
      const pending = [stdoutBuffer, stderrBuffer];
      for (const entry of pending) {
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
          pushDockerTranscriptLine(transcript, trimmed);
        }
      }
      stdoutBuffer = "";
      stderrBuffer = "";
    };

    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearBuildTimeout();
      flushBuffers();
      reject(new Error(formatDockerBuildErrorMessage({ imageTag, error, transcript })));
    };

    refreshTimeout();
    child.stdout.on("data", (chunk) => appendChunk(chunk, "stdout"));
    child.stderr.on("data", (chunk) => appendChunk(chunk, "stderr"));
    child.on("error", (error) => fail(error));
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearBuildTimeout();
      flushBuffers();
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          formatDockerBuildErrorMessage({
            imageTag,
            error: `docker build exited with code ${code ?? "unknown"}`,
            transcript,
          }),
        ),
      );
    });
  });
}

export function createDockerClient(): Dockerode {
  return new Dockerode();
}

export async function canConnectDockerDaemon(docker = createDockerClient()): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export function isDockerLikelyConfigured(): boolean {
  if (process.env.DOCKER_HOST) {
    return true;
  }

  const home = homedir();
  return (
    existsSync("/var/run/docker.sock") ||
    existsSync(path.join(home, ".docker", "run", "docker.sock"))
  );
}

export async function ensureDockerRuntimeImage(docker = createDockerClient()): Promise<string> {
  const templateHash = await computeTemplateHash();
  const imageTag = `bap-agent-runtime:${templateHash}`;

  const existing = await docker.listImages({
    filters: {
      reference: [imageTag],
    },
  });

  if (existing.length > 0) {
    return imageTag;
  }

  await buildDockerRuntimeImageWithCli(imageTag);
  return imageTag;
}

export async function getRunningContainerById(
  docker: Dockerode,
  containerId: string,
): Promise<Dockerode.Container | null> {
  try {
    const container = docker.getContainer(containerId);
    const details = await container.inspect();
    if (!details.State?.Running) {
      await container.start();
    }
    return container;
  } catch {
    return null;
  }
}

export async function createRuntimeContainer(input: {
  docker: Dockerode;
  imageTag: string;
  runtimePort: number;
  env: Record<string, string>;
}): Promise<Dockerode.Container> {
  const container = await input.docker.createContainer({
    Image: input.imageTag,
    WorkingDir: "/app",
    Env: Object.entries(input.env).map(([key, value]) => `${key}=${value}`),
    ExposedPorts: {
      [`${input.runtimePort}/tcp`]: {},
    },
    HostConfig: {
      PortBindings: {
        [`${input.runtimePort}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: "" }],
      },
    },
  });

  await container.start();
  return container;
}

export async function removeContainerBestEffort(container: Dockerode.Container): Promise<void> {
  try {
    await container.remove({ force: true });
  } catch {
    // Best effort cleanup
  }
}

export async function resolveMappedRuntimeUrl(
  container: Dockerode.Container,
  runtimePort: number,
): Promise<string> {
  const details = await container.inspect();
  const bindings = details.NetworkSettings?.Ports?.[`${runtimePort}/tcp`];
  const hostPort = bindings?.[0]?.HostPort;

  if (!hostPort) {
    throw new Error(`Docker runtime port ${runtimePort} is not published`);
  }

  return `http://127.0.0.1:${hostPort}`;
}

export async function execInContainer(input: {
  container: Dockerode.Container;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onStderr?: (chunk: string) => void;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const exec = await input.container.exec({
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Cmd: ["sh", "-lc", input.command],
    WorkingDir: input.cwd ?? "/app",
    Env: input.env ? Object.entries(input.env).map(([k, v]) => `${k}=${v}`) : undefined,
  });

  const stream = (await exec.start({ hijack: true, stdin: false })) as NodeJS.ReadableStream;

  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  stdoutStream.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  stderrStream.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
    input.onStderr?.(chunk.toString("utf8"));
  });

  input.container.modem.demuxStream(stream, stdoutStream, stderrStream);

  const streamDone = finished(stream);
  if (input.timeoutMs && input.timeoutMs > 0) {
    await Promise.race([
      streamDone,
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error(`Command timed out after ${input.timeoutMs}ms`)),
          input.timeoutMs,
        );
      }),
    ]);
  } else {
    await streamDone;
  }

  const inspected = await exec.inspect();
  return {
    exitCode: inspected.ExitCode ?? 1,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
}

export async function writeFileInContainer(
  container: Dockerode.Container,
  filePath: string,
  content: string | ArrayBuffer | Uint8Array,
): Promise<void> {
  const normalizedPath = path.posix.normalize(filePath);
  const parentDir = path.posix.dirname(normalizedPath);
  const fileName = path.posix.basename(normalizedPath);

  await execInContainer({
    container,
    command: `mkdir -p ${JSON.stringify(parentDir)}`,
  });

  const payload =
    typeof content === "string"
      ? Buffer.from(content, "utf8")
      : content instanceof Uint8Array
        ? Buffer.from(content)
        : Buffer.from(content);

  const pack = tar.pack();
  await new Promise<void>((resolve, reject) => {
    pack.entry({ name: fileName, mode: 0o644 }, payload, (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  pack.finalize();

  await container.putArchive(pack, { path: parentDir });
}

export async function readFileInContainer(
  container: Dockerode.Container,
  filePath: string,
): Promise<string> {
  const stream = await container.getArchive({ path: filePath });
  const extract = tar.extract();
  const chunks: Buffer[] = [];

  extract.on(
    "entry",
    (_header: TarHeader, entryStream: NodeJS.ReadableStream, next: () => void) => {
      entryStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      entryStream.on("end", () => next());
      entryStream.resume();
    },
  );

  stream.pipe(extract);
  await finished(extract);

  return Buffer.concat(chunks).toString("utf8");
}
