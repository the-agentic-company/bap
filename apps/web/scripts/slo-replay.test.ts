import { describe, expect, it, vi } from "vitest";
import { parseSloReplayFlags } from "./slo-replay";

describe("slo-replay", () => {
  it("accepts only concrete SLO journeys for replay filtering", () => {
    expect(
      parseSloReplayFlags(["--target-env", "staging", "--journey", "coworker_run"]),
    ).toMatchObject({
      targetEnv: "staging",
      journey: "coworker_run",
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as typeof process.exit);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      parseSloReplayFlags(["--target-env", "staging", "--journey", "unknown_coworker_generation"]),
    ).toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledWith(
      "--journey must be one of: chat, coworker_builder, coworker_run",
    );

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
