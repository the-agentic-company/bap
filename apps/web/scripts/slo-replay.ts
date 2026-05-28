import type { IntegrationType } from "@cmdclaw/core/server/oauth/config";
import { COWORKER_AVAILABLE_INTEGRATION_TYPES } from "@cmdclaw/core/lib/coworker-tool-policy";
import { SLO_CONCRETE_JOURNEYS } from "@cmdclaw/core/server/services/slo-journey-classification";
import { closePool, db as localDb } from "@cmdclaw/db/client";
import { coworker, coworkerRun, generation, sloReplayRun, user } from "@cmdclaw/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import process from "node:process";
import { Pool } from "pg";
import {
  importSloBucketsToVictoriaMetrics,
  renderPrometheusImportRows,
  resolveSloBackfillWindow,
  type SloJourney,
  type SloResult,
  type SloSample,
} from "./slo-backfill";

const DEFAULT_LIMIT = 25;
const POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
const REPLAY_CONFIG_VERSION = 1;

export const SLO_REPLAY_TARGET_EMAIL_ALLOWLIST = [
  "collebaptiste@gmail.com",
  "baptiste@heybap.com",
  "lubin@hyperstack.studio",
  "louis@hyperstack.studio",
  "louis@heybap.com",
] as const;

const REPLAY_JOURNEYS = SLO_CONCRETE_JOURNEYS;

type ReplayJourney = (typeof REPLAY_JOURNEYS)[number];
type TargetEnv = "staging" | "prod";

export type SloReplayFlags = {
  targetEnv: TargetEnv;
  dryRun: boolean;
  journey?: ReplayJourney;
  limit: number;
  waitTimeoutMs: number;
};

export type SourceReplayEvent = {
  eventAt: Date;
  journey: ReplayJourney;
  result: SloResult;
  sourceGenerationId: string | null;
  sourceCoworkerRunId: string | null;
  sourceUserId: string;
  targetUserEmail: string;
  firstUserMessage: string | null;
  coworkerId: string | null;
  model: string | null;
  authSource: string | null;
};

export type ReplayCandidate = {
  journey: ReplayJourney;
  dedupeKey: string;
  configHash: string;
  targetEnv: TargetEnv;
  sourceUserId: string;
  targetUserEmail: string;
  firstUserMessage: string | null;
  coworkerId: string | null;
  model: string | null;
  authSource: string | null;
  sourceGenerationIds: string[];
  sourceCoworkerRunIds: string[];
  latestEventAt: Date;
};

export type ReplaySelectionSummary = {
  candidates: ReplayCandidate[];
  skippedLatestCompleted: number;
  skippedAlreadyReplayed: number;
  skippedMissingDedupeInput: number;
};

type ExistingReplayKey = string;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseTargetEnv(value: string | undefined): TargetEnv {
  if (value === "staging" || value === "prod") {
    return value;
  }
  fail("Missing required --target-env <staging|prod>.");
}

function parseJourney(value: string): ReplayJourney {
  if (REPLAY_JOURNEYS.includes(value as ReplayJourney)) {
    return value as ReplayJourney;
  }
  fail(`--journey must be one of: ${REPLAY_JOURNEYS.join(", ")}`);
}

export function parseSloReplayFlags(argv: string[]): SloReplayFlags {
  let targetEnv: TargetEnv | undefined;
  let dryRun = false;
  let journey: ReplayJourney | undefined;
  let limit = DEFAULT_LIMIT;
  let waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--target-env":
        targetEnv = parseTargetEnv(argv[index + 1]);
        index += 1;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--journey":
        journey = parseJourney(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--limit":
        limit = parsePositiveInteger(argv[index + 1] ?? "", "--limit");
        index += 1;
        break;
      case "--wait-timeout-ms":
        waitTimeoutMs = parsePositiveInteger(argv[index + 1] ?? "", "--wait-timeout-ms");
        index += 1;
        break;
      case "--help":
      case "-h":
        fail(
          [
            "Usage: bun scripts/slo-replay.ts --target-env <staging|prod> [--dry-run] [--journey <journey>] [--limit <n>]",
            `Journeys: ${REPLAY_JOURNEYS.join(", ")}`,
          ].join("\n"),
        );
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  return {
    targetEnv: targetEnv ?? parseTargetEnv(undefined),
    dryRun,
    journey,
    limit,
    waitTimeoutMs,
  };
}

function databaseUrlEnvForTarget(
  targetEnv: TargetEnv,
): "DATABASE_URL_STAGING" | "DATABASE_URL_PROD" {
  return targetEnv === "staging" ? "DATABASE_URL_STAGING" : "DATABASE_URL_PROD";
}

export function normalizeReplayMessage(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function computeReplayDedupeKey(event: SourceReplayEvent): string | null {
  if (event.journey === "coworker_run") {
    return event.coworkerId ? hash({ journey: event.journey, coworkerId: event.coworkerId }) : null;
  }

  const firstUserMessage = normalizeReplayMessage(event.firstUserMessage);
  return firstUserMessage ? hash({ journey: event.journey, firstUserMessage }) : null;
}

export function computeReplayConfigHash(input: {
  targetEnv: TargetEnv;
  targetUserEmail: string;
  journey: ReplayJourney;
}): string {
  return hash({
    version: REPLAY_CONFIG_VERSION,
    targetEnv: input.targetEnv,
    targetUserEmail: input.targetUserEmail.toLowerCase(),
    journey: input.journey,
    coworkerRunDedupe: "coworker_id_only",
    writePolicy: "no_auto_approve",
  });
}

function existingReplayKey(dedupeKey: string, configHash: string): ExistingReplayKey {
  return `${dedupeKey}:${configHash}`;
}

function uniqueStrings(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function selectReplayCandidates(
  events: SourceReplayEvent[],
  options: {
    targetEnv: TargetEnv;
    limit: number;
    existingCompletedReplays: Set<ExistingReplayKey>;
  },
): ReplaySelectionSummary {
  const sorted = events.toSorted((left, right) => right.eventAt.getTime() - left.eventAt.getTime());
  const groups = new Map<string, SourceReplayEvent[]>();
  let skippedMissingDedupeInput = 0;

  for (const event of sorted) {
    const dedupeKey = computeReplayDedupeKey(event);
    if (!dedupeKey) {
      skippedMissingDedupeInput += 1;
      continue;
    }
    const existing = groups.get(dedupeKey) ?? [];
    existing.push(event);
    groups.set(dedupeKey, existing);
  }

  const candidates: ReplayCandidate[] = [];
  let skippedLatestCompleted = 0;
  let skippedAlreadyReplayed = 0;

  for (const [dedupeKey, group] of groups) {
    const latest = group[0];
    if (!latest) {
      continue;
    }
    if (latest.result === "good") {
      skippedLatestCompleted += 1;
      continue;
    }

    const configHash = computeReplayConfigHash({
      targetEnv: options.targetEnv,
      targetUserEmail: latest.targetUserEmail,
      journey: latest.journey,
    });
    if (options.existingCompletedReplays.has(existingReplayKey(dedupeKey, configHash))) {
      skippedAlreadyReplayed += 1;
      continue;
    }

    candidates.push({
      journey: latest.journey,
      dedupeKey,
      configHash,
      targetEnv: options.targetEnv,
      sourceUserId: latest.sourceUserId,
      targetUserEmail: latest.targetUserEmail,
      firstUserMessage: normalizeReplayMessage(latest.firstUserMessage),
      coworkerId: latest.coworkerId,
      model: latest.model,
      authSource: latest.authSource,
      sourceGenerationIds: uniqueStrings(group.map((event) => event.sourceGenerationId)),
      sourceCoworkerRunIds: uniqueStrings(group.map((event) => event.sourceCoworkerRunId)),
      latestEventAt: latest.eventAt,
    });

    if (candidates.length >= options.limit) {
      break;
    }
  }

  return {
    candidates,
    skippedLatestCompleted,
    skippedAlreadyReplayed,
    skippedMissingDedupeInput,
  };
}

async function fetchSourceReplayEvents(
  pool: Pool,
  options: {
    from: Date;
    toExclusive: Date;
    journey?: ReplayJourney;
  },
): Promise<SourceReplayEvent[]> {
  const result = await pool.query(
    `
      with generation_events as (
        select
          coalesce(g.completed_at, g.last_runtime_progress_at, g.started_at) as event_at,
          case
            when exists (
              select 1
              from coworker cw
              where cw.builder_conversation_id = g.conversation_id
            ) then 'coworker_builder'
            when exists (
              select 1
              from coworker_run cr_by_conversation
              left join generation run_generation
                on run_generation.id = cr_by_conversation.generation_id
              where cr_by_conversation.conversation_id = g.conversation_id
                 or run_generation.conversation_id = g.conversation_id
            ) then 'coworker_run'
            when c.type = 'coworker' then null
            else 'chat'
          end as journey,
          case
            when g.status = 'completed' then 'good'
            when g.status = 'cancelled' and coalesce(g.completion_reason, 'user_cancel') in ('user_cancel', 'cancelled') then 'good'
            else 'bad'
          end as result,
          g.id as source_generation_id,
          null::text as source_coworker_run_id,
          c.user_id as source_user_id,
          u.email as target_user_email,
          first_user_message.content as first_user_message,
          null::text as coworker_id,
          c.model as model,
          c.auth_source as auth_source
        from generation g
        join conversation c on c.id = g.conversation_id
        join "user" u on u.id = c.user_id
        left join coworker_run cr on cr.generation_id = g.id
        left join lateral (
          select m.content
          from message m
          where m.conversation_id = g.conversation_id
            and m.role = 'user'
          order by m.created_at asc
          limit 1
        ) first_user_message on true
        where g.status in ('completed', 'error', 'cancelled')
          and cr.id is null
          and coalesce(g.completed_at, g.last_runtime_progress_at, g.started_at) >= $1
          and coalesce(g.completed_at, g.last_runtime_progress_at, g.started_at) < $2
      ),
      coworker_run_events as (
        select
          coalesce(cr.finished_at, cr.started_at) as event_at,
          'coworker_run' as journey,
          case
            when cr.status = 'completed' then 'good'
            when cr.status = 'cancelled' and coalesce(g.completion_reason, 'user_cancel') in ('user_cancel', 'cancelled') then 'good'
            else 'bad'
          end as result,
          cr.generation_id as source_generation_id,
          cr.id as source_coworker_run_id,
          cr.owner_id as source_user_id,
          u.email as target_user_email,
          first_user_message.content as first_user_message,
          cr.coworker_id as coworker_id,
          c.model as model,
          c.auth_source as auth_source
        from coworker_run cr
        join "user" u on u.id = cr.owner_id
        left join generation g on g.id = cr.generation_id
        left join conversation c on c.id = coalesce(cr.conversation_id, g.conversation_id)
        left join lateral (
          select m.content
          from message m
          where m.conversation_id = coalesce(cr.conversation_id, g.conversation_id)
            and m.role = 'user'
          order by m.created_at asc
          limit 1
        ) first_user_message on true
        where cr.status in ('completed', 'error', 'cancelled')
          and coalesce(cr.finished_at, cr.started_at) >= $1
          and coalesce(cr.finished_at, cr.started_at) < $2
      ),
      all_events as (
        select * from generation_events where journey is not null
        union all
        select * from coworker_run_events
      )
      select *
      from all_events
      where target_user_email = any($3::text[])
        and ($4::text is null or journey = $4)
      order by event_at desc
    `,
    [
      options.from,
      options.toExclusive,
      [...SLO_REPLAY_TARGET_EMAIL_ALLOWLIST],
      options.journey ?? null,
    ],
  );

  return result.rows.map((row) => ({
    eventAt: row.event_at instanceof Date ? row.event_at : new Date(row.event_at),
    journey: row.journey,
    result: row.result,
    sourceGenerationId: row.source_generation_id,
    sourceCoworkerRunId: row.source_coworker_run_id,
    sourceUserId: row.source_user_id,
    targetUserEmail: row.target_user_email,
    firstUserMessage: row.first_user_message,
    coworkerId: row.coworker_id,
    model: row.model,
    authSource: row.auth_source,
  }));
}

async function getExistingCompletedReplayKeys(): Promise<Set<ExistingReplayKey>> {
  const rows = await localDb
    .select({
      dedupeKey: sloReplayRun.dedupeKey,
      configHash: sloReplayRun.configHash,
    })
    .from(sloReplayRun)
    .where(eq(sloReplayRun.status, "completed"));
  return new Set(rows.map((row) => existingReplayKey(row.dedupeKey, row.configHash)));
}

function printDryRun(
  flags: SloReplayFlags,
  window: { from: Date; toExclusive: Date },
  selection: ReplaySelectionSummary,
): void {
  console.log("SLO synthetic replay dry-run");
  console.log(
    `targetEnv=${flags.targetEnv} window=${window.from.toISOString()}..${window.toExclusive.toISOString()} limit=${flags.limit}`,
  );
  console.log(
    `selected=${selection.candidates.length} skipped=${
      selection.skippedLatestCompleted +
      selection.skippedAlreadyReplayed +
      selection.skippedMissingDedupeInput
    }`,
  );
  const journeys = flags.journey ? [flags.journey] : [...REPLAY_JOURNEYS];
  for (const journey of journeys) {
    const selected = selection.candidates.filter(
      (candidate) => candidate.journey === journey,
    ).length;
    console.log(`journey=${journey} selected=${selected}`);
  }
  console.log(`skippedLatestCompleted=${selection.skippedLatestCompleted}`);
  console.log(`skippedAlreadyReplayed=${selection.skippedAlreadyReplayed}`);
  console.log(`skippedMissingDedupeInput=${selection.skippedMissingDedupeInput}`);
}

async function markReplaySetupFailed(replayId: string, errorMessage: string): Promise<void> {
  await localDb
    .update(sloReplayRun)
    .set({
      status: "setup_failed",
      errorMessage,
      finishedAt: new Date(),
    })
    .where(eq(sloReplayRun.id, replayId));
}

async function waitForGenerationTerminal(
  generationId: string,
  timeoutMs: number,
): Promise<"completed" | "error" | "cancelled"> {
  const startedAt = Date.now();
  const poll = async (): Promise<"completed" | "error" | "cancelled"> => {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for generation ${generationId}`);
    }
    const row = await localDb.query.generation.findFirst({
      where: eq(generation.id, generationId),
      columns: { status: true },
    });
    if (row?.status === "completed" || row?.status === "error" || row?.status === "cancelled") {
      return row.status;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
    return poll();
  };
  return poll();
}

async function waitForCoworkerRunTerminal(
  runId: string,
  timeoutMs: number,
): Promise<"completed" | "error" | "cancelled"> {
  const startedAt = Date.now();
  const poll = async (): Promise<"completed" | "error" | "cancelled"> => {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for coworker run ${runId}`);
    }
    const row = await localDb.query.coworkerRun.findFirst({
      where: eq(coworkerRun.id, runId),
      columns: { status: true },
    });
    if (row?.status === "completed" || row?.status === "error" || row?.status === "cancelled") {
      return row.status;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
    return poll();
  };
  return poll();
}

function replayStatusFromTerminal(
  status: "completed" | "error" | "cancelled",
): "completed" | "error" {
  return status === "completed" ? "completed" : "error";
}

async function importSyntheticSloSnapshot(): Promise<void> {
  const rows = await localDb
    .select({
      journey: sloReplayRun.journey,
      status: sloReplayRun.status,
      count: sql<number>`count(*)::int`,
    })
    .from(sloReplayRun)
    .where(inArray(sloReplayRun.status, ["completed", "error"]))
    .groupBy(sloReplayRun.journey, sloReplayRun.status);

  const timestampMs = Date.now();
  const samples: SloSample[] = [];
  let globalGood = 0;
  let globalBad = 0;
  for (const row of rows) {
    const result: SloResult = row.status === "completed" ? "good" : "bad";
    const value = Number(row.count);
    samples.push({
      timestampMs,
      journey: row.journey as SloJourney,
      result,
      value,
      traffic: "synthetic",
    });
    if (result === "good") {
      globalGood += value;
    } else {
      globalBad += value;
    }
  }
  samples.push(
    { timestampMs, journey: "global", result: "good", value: globalGood, traffic: "synthetic" },
    { timestampMs, journey: "global", result: "bad", value: globalBad, traffic: "synthetic" },
  );

  await importSloBucketsToVictoriaMetrics(renderPrometheusImportRows(samples), {
    victoriaMetricsUrl: process.env.CMDCLAW_VICTORIA_METRICS_URL,
  });
}

async function insertReplayRun(candidate: ReplayCandidate): Promise<{ id: string } | null> {
  const [row] = await localDb
    .insert(sloReplayRun)
    .values({
      journey: candidate.journey,
      dedupeKey: candidate.dedupeKey,
      configHash: candidate.configHash,
      targetEnv: candidate.targetEnv,
      targetUserEmail: candidate.targetUserEmail,
      targetUserId: candidate.sourceUserId,
      sourceGenerationIds: candidate.sourceGenerationIds,
      sourceCoworkerRunIds: candidate.sourceCoworkerRunIds,
      status: "pending",
    })
    .onConflictDoNothing()
    .returning({ id: sloReplayRun.id });
  return row ?? null;
}

async function executeReplayCandidate(
  candidate: ReplayCandidate,
  flags: SloReplayFlags,
): Promise<void> {
  const replay = await insertReplayRun(candidate);
  if (!replay) {
    console.log(`skip dedupeKey=${candidate.dedupeKey} reason=existing_replay`);
    return;
  }

  await localDb
    .update(sloReplayRun)
    .set({ status: "running" })
    .where(eq(sloReplayRun.id, replay.id));

  const localUser = await localDb.query.user.findFirst({
    where: eq(user.email, candidate.targetUserEmail),
    columns: { id: true, email: true, role: true },
  });
  if (!localUser) {
    await markReplaySetupFailed(replay.id, `Local user not found for ${candidate.targetUserEmail}`);
    return;
  }

  const remoteIntegrationSource = {
    targetEnv: candidate.targetEnv,
    remoteUserId: candidate.sourceUserId,
    requestedByUserId: localUser.id,
    requestedByEmail: localUser.email,
  };

  let executed = false;
  try {
    if (candidate.journey === "coworker_run") {
      if (!candidate.coworkerId) {
        throw new Error("Source coworker run is missing coworker id");
      }
      const localCoworker = await localDb.query.coworker.findFirst({
        where: eq(coworker.id, candidate.coworkerId),
        columns: { id: true },
      });
      if (!localCoworker) {
        throw new Error(`Local coworker not found for ${candidate.coworkerId}`);
      }

      const { triggerCoworkerRun } = await import("@cmdclaw/core/server/services/coworker-service");
      const { generationManager } =
        await import("@cmdclaw/core/server/services/generation-manager");
      const result = await triggerCoworkerRun({
        coworkerId: candidate.coworkerId,
        triggerPayload: { source: "slo_replay" },
        userRole: "admin",
        remoteIntegrationSource,
        autoApprove: false,
        syntheticKind: "slo_replay",
      });
      if (!result.generationId) {
        throw new Error("SLO replay coworker run is waiting for user input");
      }
      executed = true;
      await localDb
        .update(sloReplayRun)
        .set({
          resultGenerationId: result.generationId,
          resultCoworkerRunId: result.runId,
        })
        .where(eq(sloReplayRun.id, replay.id));
      await generationManager.runQueuedGeneration(result.generationId);
      const terminalStatus = await waitForCoworkerRunTerminal(result.runId, flags.waitTimeoutMs);
      await localDb
        .update(sloReplayRun)
        .set({
          status: replayStatusFromTerminal(terminalStatus),
          finishedAt: new Date(),
        })
        .where(eq(sloReplayRun.id, replay.id));
    } else {
      if (!candidate.firstUserMessage) {
        throw new Error("Source generation is missing a first user message");
      }
      const { generationManager } =
        await import("@cmdclaw/core/server/services/generation-manager");
      const result = await generationManager.startGeneration({
        content: candidate.firstUserMessage,
        model: candidate.model ?? undefined,
        authSource:
          candidate.authSource === "user" || candidate.authSource === "shared"
            ? candidate.authSource
            : undefined,
        userId: localUser.id,
        autoApprove: false,
        allowedIntegrations: [...COWORKER_AVAILABLE_INTEGRATION_TYPES] as IntegrationType[],
        remoteIntegrationSource,
        syntheticKind: "slo_replay",
      });
      executed = true;
      await localDb
        .update(sloReplayRun)
        .set({ resultGenerationId: result.generationId })
        .where(eq(sloReplayRun.id, replay.id));
      await generationManager.runQueuedGeneration(result.generationId);
      const terminalStatus = await waitForGenerationTerminal(
        result.generationId,
        flags.waitTimeoutMs,
      );
      await localDb
        .update(sloReplayRun)
        .set({
          status: replayStatusFromTerminal(terminalStatus),
          finishedAt: new Date(),
        })
        .where(eq(sloReplayRun.id, replay.id));
    }

    await importSyntheticSloSnapshot();
  } catch (error) {
    if (!executed) {
      await markReplaySetupFailed(
        replay.id,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    await localDb
      .update(sloReplayRun)
      .set({
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      })
      .where(eq(sloReplayRun.id, replay.id));
    await importSyntheticSloSnapshot().catch(() => undefined);
  }
}

async function executeReplayCandidatesSequentially(
  candidates: ReplayCandidate[],
  flags: SloReplayFlags,
  index = 0,
): Promise<void> {
  const candidate = candidates[index];
  if (!candidate) {
    return;
  }
  console.log(
    `replay journey=${candidate.journey} email=${candidate.targetUserEmail} dedupeKey=${candidate.dedupeKey.slice(0, 12)}`,
  );
  await executeReplayCandidate(candidate, flags);
  return executeReplayCandidatesSequentially(candidates, flags, index + 1);
}

async function run(): Promise<void> {
  const flags = parseSloReplayFlags(process.argv.slice(2));
  const sourceDatabaseUrl = process.env[databaseUrlEnvForTarget(flags.targetEnv)]?.trim();
  if (!sourceDatabaseUrl) {
    fail(`Missing ${databaseUrlEnvForTarget(flags.targetEnv)} in the environment.`);
  }

  const window = resolveSloBackfillWindow();
  const sourcePool = new Pool({ connectionString: sourceDatabaseUrl });
  try {
    const [events, existingCompletedReplays] = await Promise.all([
      fetchSourceReplayEvents(sourcePool, {
        from: window.from,
        toExclusive: window.toExclusive,
        journey: flags.journey,
      }),
      getExistingCompletedReplayKeys(),
    ]);
    const selection = selectReplayCandidates(events, {
      targetEnv: flags.targetEnv,
      limit: flags.limit,
      existingCompletedReplays,
    });

    if (flags.dryRun) {
      printDryRun(flags, window, selection);
      return;
    }

    console.log(
      `SLO synthetic replay targetEnv=${flags.targetEnv} selected=${selection.candidates.length} limit=${flags.limit}`,
    );
    await executeReplayCandidatesSequentially(selection.candidates, flags);
  } finally {
    await sourcePool.end();
    await closePool();
  }
}

if (import.meta.main) {
  void run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
