import { describe, expect, it } from "vitest";
import { summarizeHeapSamplingProfile } from "./heap-sampling";

describe("summarizeHeapSamplingProfile", () => {
  it("aggregates duplicate allocation sites and returns the largest first", () => {
    const profile = {
      head: {
        callFrame: { functionName: "root", url: "", lineNumber: 0 },
        selfSize: 0,
        children: [
          {
            callFrame: {
              functionName: "retainGeneration",
              url: "file:///app/packages/core/generation.ts",
              lineNumber: 9,
            },
            selfSize: 20,
            children: [],
          },
          {
            callFrame: {
              functionName: "retainGeneration",
              url: "file:///app/packages/core/generation.ts",
              lineNumber: 9,
            },
            selfSize: 30,
            children: [],
          },
          {
            callFrame: {
              functionName: "smallAllocation",
              url: "node:internal/test",
              lineNumber: 3,
            },
            selfSize: 10,
            children: [],
          },
        ],
      },
    };

    expect(summarizeHeapSamplingProfile(profile, 1)).toEqual([
      {
        allocationSite: "retainGeneration (app/packages/core/generation.ts:10)",
        sampledBytes: 50,
      },
    ]);
  });
});
