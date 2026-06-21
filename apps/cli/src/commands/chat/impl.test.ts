import { describe, expect, it } from "vitest";
import {
  hasCompleteRuntimeMetadata,
  printRuntimeMetadata,
  shouldAutoResumePausedRunDeadline,
  shouldContinueAfterInitialMessage,
  shouldPrintRuntimeMetadata,
} from "./impl";

describe("runtime metadata markers", () => {
  it("treats partial id-only metadata as incomplete", () => {
    expect(
      hasCompleteRuntimeMetadata({
        runtimeId: "runtime-1",
        sandboxId: "sandbox-1",
      }),
    ).toBe(false);
    expect(
      shouldPrintRuntimeMetadata({
        runtimeId: "runtime-1",
        sandboxId: "sandbox-1",
      }),
    ).toBe(false);
  });

  it("treats bound runtime metadata as complete", () => {
    expect(
      hasCompleteRuntimeMetadata({
        runtimeId: "runtime-1",
        sandboxId: "sandbox-1",
        sandboxProvider: "e2b",
        runtimeHarness: "opencode",
        runtimeProtocolVersion: "opencode-v2",
        sessionId: "session-1",
      }),
    ).toBe(true);
  });

  it("does not print incomplete runtime metadata markers", () => {
    let output = "";
    const stdout = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    printRuntimeMetadata(
      stdout,
      {},
      {
        runtimeId: "runtime-1",
        sandboxId: "sandbox-1",
      },
    );

    expect(output).toBe("");
  });

  it("prints complete runtime metadata markers once", () => {
    let output = "";
    const stdout = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const metadata = {
      runtimeId: "runtime-1",
      sandboxId: "sandbox-1",
      sandboxProvider: "e2b",
      runtimeHarness: "opencode",
      runtimeProtocolVersion: "opencode-v2",
      sessionId: "session-1",
    } as const;

    const printed = {};
    printRuntimeMetadata(stdout, printed, metadata);
    printRuntimeMetadata(stdout, printed, metadata);

    expect(output).toBe(
      "[runtime] id=runtime-1 harness=opencode protocol=opencode-v2\n" +
        "[sandbox] provider=e2b id=sandbox-1 session=session-1\n",
    );
  });

  it("auto-resumes only paused run-deadline generations", () => {
    expect(
      shouldAutoResumePausedRunDeadline({
        status: "paused",
        pauseReason: "run_deadline",
      }),
    ).toBe(true);
    expect(
      shouldAutoResumePausedRunDeadline({
        status: "paused",
        pauseReason: "approval_timeout",
      }),
    ).toBe(false);
    expect(
      shouldAutoResumePausedRunDeadline({
        status: "awaiting_auth",
        pauseReason: "run_deadline",
      }),
    ).toBe(false);
  });

  it("keeps --message interactive by default when stdio is a tty", () => {
    expect(shouldContinueAfterInitialMessage(undefined)).toBe(true);
    expect(shouldContinueAfterInitialMessage(true)).toBe(true);
    expect(shouldContinueAfterInitialMessage(false)).toBe(false);
  });
});
