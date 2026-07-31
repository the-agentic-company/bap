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
  hookUrl: string;
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
const syncStartToleranceMs = 30_000;
const failedStates = new Set(["canceled", "failure", "failed"]);

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
  return (
    normalizedActual.length > 0 &&
    normalizedExpected.length > 0 &&
    (normalizedActual === normalizedExpected ||
      normalizedActual.startsWith(normalizedExpected) ||
      normalizedExpected.startsWith(normalizedActual))
  );
}

export function validateBlueprintSyncHookUrl(hookUrl: string, blueprintId: string): URL {
  let url: URL;
  try {
    url = new URL(hookUrl);
  } catch {
    return fail("RENDER_BLUEPRINT_SYNC_HOOK_URL is not a valid URL.");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.render.com" ||
    url.pathname !== `/sync/${blueprintId}` ||
    !url.searchParams.get("key")
  ) {
    return fail("RENDER_BLUEPRINT_SYNC_HOOK_URL does not match the configured Blueprint.");
  }

  return url;
}

function unwrapSyncs(value: unknown): BlueprintSync[] {
  if (!Array.isArray(value)) {
    return fail("Render returned an invalid Blueprint sync list.");
  }

  return value
    .map((item) => (item as BlueprintSyncListItem).sync)
    .filter((sync): sync is BlueprintSync => Boolean(sync));
}

function startedAfter(sync: BlueprintSync, earliestStartMs: number): boolean {
  const startedAt = Date.parse(sync.startedAt ?? "");
  return Number.isFinite(startedAt) && startedAt >= earliestStartMs;
}

export async function triggerAndWaitForBlueprintSync(
  options: BlueprintSyncOptions,
  dependencies: BlueprintSyncDependencies = {
    fetch,
    now: Date.now,
    sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  },
): Promise<BlueprintSync> {
  const hookUrl = validateBlueprintSyncHookUrl(options.hookUrl, options.blueprintId);
  const triggeredAt = dependencies.now();
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const pollMs = options.pollMs ?? defaultPollMs;

  const triggerResponse = await dependencies.fetch(hookUrl, {
    method: "POST",
    redirect: "follow",
  });
  if (!triggerResponse.ok) {
    return fail(`Blueprint Sync Hook returned HTTP ${triggerResponse.status}.`);
  }

  const deadline = triggeredAt + timeoutMs;
  const earliestStartMs = triggeredAt - syncStartToleranceMs;
  const listUrl = `${renderApiBaseUrl}/blueprints/${encodeURIComponent(options.blueprintId)}/syncs?limit=20`;

  while (dependencies.now() <= deadline) {
    const response = await dependencies.fetch(listUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
    });
    if (!response.ok) {
      return fail(`Unable to inspect Blueprint syncs: HTTP ${response.status}.`);
    }

    const recentSyncs = unwrapSyncs(await response.json())
      .filter((sync) => startedAfter(sync, earliestStartMs))
      .sort((left, right) => Date.parse(right.startedAt ?? "") - Date.parse(left.startedAt ?? ""));
    const expectedSync = recentSyncs[0];

    if (expectedSync) {
      if (!commitsMatch(expectedSync.commit?.id, options.expectedCommit)) {
        return fail(
          `Latest Sync Hook commit is ${expectedSync.commit?.id ?? "unknown"}, expected ${options.expectedCommit}.`,
        );
      }
      if (expectedSync.state === "success") {
        return expectedSync;
      }
      if (failedStates.has(expectedSync.state ?? "")) {
        return fail(
          `Blueprint sync ${expectedSync.id ?? "unknown"} ended in state ${expectedSync.state}.`,
        );
      }
    }

    await dependencies.sleep(pollMs);
  }

  return fail(`Timed out waiting for Blueprint commit ${options.expectedCommit} to synchronize.`);
}

async function main(): Promise<void> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  const hookUrl = process.env.RENDER_BLUEPRINT_SYNC_HOOK_URL?.trim();
  if (!apiKey) {
    return fail("Missing RENDER_API_KEY.");
  }
  if (!hookUrl) {
    return fail("Missing RENDER_BLUEPRINT_SYNC_HOOK_URL.");
  }

  const blueprintId = requireArg("--blueprint-id");
  const expectedCommit = requireArg("--commit");
  console.log(
    `[render-blueprint-sync] Triggering Blueprint ${blueprintId} for commit ${expectedCommit.slice(0, 12)}.`,
  );

  const sync = await triggerAndWaitForBlueprintSync({
    apiKey,
    blueprintId,
    expectedCommit,
    hookUrl,
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
