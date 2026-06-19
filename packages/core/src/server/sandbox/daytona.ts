import type { ExecuteResult, SandboxBackend } from "./types";

const DEFAULT_DAYTONA_SNAPSHOT = "bap-agent-dev";
const DEFAULT_WORKDIR = "/app";

export type DaytonaClientConfig = {
  apiKey?: string;
  apiUrl?: string;
  target?: string;
};

type DaytonaProcessResult = {
  exitCode?: number;
  result?: string;
  stdout?: string;
  stderr?: string;
};

type DaytonaSandboxHandle = {
  process: {
    executeCommand: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<DaytonaProcessResult>;
  };
  fs: {
    uploadFile: (file: Buffer, remotePath: string, timeout?: number) => Promise<void>;
    downloadFile: (remotePath: string, timeout?: number) => Promise<Buffer>;
  };
  delete: () => Promise<void>;
};

export function getDaytonaClientConfig(): DaytonaClientConfig {
  return {
    ...(process.env.DAYTONA_API_KEY ? { apiKey: process.env.DAYTONA_API_KEY } : {}),
    ...(process.env.DAYTONA_API_URL ? { apiUrl: process.env.DAYTONA_API_URL } : {}),
    ...(process.env.DAYTONA_TARGET ? { target: process.env.DAYTONA_TARGET } : {}),
  };
}

export class DaytonaSandboxBackend implements SandboxBackend {
  private sandbox: DaytonaSandboxHandle | null = null;

  async setup(_conversationId: string, _workDir?: string): Promise<void> {
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona(getDaytonaClientConfig());

    const snapshot = process.env.E2B_DAYTONA_SANDBOX_NAME || DEFAULT_DAYTONA_SNAPSHOT;
    this.sandbox = (await daytona.create({
      snapshot,
    })) as DaytonaSandboxHandle;
  }

  async execute(
    command: string,
    opts?: { timeout?: number; env?: Record<string, string> },
  ): Promise<ExecuteResult> {
    if (!this.sandbox) {
      throw new Error("DaytonaSandboxBackend not set up");
    }

    const timeoutSeconds = opts?.timeout ? Math.max(1, Math.ceil(opts.timeout / 1000)) : undefined;
    const result = (await this.sandbox.process.executeCommand(
      command,
      DEFAULT_WORKDIR,
      opts?.env,
      timeoutSeconds,
    )) as DaytonaProcessResult;

    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? result.result ?? "",
      stderr: result.stderr ?? "",
    };
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (!this.sandbox) {
      throw new Error("DaytonaSandboxBackend not set up");
    }

    const normalizedContent =
      typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    await this.sandbox.fs.uploadFile(normalizedContent, path);
  }

  async readFile(path: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error("DaytonaSandboxBackend not set up");
    }

    const content = await this.sandbox.fs.downloadFile(path);
    if (typeof content === "string") {
      return content;
    }
    return Buffer.from(content).toString("utf8");
  }

  async teardown(): Promise<void> {
    if (!this.sandbox) {
      return;
    }

    await this.sandbox.delete().catch(() => {});
    this.sandbox = null;
  }

  isAvailable(): boolean {
    return isDaytonaConfigured();
  }
}

export function isDaytonaConfigured(): boolean {
  return Boolean(process.env.DAYTONA_API_KEY);
}

// ---------------------------------------------------------------------------
// Admin utilities for listing and killing Daytona sandboxes
// ---------------------------------------------------------------------------

export type DaytonaAdminSandbox = {
  sandboxId: string;
  state: "running" | "paused" | "stopped" | "error" | "unknown";
  startedAt: Date | null;
  lastActivityAt: Date | null;
  metadata: Record<string, string>;
};

export type DaytonaListedSandbox = {
  id?: string;
  state?: string;
  createdAt?: string | Date;
  lastActivityAt?: string | Date;
  labels?: Record<string, string>;
  metadata?: Record<string, string>;
  delete?: (timeout?: number) => Promise<void>;
  stop?: (timeout?: number, force?: boolean) => Promise<void>;
};

type DaytonaListResult =
  | DaytonaListedSandbox[]
  | {
      items?: DaytonaListedSandbox[];
      totalPages?: number;
    };

type DaytonaListClient = {
  list: (...args: unknown[]) => unknown;
};

const DAYTONA_LIST_PAGE_SIZE = 100;

function normalizeDaytonaState(raw: string | undefined): DaytonaAdminSandbox["state"] {
  const value = (raw ?? "").toLowerCase();
  if (value === "started" || value === "running") {
    return "running";
  }
  if (value === "error" || value === "build_failed") {
    return "error";
  }
  if (value === "stopped" || value === "paused") {
    // Daytona's "stopped" is analogous to E2B's "paused" (sandbox preserved, not running).
    return "paused";
  }
  if (!value) {
    return "unknown";
  }
  return "unknown";
}

function coerceDate(value: string | Date | undefined | null): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function normalizeDaytonaListItems(result: DaytonaListResult): DaytonaListedSandbox[] {
  if (Array.isArray(result)) {
    return result;
  }
  return result.items ?? [];
}

function isAsyncIterable(value: unknown): value is AsyncIterable<DaytonaListedSandbox> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Symbol.asyncIterator in value &&
      typeof (value as AsyncIterable<DaytonaListedSandbox>)[Symbol.asyncIterator] === "function",
  );
}

function matchesLabels(
  sandbox: DaytonaListedSandbox,
  labels: Record<string, string> | undefined,
): boolean {
  if (!labels) {
    return true;
  }
  const actual = sandbox.labels ?? sandbox.metadata ?? {};
  return Object.entries(labels).every(([key, value]) => actual[key] === value);
}

async function collectAsyncIterableList(
  result: AsyncIterable<DaytonaListedSandbox>,
  labels?: Record<string, string>,
): Promise<DaytonaListedSandbox[]> {
  const items: DaytonaListedSandbox[] = [];
  for await (const sandbox of result) {
    if (matchesLabels(sandbox, labels)) {
      items.push(sandbox);
    }
  }
  return items;
}

export async function listDaytonaSandboxPages(
  daytona: DaytonaListClient,
  labels?: Record<string, string>,
): Promise<DaytonaListedSandbox[]> {
  if (labels) {
    const first = (await daytona.list(labels, 1, DAYTONA_LIST_PAGE_SIZE)) as DaytonaListResult;
    const items = [...normalizeDaytonaListItems(first)];
    if (Array.isArray(first) || !first.totalPages || first.totalPages <= 1) {
      return items;
    }

    for (let page = 2; page <= first.totalPages; page += 1) {
      // eslint-disable-next-line no-await-in-loop -- pagination must preserve API order
      const next = (await daytona.list(labels, page, DAYTONA_LIST_PAGE_SIZE)) as DaytonaListResult;
      items.push(...normalizeDaytonaListItems(next));
    }

    return items;
  }

  const currentResult = daytona.list({ limit: DAYTONA_LIST_PAGE_SIZE });
  if (isAsyncIterable(currentResult)) {
    return await collectAsyncIterableList(currentResult);
  }

  const awaitedCurrentResult = await currentResult;
  if (isAsyncIterable(awaitedCurrentResult)) {
    return await collectAsyncIterableList(awaitedCurrentResult);
  }
  if (
    Array.isArray(awaitedCurrentResult) ||
    (awaitedCurrentResult && typeof awaitedCurrentResult === "object")
  ) {
    const first = awaitedCurrentResult as DaytonaListResult;
    const currentItems = normalizeDaytonaListItems(first);
    if (currentItems.length > 0) {
      if (!Array.isArray(first) && first.totalPages && first.totalPages > 1) {
        for (let page = 2; page <= first.totalPages; page += 1) {
          // eslint-disable-next-line no-await-in-loop -- pagination must preserve API order
          const next = (await daytona.list(labels, page, DAYTONA_LIST_PAGE_SIZE)) as DaytonaListResult;
          currentItems.push(...normalizeDaytonaListItems(next));
        }
      }
      return currentItems;
    }
  }

  const first = (await daytona.list(undefined, 1, DAYTONA_LIST_PAGE_SIZE)) as DaytonaListResult;
  const items = [...normalizeDaytonaListItems(first)];
  if (Array.isArray(first) || !first.totalPages || first.totalPages <= 1) {
    return items;
  }

  for (let page = 2; page <= first.totalPages; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- pagination must preserve API order
    const next = (await daytona.list(undefined, page, DAYTONA_LIST_PAGE_SIZE)) as DaytonaListResult;
    items.push(...normalizeDaytonaListItems(next));
  }

  return items;
}

export async function listAllDaytonaSandboxes(): Promise<DaytonaAdminSandbox[]> {
  if (!isDaytonaConfigured()) {
    return [];
  }

  const { Daytona } = await import("@daytonaio/sdk");
  const daytona = new Daytona(getDaytonaClientConfig()) as unknown as Partial<DaytonaListClient>;

  if (typeof daytona.list !== "function") {
    throw new Error("Configured Daytona SDK client does not expose a sandbox list method");
  }

  const raw = await listDaytonaSandboxPages(daytona as DaytonaListClient);
  return raw.map((s) => {
    const metadata = (s.labels ?? s.metadata ?? {}) as Record<string, string>;
    return {
      sandboxId: s.id ?? "",
      state: normalizeDaytonaState(s.state),
      startedAt: coerceDate(s.createdAt),
      lastActivityAt: coerceDate(s.lastActivityAt),
      metadata,
    } satisfies DaytonaAdminSandbox;
  });
}

export async function killDaytonaSandboxById(sandboxId: string): Promise<boolean> {
  if (!isDaytonaConfigured()) {
    return false;
  }

  const { Daytona } = await import("@daytonaio/sdk");
  const daytona = new Daytona(getDaytonaClientConfig());

  const sandbox = (await daytona.get(sandboxId)) as {
    delete?: () => Promise<void>;
    stop?: () => Promise<void>;
  };

  if (typeof sandbox.delete === "function") {
    await sandbox.delete();
    return true;
  }
  if (typeof sandbox.stop === "function") {
    await sandbox.stop();
    return true;
  }
  return false;
}
