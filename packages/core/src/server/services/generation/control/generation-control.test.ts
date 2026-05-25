import { describe, expect, it } from "vitest";
import { getExecutionPolicyFromRecord } from "./generation-control";

describe("getExecutionPolicyFromRecord", () => {
  it("preserves runtime no-progress debug policy fields", () => {
    const policy = getExecutionPolicyFromRecord(
      {
        executionPolicy: {
          autoApprove: false,
          allowSnapshotRestoreOnRun: false,
          debugRuntimeNoProgressTimeoutMs: 1_000,
          debugForceRuntimeNoProgressAfterPrompt: true,
        },
      } as never,
      true,
    );

    expect(policy).toEqual(
      expect.objectContaining({
        autoApprove: false,
        allowSnapshotRestoreOnRun: false,
        debugRuntimeNoProgressTimeoutMs: 1_000,
        debugForceRuntimeNoProgressAfterPrompt: true,
      }),
    );
  });
});
