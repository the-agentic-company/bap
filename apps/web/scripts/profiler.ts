import { parseModelReference } from "@cmdclaw/core/lib/model-reference";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runGenerationStream, type DoneArtifactsData } from "@/lib/generation-stream";
import { DEFAULT_SERVER_URL, createRpcClient, loadConfig } from "./lib/cli-shared";

type Args = {
  serverUrl: string;
  message: string;
  model: string;
  runs: number;
  warmups: number;
  autoApprove: boolean;
  resetConversation: boolean;
};

type RunRecord = {
  index: number;
  elapsedMs: number;
  generationMs?: number;
  clientGenerationToFirstVisibleOutputMs?: number;
  opencodeReadyMs?: number;
  sessionReadyMs?: number;
  agentInitMs?: number;
  prePromptSetupMs?: number;
  waitForFirstEventMs?: number;
  promptToFirstTokenMs?: number;
  generationToFirstTokenMs?: number;
  promptToFirstVisibleOutputMs?: number;
  generationToFirstVisibleOutputMs?: number;
  modelStreamMs?: number;
  postProcessingMs?: number;
  sandboxConnectOrCreateMs?: number;
  sandboxMode?: "created" | "reused" | "unknown";
};

type ProfileState = {
  conversationId?: string;
  updatedAt?: string;
};

const CMDCLAW_DIR = join(homedir(), ".cmdclaw");
const PROFILES_DIR = join(CMDCLAW_DIR, "profiles");

function printHelp(): void {
  console.log("\nUsage: bun run profiler [options]\n");
  console.log("Options:");
  console.log(`  --server <url>              Server URL (default ${DEFAULT_SERVER_URL})`);
  console.log('  --message <text>            Prompt to send (default "hi")');
  console.log('  --model <provider/model>    Model reference (default "openai/gpt-5.2-codex")');
  console.log("  --runs <n>                  Measured runs (default 3)");
  console.log("  --warmups <n>               Warmup runs before measuring (default 1)");
  console.log("  --no-auto-approve           Disable auto approval (default enabled)");
  console.log("  --reset-conversation        Ignore cached conversation and create a new one");
  console.log("  -h, --help                  Show help\n");
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    serverUrl: process.env.APP_SERVER_URL || DEFAULT_SERVER_URL,
    message: "hi",
    model: process.env.CMDCLAW_CHAT_MODEL || "openai/gpt-5.2-codex",
    runs: 3,
    warmups: 1,
    autoApprove: true,
    resetConversation: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--server":
      case "-s":
        args.serverUrl = argv[i + 1] || args.serverUrl;
        i += 1;
        break;
      case "--message":
      case "-m":
        args.message = argv[i + 1] || args.message;
        i += 1;
        break;
      case "--model":
      case "-M":
        args.model = argv[i + 1] || args.model;
        i += 1;
        break;
      case "--runs":
        args.runs = Math.max(1, Number.parseInt(argv[i + 1] || "3", 10));
        i += 1;
        break;
      case "--warmups":
        args.warmups = Math.max(0, Number.parseInt(argv[i + 1] || "1", 10));
        i += 1;
        break;
      case "--no-auto-approve":
        args.autoApprove = false;
        break;
      case "--reset-conversation":
        args.resetConversation = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (arg?.startsWith("-")) {
          console.error(`Unknown flag: ${arg}`);
          printHelp();
          process.exit(1);
        }
        break;
    }
  }

  return args;
}

function profileSlugForServerUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    const protocol = url.protocol.replace(":", "");
    const host = url.hostname.toLowerCase();
    const port = url.port ? `-${url.port}` : "";
    return `${protocol}--${host}${port}`.replace(/[^a-z0-9.-]/g, "-");
  } catch {
    return serverUrl.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  }
}

function getProfileStatePath(serverUrl: string): string {
  return join(PROFILES_DIR, `chat-profiler.${profileSlugForServerUrl(serverUrl)}.json`);
}

function ensureProfilesDir(): void {
  if (!existsSync(CMDCLAW_DIR)) {
    mkdirSync(CMDCLAW_DIR, { recursive: true });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function loadProfileState(serverUrl: string): ProfileState {
  const statePath = getProfileStatePath(serverUrl);
  if (!existsSync(statePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as ProfileState;
  } catch {
    return {};
  }
}

function saveProfileState(serverUrl: string, state: ProfileState): void {
  ensureProfilesDir();
  const statePath = getProfileStatePath(serverUrl);
  writeFileSync(
    statePath,
    JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatOptionalDurationMs(ms: number | undefined): string {
  if (ms === undefined) {
    return "n/a";
  }
  return formatDurationMs(ms);
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)));
  return sorted[index] || 0;
}

function summarize(records: RunRecord[]): void {
  if (records.length === 0) {
    return;
  }
  const elapsed = records.map((record) => record.elapsedMs);
  const generation = records
    .map((record) => record.generationMs)
    .filter((value): value is number => value !== undefined);

  console.log("\n[profiler] Summary");
  console.log(`  runs: ${records.length}`);
  console.log(`  elapsed_p50: ${formatDurationMs(percentile(elapsed, 0.5))}`);
  console.log(`  elapsed_p90: ${formatDurationMs(percentile(elapsed, 0.9))}`);
  console.log(`  elapsed_best: ${formatDurationMs(Math.min(...elapsed))}`);
  if (generation.length > 0) {
    console.log(`  generation_p50: ${formatDurationMs(percentile(generation, 0.5))}`);
    console.log(`  generation_p90: ${formatDurationMs(percentile(generation, 0.9))}`);
    console.log(`  generation_best: ${formatDurationMs(Math.min(...generation))}`);
  }

  const phaseRows: Array<[label: string, values: number[]]> = [
    [
      "sandbox_connect_or_create",
      records
        .map((record) => record.sandboxConnectOrCreateMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "client_generation_to_first_visible_output",
      records
        .map((record) => record.clientGenerationToFirstVisibleOutputMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "opencode_ready",
      records
        .map((record) => record.opencodeReadyMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "session_ready",
      records
        .map((record) => record.sessionReadyMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "agent_init",
      records
        .map((record) => record.agentInitMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "pre_prompt_setup",
      records
        .map((record) => record.prePromptSetupMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "wait_for_first_event",
      records
        .map((record) => record.waitForFirstEventMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "prompt_to_first_token",
      records
        .map((record) => record.promptToFirstTokenMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "generation_to_first_token",
      records
        .map((record) => record.generationToFirstTokenMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "prompt_to_first_visible_output",
      records
        .map((record) => record.promptToFirstVisibleOutputMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "generation_to_first_visible_output",
      records
        .map((record) => record.generationToFirstVisibleOutputMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "model_stream",
      records
        .map((record) => record.modelStreamMs)
        .filter((value): value is number => value !== undefined),
    ],
    [
      "post_processing",
      records
        .map((record) => record.postProcessingMs)
        .filter((value): value is number => value !== undefined),
    ],
  ];

  for (const [label, values] of phaseRows) {
    if (values.length === 0) {
      continue;
    }
    console.log(
      `  ${label}_p50: ${formatDurationMs(percentile(values, 0.5))} (p90=${formatDurationMs(percentile(values, 0.9))}, best=${formatDurationMs(Math.min(...values))})`,
    );
  }
}

async function runSingle(args: {
  client: ReturnType<typeof createRpcClient>;
  conversationId?: string;
  message: string;
  model: string;
  autoApprove: boolean;
  index: number;
  label: "warmup" | "run";
}): Promise<{ conversationId: string; record: RunRecord }> {
  const startedAt = Date.now();
  let doneArtifacts: DoneArtifactsData | undefined;
  let doneConversationId: string | undefined;
  let firstVisibleOutputAtMs: number | undefined;
  const markFirstVisibleOutput = () => {
    if (firstVisibleOutputAtMs === undefined) {
      firstVisibleOutputAtMs = Date.now();
    }
  };

  const result = await runGenerationStream({
    client: args.client,
    input: {
      conversationId: args.conversationId,
      content: args.message,
      model: args.model,
      autoApprove: args.autoApprove,
    },
    callbacks: {
      onText: () => {
        markFirstVisibleOutput();
      },
      onThinking: () => {
        markFirstVisibleOutput();
      },
      onToolUse: () => undefined,
      onToolResult: () => undefined,
      onPendingApproval: () => undefined,
      onApprovalResult: () => undefined,
      onAuthNeeded: () => undefined,
      onAuthProgress: () => undefined,
      onAuthResult: () => undefined,
      onSandboxFile: () => undefined,
      onStatusChange: () => undefined,
      onError: (error) => {
        throw new Error(error.message);
      },
      onCancelled: () => {
        throw new Error("Generation cancelled");
      },
      onDone: (_generationId, conversationId, _messageId, _usage, artifacts) => {
        doneConversationId = conversationId;
        doneArtifacts = artifacts;
      },
    },
  });

  const elapsedMs = Date.now() - startedAt;
  const conversationId = doneConversationId || result?.conversationId;
  if (!conversationId) {
    throw new Error("Missing conversation ID in generation result");
  }

  const phase = doneArtifacts?.timing?.phaseDurationsMs;
  const record: RunRecord = {
    index: args.index,
    elapsedMs,
    generationMs: doneArtifacts?.timing?.generationDurationMs,
    clientGenerationToFirstVisibleOutputMs:
      firstVisibleOutputAtMs === undefined
        ? undefined
        : Math.max(0, firstVisibleOutputAtMs - startedAt),
    opencodeReadyMs: phase?.opencodeReadyMs,
    sessionReadyMs: phase?.sessionReadyMs,
    agentInitMs: phase?.agentInitMs,
    prePromptSetupMs: phase?.prePromptSetupMs,
    waitForFirstEventMs: phase?.waitForFirstEventMs,
    promptToFirstTokenMs: phase?.promptToFirstTokenMs,
    generationToFirstTokenMs: phase?.generationToFirstTokenMs,
    promptToFirstVisibleOutputMs:
      phase?.promptToFirstVisibleOutputMs ?? phase?.promptToFirstTokenMs,
    generationToFirstVisibleOutputMs:
      phase?.generationToFirstVisibleOutputMs ?? phase?.generationToFirstTokenMs,
    modelStreamMs: phase?.modelStreamMs,
    postProcessingMs: phase?.postProcessingMs,
    sandboxConnectOrCreateMs:
      phase?.sandboxConnectOrCreateMs ?? doneArtifacts?.timing?.sandboxStartupDurationMs,
    sandboxMode: doneArtifacts?.timing?.sandboxStartupMode,
  };

  console.log(
    `[profiler] ${args.label}#${args.index} elapsed=${formatDurationMs(record.elapsedMs)} generation=${formatDurationMs(record.generationMs ?? record.elapsedMs)} client_generation_to_first_visible_output=${formatOptionalDurationMs(record.clientGenerationToFirstVisibleOutputMs)} ttft_visible=${formatOptionalDurationMs(record.promptToFirstVisibleOutputMs)} ttft_text=${formatOptionalDurationMs(record.promptToFirstTokenMs)} sandbox=${record.sandboxMode ?? "unknown"}/${formatOptionalDurationMs(record.sandboxConnectOrCreateMs)} opencode=${formatOptionalDurationMs(record.opencodeReadyMs)} session=${formatOptionalDurationMs(record.sessionReadyMs)} pre_prompt=${formatOptionalDurationMs(record.prePromptSetupMs)} wait_first=${formatOptionalDurationMs(record.waitForFirstEventMs)} model=${formatOptionalDurationMs(record.modelStreamMs)}`,
  );

  return { conversationId, record };
}

async function runSeries(args: {
  count: number;
  label: "warmup" | "run";
  conversationId?: string;
  run: (
    index: number,
    conversationId: string | undefined,
  ) => Promise<{
    conversationId: string;
    record: RunRecord;
  }>;
}): Promise<{ conversationId?: string; records: RunRecord[] }> {
  const records: RunRecord[] = [];

  const iterate = async (
    index: number,
    currentConversationId: string | undefined,
  ): Promise<string | undefined> => {
    if (index > args.count) {
      return currentConversationId;
    }
    const result = await args.run(index, currentConversationId);
    if (args.label === "run") {
      records.push(result.record);
    }
    return iterate(index + 1, result.conversationId);
  };

  const conversationId = await iterate(1, args.conversationId);
  return { conversationId, records };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  parseModelReference(args.model);

  const config = loadConfig(args.serverUrl);
  if (!config?.token) {
    console.error(
      `[profiler] missing CLI auth token for ${args.serverUrl}. Run: bun run cmdclaw -- auth login --server ${args.serverUrl}`,
    );
    process.exit(1);
  }

  const client = createRpcClient(args.serverUrl, config.token);
  const state = args.resetConversation ? {} : loadProfileState(args.serverUrl);
  let conversationId = state.conversationId;

  console.log(`[profiler] server=${args.serverUrl}`);
  console.log(`[profiler] model=${args.model}`);
  console.log(`[profiler] message=${JSON.stringify(args.message)}`);
  console.log(`[profiler] warmups=${args.warmups} runs=${args.runs}`);
  if (conversationId) {
    console.log(`[profiler] cached conversation=${conversationId}`);
  }

  const warmupSeries = await runSeries({
    count: args.warmups,
    label: "warmup",
    conversationId,
    run: (index, currentConversationId) =>
      runSingle({
        client,
        conversationId: currentConversationId,
        message: args.message,
        model: args.model,
        autoApprove: args.autoApprove,
        index,
        label: "warmup",
      }),
  });
  conversationId = warmupSeries.conversationId;

  const runSeriesResult = await runSeries({
    count: args.runs,
    label: "run",
    conversationId,
    run: (index, currentConversationId) =>
      runSingle({
        client,
        conversationId: currentConversationId,
        message: args.message,
        model: args.model,
        autoApprove: args.autoApprove,
        index,
        label: "run",
      }),
  });
  conversationId = runSeriesResult.conversationId;
  const records = runSeriesResult.records;

  if (!conversationId) {
    throw new Error("Profiler did not return a conversation ID");
  }

  saveProfileState(args.serverUrl, { conversationId });
  summarize(records);
  console.log(`\n[profiler] conversation=${conversationId}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[profiler] ${message}`);
  process.exit(1);
});
