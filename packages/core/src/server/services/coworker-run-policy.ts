import type { coworkerRunStatusEnum, coworkerStatusEnum } from "@bap/db/schema";

export type CoworkerStartKind = "user_intent" | "external_trigger";
export type CoworkerStatus = (typeof coworkerStatusEnum.enumValues)[number];
export type CoworkerRunStatus = (typeof coworkerRunStatusEnum.enumValues)[number];
export type CoworkerAutoDisableReason = "run_backlog_limit";

export const COWORKER_RUN_BACKLOG_LIMIT = 5;
export const COWORKER_RUN_BACKLOG_STATUSES = [
  "needs_user_input",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
] as const satisfies readonly CoworkerRunStatus[];

export const NON_TERMINAL_COWORKER_RUN_STATUSES = [
  "needs_user_input",
  "running",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "cancelling",
] as const satisfies readonly CoworkerRunStatus[];

export type CoworkerStartDecision =
  | { type: "allow" }
  | { type: "blocked_running" }
  | { type: "blocked_off" }
  | { type: "auto_disable_due_to_backlog"; limit: number };

export function decideCoworkerStart(input: {
  startKind: CoworkerStartKind;
  coworkerStatus: CoworkerStatus;
  runningRunCount: number;
  backlogRunCount: number;
  backlogLimit?: number;
}): CoworkerStartDecision {
  if (input.runningRunCount > 0) {
    return { type: "blocked_running" };
  }

  if (input.startKind === "user_intent") {
    return { type: "allow" };
  }

  if (input.coworkerStatus !== "on") {
    return { type: "blocked_off" };
  }

  const limit = input.backlogLimit ?? COWORKER_RUN_BACKLOG_LIMIT;
  if (input.backlogRunCount >= limit) {
    return { type: "auto_disable_due_to_backlog", limit };
  }

  return { type: "allow" };
}

export function isCoworkerRunBacklogStatus(
  status: CoworkerRunStatus,
): status is (typeof COWORKER_RUN_BACKLOG_STATUSES)[number] {
  return COWORKER_RUN_BACKLOG_STATUSES.includes(
    status as (typeof COWORKER_RUN_BACKLOG_STATUSES)[number],
  );
}

export function isNonTerminalCoworkerRunStatus(
  status: CoworkerRunStatus,
): status is (typeof NON_TERMINAL_COWORKER_RUN_STATUSES)[number] {
  return NON_TERMINAL_COWORKER_RUN_STATUSES.includes(
    status as (typeof NON_TERMINAL_COWORKER_RUN_STATUSES)[number],
  );
}
