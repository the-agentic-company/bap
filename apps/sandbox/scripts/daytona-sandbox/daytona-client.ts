/**
 * Daytona SDK access for the sandbox helper.
 *
 * Hides the SDK's auth construction, the structural shape of the sandbox
 * objects this script relies on, connecting-by-id (with auto-start), and the
 * "No available runners" error enrichment that points operators at an
 * attachable sandbox instead.
 */

import { Daytona } from "@daytonaio/sdk";

export const SNAPSHOT_NAME =
  process.env.E2B_DAYTONA_SANDBOX_NAME ||
  process.env.DAYTONA_SNAPSHOT ||
  process.env.DAYTONA_SNAPSHOT_DEV ||
  "bap-agent-dev";
export const START_TIMEOUT_SECONDS = 60;

export type DaytonaClientConfig = {
  apiKey?: string;
  jwtToken?: string;
  organizationId?: string;
  apiUrl?: string;
  target?: string;
};

export type DaytonaProcessResult = {
  exitCode?: number;
  result?: string;
  stdout?: string;
  stderr?: string;
  artifacts?: {
    stdout?: string;
    stderr?: string;
  };
};

export type DaytonaPtyHandle = {
  waitForConnection: () => Promise<void>;
  sendInput: (data: string | Uint8Array) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<unknown>;
  wait: () => Promise<{ exitCode?: number; error?: string }>;
  disconnect: () => Promise<void>;
};

export type DaytonaSandbox = {
  id: string;
  name?: string;
  state?: string;
  start?: () => Promise<void>;
  waitUntilStarted?: (timeoutSeconds?: number) => Promise<void>;
  delete: () => Promise<void>;
  getPreviewLink?: (port: number) => Promise<{ url: string; token?: string }>;
  getSignedPreviewUrl?: (
    port: number,
    expiresInSeconds?: number,
  ) => Promise<{ url: string; token?: string }>;
  process: {
    executeCommand: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<DaytonaProcessResult>;
    createPty?: (options: {
      id: string;
      cwd?: string;
      envs?: Record<string, string>;
      cols?: number;
      rows?: number;
      onData: (data: Uint8Array) => void | Promise<void>;
    }) => Promise<DaytonaPtyHandle>;
  };
  fs: {
    uploadFile: (source: Buffer, destination: string, timeout?: number) => Promise<void>;
    downloadFile: (path: string, timeout?: number) => Promise<Buffer | string | Uint8Array>;
  };
};

export type DaytonaSandboxRecord = Awaited<ReturnType<Daytona["get"]>>;

export function getDaytonaConfig(): DaytonaClientConfig {
  const apiKey = process.env.DAYTONA_API_KEY;
  const jwtToken = process.env.DAYTONA_JWT_TOKEN;
  const organizationId = process.env.DAYTONA_ORGANIZATION_ID;
  const apiUrl = process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL;
  const target = process.env.DAYTONA_TARGET;

  if (!apiKey && !(jwtToken && organizationId)) {
    throw new Error(
      "Missing Daytona auth. Set DAYTONA_API_KEY, or set both DAYTONA_JWT_TOKEN and DAYTONA_ORGANIZATION_ID.",
    );
  }

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(jwtToken ? { jwtToken } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(apiUrl ? { apiUrl } : {}),
    ...(target ? { target } : {}),
  };
}

export async function connectSandboxById(sandboxId: string): Promise<DaytonaSandbox> {
  const daytona = new Daytona(getDaytonaConfig());
  const sandbox = (await daytona.get(sandboxId)) as DaytonaSandbox;

  if (sandbox.state && sandbox.state !== "started") {
    await sandbox.start?.();
    await sandbox.waitUntilStarted?.(START_TIMEOUT_SECONDS);
  }

  return sandbox;
}

function isDaytonaNoAvailableRunnersError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return message.includes("No available runners");
}

async function listDaytonaSandboxes(daytona: Daytona): Promise<DaytonaSandboxRecord[]> {
  const sandboxes: DaytonaSandboxRecord[] = [];
  for await (const sandbox of daytona.list({ limit: 100 })) {
    sandboxes.push(sandbox);
  }
  return sandboxes;
}

export async function enrichCreateError(daytona: Daytona, error: unknown): Promise<Error> {
  if (!isDaytonaNoAvailableRunnersError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  try {
    const sandboxes = await listDaytonaSandboxes(daytona);
    const started = sandboxes.filter((sandbox) => sandbox.state === "started");
    if (started.length === 0) {
      return new Error(
        'Daytona reported "No available runners". No started sandboxes were found to attach to.',
      );
    }

    const examples = started
      .slice(0, 5)
      .map((sandbox) => `- ${sandbox.id} (${sandbox.name ?? sandbox.id})`)
      .join("\n");

    return new Error(
      `Daytona reported "No available runners". Attach to an existing sandbox instead, for example:\n` +
        `${examples}\n` +
        `Use: bun run daytona:sandbox -- --sandbox-id <sandbox-id>`,
    );
  } catch {
    return new Error(
      'Daytona reported "No available runners". Try attaching to an existing sandbox with `bun run daytona:sandbox -- --sandbox-id <sandbox-id>`.',
    );
  }
}
