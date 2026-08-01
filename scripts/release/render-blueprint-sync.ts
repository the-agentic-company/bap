type BlueprintSync = {
  commit?: { id?: string };
  completedAt?: string;
  id?: string;
  startedAt?: string;
  state?: string;
};

type BlueprintSyncListItem = {
  sync?: BlueprintSync;
};

type BlueprintSyncOptions = {
  apiKey: string;
  blueprintId: string;
  expectedCommit: string;
  pollMs?: number;
  timeoutMs?: number;
};

type BlueprintSyncDependencies = {
  fetch: typeof fetch;
  now: () => number;
  sleep: (delayMs: number) => Promise<void>;
};

const renderApiBaseUrl = "https://api.render.com/v1";
const defaultTimeoutMs = 10 * 60 * 1000;
const defaultPollMs = 5_000;
const failedStates = new Set(["canceled", "error", "failure", "failed"]);

function fail(message: string): never {
  throw new Error(`[render-blueprint-sync] ${message}`);
}

function readArg(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function requireArg(name: string): string {
  const value = readArg(name)?.trim();
  return value || fail(`Missing required argument ${name}`);
}

function normalizeCommit(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function commitsMatch(actual: string | undefined, expected: string): boolean {
  const normalizedActual = normalizeCommit(actual);
  const normalizedExpected = normalizeCommit(expected);
  if (![normalizedActual, normalizedExpected].every((commit) => commit.length > 0)) {
    return false;
  }

  return [
    normalizedActual === normalizedExpected,
    normalizedActual.startsWith(normalizedExpected),
    normalizedExpected.startsWith(normalizedActual),
  ].includes(true);
}

function unwrapSyncs(value: unknown): BlueprintSync[] {
  if (!Array.isArray(value)) {
    return fail("Render returned an invalid Blueprint sync list.");
  }

  return value
    .map((item) => (item as BlueprintSyncListItem).sync)
    .filter((sync): sync is BlueprintSync => Boolean(sync));
}

async function requireSuccessfulResponse(
  responsePromise: Promise<Response>,
  errorMessage: (status: number) => string,
): Promise<Response> {
  const response = await responsePromise;
  if (!response.ok) {
    return fail(errorMessage(response.status));
  }
  return response;
}

async function expectedSync(
  options: Pick<BlueprintSyncOptions, "apiKey" | "blueprintId" | "expectedCommit">,
  fetchImplementation: typeof fetch,
): Promise<BlueprintSync | undefined> {
  const listUrl = `${renderApiBaseUrl}/blueprints/${encodeURIComponent(options.blueprintId)}/syncs?limit=20`;
  const response = await requireSuccessfulResponse(
    fetchImplementation(listUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
    }),
    (status) => `Unable to inspect Blueprint syncs: HTTP ${status}.`,
  );

  return unwrapSyncs(await response.json()).find((sync) =>
    commitsMatch(blueprintSyncCommit(sync), options.expectedCommit),
  );
}

function completedExpectedSync(sync: BlueprintSync | undefined): BlueprintSync | undefined {
  if (!sync) {
    return undefined;
  }
  requireNonFailedState(sync);
  if (sync.state !== "success") {
    return undefined;
  }
  return sync;
}

function blueprintSyncCommit(sync: BlueprintSync): string | undefined {
  if (!sync.commit) {
    return undefined;
  }
  return sync.commit.id;
}

function displayValue(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }
  return value;
}

function requireNonFailedState(sync: BlueprintSync): void {
  const state = displayValue(sync.state);
  if (failedStates.has(state)) {
    return fail(`Blueprint sync ${sync.id ?? "unknown"} ended in state ${sync.state}.`);
  }
}

export async function waitForBlueprintSync(
  options: BlueprintSyncOptions,
  dependencies: BlueprintSyncDependencies = {
    fetch,
    now: Date.now,
    sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  },
): Promise<BlueprintSync> {
  const startedAt = dependencies.now();
  const { pollMs = defaultPollMs, timeoutMs = defaultTimeoutMs } = options;
  const deadline = startedAt + timeoutMs;

  while (dependencies.now() <= deadline) {
    const sync = completedExpectedSync(await expectedSync(options, dependencies.fetch));
    if (sync) {
      return sync;
    }

    await dependencies.sleep(pollMs);
  }

  return fail(`Timed out waiting for Blueprint commit ${options.expectedCommit} to synchronize.`);
}

async function main(): Promise<void> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) {
    return fail("Missing RENDER_API_KEY.");
  }

  const blueprintId = requireArg("--blueprint-id");
  const expectedCommit = requireArg("--commit");
  console.log(
    `[render-blueprint-sync] Waiting for Blueprint ${blueprintId} to automatically sync commit ${expectedCommit.slice(0, 12)}.`,
  );

  const sync = await waitForBlueprintSync({
    apiKey,
    blueprintId,
    expectedCommit,
  });
  console.log(
    `[render-blueprint-sync] Blueprint sync ${sync.id ?? "unknown"} completed with the expected commit.`,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
