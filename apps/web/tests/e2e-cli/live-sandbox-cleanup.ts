import type { SandboxProvider } from "../e2e/live-sandbox";
import { callCliLiveTestingApi } from "./testing-api";

export type CliLiveCleanupState = {
  conversationIds: Set<string>;
  generationIds: Set<string>;
};

type CleanupGenerationRow = {
  id: string;
  conversationId: string;
  sandboxId: string | null;
  sandboxProvider: string | null;
  runtimeId: string | null;
};

type CleanupRuntimeRow = {
  id: string;
  conversationId: string;
  sandboxId: string | null;
  sandboxProvider: string | null;
  sessionId: string | null;
  status: string;
  activeGenerationId: string | null;
};

type CliLiveCleanupPlan = {
  sandboxIds: string[];
  runtimeIds: string[];
  conversationIds: string[];
  providerMismatches: string[];
};

function uniqueNonEmpty(values: Iterable<string> | undefined): string[] {
  return Array.from(new Set(Array.from(values ?? []).filter((value) => value.trim().length > 0)));
}

function normalizeCliIdentifier(candidate: string | undefined): string | null {
  const value = candidate?.trim().replace(/[),.;]+$/g, "");
  if (
    !value ||
    value === "-" ||
    value.toLowerCase() === "null" ||
    value.toLowerCase() === "undefined"
  ) {
    return null;
  }
  return value;
}

function addMatches(target: Set<string>, text: string, patterns: RegExp[]): void {
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const id = normalizeCliIdentifier(match[1]);
      if (id) {
        target.add(id);
      }
    }
  }
}

export function extractCliIdentifiersFromText(text: string): {
  conversationIds: string[];
  generationIds: string[];
} {
  const conversationIds = new Set<string>();
  const generationIds = new Set<string>();
  const idValuePattern = "([A-Za-z0-9_-]+)";

  addMatches(generationIds, text, [
    /\[generation\]\s+([^\s]+)/g,
    new RegExp(`\\bgeneration(?:Id|_id)?[=:]\\s*${idValuePattern}`, "gi"),
    new RegExp(`\\bgeneration id:\\s*${idValuePattern}`, "gi"),
  ]);
  addMatches(conversationIds, text, [
    /\[conversation\]\s+([^\s]+)/g,
    new RegExp(`\\bconversation(?:Id|_id)?[=:]\\s*${idValuePattern}`, "gi"),
    new RegExp(`\\bconversation id:\\s*${idValuePattern}`, "gi"),
  ]);

  return {
    conversationIds: [...conversationIds],
    generationIds: [...generationIds],
  };
}

export function createCliLiveCleanupState(): CliLiveCleanupState {
  return {
    conversationIds: new Set<string>(),
    generationIds: new Set<string>(),
  };
}

export function trackCliIdentifiersFromText(state: CliLiveCleanupState | null, text: string): void {
  if (!state || text.trim().length === 0) {
    return;
  }

  const ids = extractCliIdentifiersFromText(text);
  for (const id of ids.generationIds) {
    state.generationIds.add(id);
  }
  for (const id of ids.conversationIds) {
    state.conversationIds.add(id);
  }
}

export function buildCliLiveCleanupPlan(args: {
  generationRows: CleanupGenerationRow[];
  runtimeRows: CleanupRuntimeRow[];
  expectedProvider: SandboxProvider;
}): CliLiveCleanupPlan {
  const runtimeSandboxIds = args.runtimeRows
    .filter((row) => row.sandboxId)
    .map((row) => row.sandboxId as string);
  const generationSandboxIds = args.generationRows
    .filter((row) => row.sandboxId)
    .map((row) => row.sandboxId as string);

  const providerMismatches = [
    ...args.runtimeRows
      .filter(
        (row) =>
          row.sandboxId && row.sandboxProvider && row.sandboxProvider !== args.expectedProvider,
      )
      .map(
        (row) =>
          `runtime=${row.id} conversation=${row.conversationId} provider=${row.sandboxProvider} sandboxId=${row.sandboxId}`,
      ),
    ...args.generationRows
      .filter(
        (row) =>
          row.sandboxId && row.sandboxProvider && row.sandboxProvider !== args.expectedProvider,
      )
      .map(
        (row) =>
          `generation=${row.id} conversation=${row.conversationId} provider=${row.sandboxProvider} sandboxId=${row.sandboxId}`,
      ),
  ];

  return {
    sandboxIds: Array.from(new Set([...runtimeSandboxIds, ...generationSandboxIds])),
    runtimeIds: Array.from(new Set(args.runtimeRows.map((row) => row.id))),
    conversationIds: Array.from(
      new Set([
        ...args.runtimeRows.map((row) => row.conversationId),
        ...args.generationRows.map((row) => row.conversationId),
      ]),
    ),
    providerMismatches,
  };
}

export async function cleanupCliLiveSandboxes(args: {
  state: CliLiveCleanupState;
  expectedProvider: SandboxProvider;
}): Promise<void> {
  const generationIds = uniqueNonEmpty(args.state.generationIds);
  const conversationIds = uniqueNonEmpty(args.state.conversationIds);
  if (generationIds.length === 0 && conversationIds.length === 0) {
    return;
  }

  await callCliLiveTestingApi({
    action: "sandbox:cleanup",
    generationIds,
    conversationIds,
    expectedProvider: args.expectedProvider,
  });
}

export async function assertNoStartedDaytonaSandboxesRemain(_args: {
  state: CliLiveCleanupState;
  expectedProvider: SandboxProvider;
}): Promise<void> {
  // The remote cleanup endpoint performs the leak assertion after clearing runtime bindings.
}
