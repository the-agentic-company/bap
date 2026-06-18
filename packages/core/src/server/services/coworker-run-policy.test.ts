import { describe, expect, it } from "vitest";
import {
  COWORKER_RUN_BACKLOG_LIMIT,
  decideCoworkerStart,
  isCoworkerRunBacklogStatus,
  isNonTerminalCoworkerRunStatus,
} from "./coworker-run-policy";

describe("coworker run policy", () => {
  it("allows user-intent starts when only backlog runs exist", () => {
    expect(
      decideCoworkerStart({
        startKind: "user_intent",
        coworkerStatus: "off",
        runningRunCount: 0,
        backlogRunCount: COWORKER_RUN_BACKLOG_LIMIT,
      }),
    ).toEqual({ type: "allow" });
  });

  it("blocks every start while a run is actually running", () => {
    expect(
      decideCoworkerStart({
        startKind: "user_intent",
        coworkerStatus: "on",
        runningRunCount: 1,
        backlogRunCount: 0,
      }),
    ).toEqual({ type: "blocked_running" });
    expect(
      decideCoworkerStart({
        startKind: "external_trigger",
        coworkerStatus: "on",
        runningRunCount: 1,
        backlogRunCount: 5,
      }),
    ).toEqual({ type: "blocked_running" });
  });

  it("blocks external triggers while the coworker is off", () => {
    expect(
      decideCoworkerStart({
        startKind: "external_trigger",
        coworkerStatus: "off",
        runningRunCount: 0,
        backlogRunCount: 0,
      }),
    ).toEqual({ type: "blocked_off" });
  });

  it("auto-disables external triggers at the backlog limit", () => {
    expect(
      decideCoworkerStart({
        startKind: "external_trigger",
        coworkerStatus: "on",
        runningRunCount: 0,
        backlogRunCount: COWORKER_RUN_BACKLOG_LIMIT,
      }),
    ).toEqual({ type: "auto_disable_due_to_backlog", limit: COWORKER_RUN_BACKLOG_LIMIT });
  });

  it("keeps running and cancelling out of backlog while treating cancelling as non-terminal", () => {
    expect(isCoworkerRunBacklogStatus("running")).toBe(false);
    expect(isCoworkerRunBacklogStatus("cancelling")).toBe(false);
    expect(isCoworkerRunBacklogStatus("paused")).toBe(true);
    expect(isNonTerminalCoworkerRunStatus("cancelling")).toBe(true);
    expect(isNonTerminalCoworkerRunStatus("completed")).toBe(false);
  });
});
