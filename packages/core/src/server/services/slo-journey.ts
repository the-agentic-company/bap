import { db } from "@cmdclaw/db/client";
import { coworker, coworkerRun } from "@cmdclaw/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { logServerEvent, recordCounter } from "../utils/observability";
import {
  classifySloResult,
  classifySloTerminalEvent,
  resolveSloTraffic,
  type SloMetricSample,
} from "./slo-journey-classification";

export {
  classifySloResult,
  classifySloTerminalEvent,
  resolveSloTraffic,
  SLO_CONCRETE_JOURNEYS,
  SLO_METRIC_JOURNEYS,
  SLO_RESULTS,
  SLO_TRAFFIC_TYPES,
} from "./slo-journey-classification";
export type {
  SloConcreteJourney,
  SloMetricJourney,
  SloResult,
  SloTraffic,
  SloMetricSample,
  SloTerminalFacts,
} from "./slo-journey-classification";

export type GenerationSloTerminalFacts = {
  generationId: string;
  conversationId: string;
  conversationType?: string | null;
  status: string;
  completionReason?: string | null;
  syntheticKind?: string | null;
};

export type CoworkerRunSloTerminalFacts = {
  coworkerRunId: string;
  status: string;
  completionReason?: string | null;
  syntheticKind?: string | null;
};

export function recordSloMetricSamples(samples: SloMetricSample[]): void {
  for (const sample of samples) {
    recordCounter(
      "cmdclaw_slo_events_total",
      1,
      {
        journey: sample.journey,
        result: sample.result,
        traffic: sample.traffic,
      },
      "Terminal SLO Journey outcomes by bounded journey, result, and traffic provenance.",
    );
  }
}

export async function emitCoworkerRunSloTerminalEvent(
  facts: CoworkerRunSloTerminalFacts,
): Promise<boolean> {
  const claimed = await db
    .update(coworkerRun)
    .set({ sloEmittedAt: new Date() })
    .where(and(eq(coworkerRun.id, facts.coworkerRunId), isNull(coworkerRun.sloEmittedAt)))
    .returning({ id: coworkerRun.id });

  if (claimed.length === 0) {
    return false;
  }

  try {
    recordSloMetricSamples(
      classifySloTerminalEvent({
        journey: "coworker_run",
        status: facts.status,
        completionReason: facts.completionReason,
        traffic: resolveSloTraffic(facts.syntheticKind),
      }),
    );
  } catch (error) {
    await db
      .update(coworkerRun)
      .set({ sloEmittedAt: null })
      .where(eq(coworkerRun.id, facts.coworkerRunId));
    throw error;
  }

  return true;
}

export async function emitGenerationSloTerminalEvent(
  facts: GenerationSloTerminalFacts,
): Promise<void> {
  const run = await db.query.coworkerRun.findFirst({
    where: eq(coworkerRun.generationId, facts.generationId),
    columns: {
      id: true,
      syntheticKind: true,
    },
  });

  if (run) {
    await emitCoworkerRunSloTerminalEvent({
      coworkerRunId: run.id,
      status: facts.status,
      completionReason: facts.completionReason,
      syntheticKind: run.syntheticKind,
    });
    return;
  }

  const builder = await db.query.coworker.findFirst({
    where: eq(coworker.builderConversationId, facts.conversationId),
    columns: { id: true },
  });

  if (builder) {
    recordSloMetricSamples(
      classifySloTerminalEvent({
        journey: "coworker_builder",
        status: facts.status,
        completionReason: facts.completionReason,
        traffic: resolveSloTraffic(facts.syntheticKind),
      }),
    );
    return;
  }

  if (facts.conversationType === "coworker") {
    logServerEvent(
      "warn",
      "SLO_JOURNEY_UNCLASSIFIED_COWORKER_GENERATION",
      {
        generationId: facts.generationId,
        conversationId: facts.conversationId,
      },
      { source: "slo-journey" },
    );
    return;
  }

  recordSloMetricSamples(
    classifySloTerminalEvent({
      journey: "chat",
      status: facts.status,
      completionReason: facts.completionReason,
      traffic: resolveSloTraffic(facts.syntheticKind),
    }),
  );
}

export async function emitPreGenerationCoworkerRunFailureSloEvent(input: {
  coworkerRunId: string;
  coworkerId: string;
  ownerId: string;
  workspaceId?: string | null;
  syntheticKind?: string | null;
  normalizedErrorCode: string;
}): Promise<boolean> {
  logServerEvent(
    "error",
    "COWORKER_RUN_PRE_GENERATION_FAILURE",
    {
      coworkerId: input.coworkerId,
      coworkerRunId: input.coworkerRunId,
      workspaceId: input.workspaceId ?? null,
      terminalReason: "start_generation_failed",
      normalizedErrorCode: input.normalizedErrorCode,
    },
    {
      source: "coworker-service",
      userId: input.ownerId,
    },
  );

  return emitCoworkerRunSloTerminalEvent({
    coworkerRunId: input.coworkerRunId,
    status: "error",
    completionReason: "start_generation_failed",
    syntheticKind: input.syntheticKind,
  });
}

export type { SloReplayJourney } from "@cmdclaw/db/schema";
