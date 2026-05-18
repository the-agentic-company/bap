import { describe, expect, it } from "vitest";
import { buildFailureAlertSignature, normalizeFailureAlertError } from "./failure-alert-service";

describe("failure alert grouping", () => {
  it("normalizes volatile ids and timestamps out of error messages", () => {
    const first = normalizeFailureAlertError(
      "session.messages returned 404 for session sess_abc123def456 at 2026-05-18T04:12:45.123Z request req_123456789abcdef",
    );
    const second = normalizeFailureAlertError(
      "session.messages returned 404 for session sess_zxy987uvw654 at 2026-05-18T04:13:10.456Z request req_fedcba987654321",
    );

    expect(first).toBe(second);
    expect(first).toBe(
      "session.messages returned 404 for session sess-<id> at <timestamp> request req-<id>",
    );
  });

  it("keeps model in the conservative grouping signature", () => {
    const base = {
      environment: "prod",
      kind: "chat" as const,
      journey: "chat",
      completionReason: "runtime_error",
      normalizedError: "runtime ended in non-terminal state",
      runtimeHarness: "opencode",
      sandboxProvider: "daytona",
    };

    const claude = buildFailureAlertSignature({ ...base, model: "claude-sonnet-4-6" });
    const gpt = buildFailureAlertSignature({ ...base, model: "openai/gpt-5.4" });

    expect(claude.signatureHash).not.toBe(gpt.signatureHash);
  });

  it("keeps chat and coworker failures in separate groups", () => {
    const base = {
      environment: "staging",
      journey: "chat",
      completionReason: "runtime_error",
      normalizedError: "Executor status check failed",
      model: "claude-sonnet-4-6",
      runtimeHarness: "opencode",
      sandboxProvider: "docker",
    };

    const chat = buildFailureAlertSignature({ ...base, kind: "chat" as const });
    const coworker = buildFailureAlertSignature({
      ...base,
      kind: "coworker" as const,
      journey: "coworker",
    });

    expect(chat.signatureHash).not.toBe(coworker.signatureHash);
  });
});
