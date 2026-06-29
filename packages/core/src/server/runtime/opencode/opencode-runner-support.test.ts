import { describe, expect, it } from "vitest";
import type { GenerationContext, GenerationDebugInfo } from "../../services/generation/types";
import {
  resolveSandboxMissingUserMessage,
  SANDBOX_CAPACITY_LIMIT_USER_MESSAGE,
  SANDBOX_MISSING_USER_MESSAGE,
} from "./opencode-runner-support";

function ctxWithDebugInfo(debugInfo?: GenerationDebugInfo): GenerationContext {
  return { debugInfo } as unknown as GenerationContext;
}

describe("resolveSandboxMissingUserMessage", () => {
  it("returns the capacity message for a Daytona capacity rejection", () => {
    const ctx = ctxWithDebugInfo({
      originalErrorName: "DaytonaValidationError",
      originalErrorMessage: "Total CPU limit exceeded. Maximum allowed: 250",
    });
    expect(resolveSandboxMissingUserMessage(ctx)).toBe(SANDBOX_CAPACITY_LIMIT_USER_MESSAGE);
  });

  it("keeps the generic message for a non-capacity DaytonaValidationError", () => {
    const ctx = ctxWithDebugInfo({
      originalErrorName: "DaytonaValidationError",
      originalErrorMessage: "Workspace not found",
    });
    expect(resolveSandboxMissingUserMessage(ctx)).toBe(SANDBOX_MISSING_USER_MESSAGE);
  });

  it("keeps the generic message when the error is not a Daytona validation error", () => {
    const ctx = ctxWithDebugInfo({
      originalErrorName: "TypeError",
      originalErrorMessage: "Total CPU limit exceeded",
    });
    expect(resolveSandboxMissingUserMessage(ctx)).toBe(SANDBOX_MISSING_USER_MESSAGE);
  });

  it("keeps the generic message when debugInfo or its fields are absent", () => {
    expect(resolveSandboxMissingUserMessage(ctxWithDebugInfo())).toBe(SANDBOX_MISSING_USER_MESSAGE);
    expect(
      resolveSandboxMissingUserMessage(
        ctxWithDebugInfo({ originalErrorName: null, originalErrorMessage: null }),
      ),
    ).toBe(SANDBOX_MISSING_USER_MESSAGE);
  });
});
