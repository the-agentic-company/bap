// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GenerationRuntime } from "@/lib/generation-runtime";
import {
  RUN_DEADLINE_RESUME_TOOL_USE_ID,
  type ActivitySegment,
} from "./chat-generation-interrupts";
import { useChatGenerationInterruptActions } from "./use-chat-generation-interrupt-actions";

const mockRuntimeMethod = () => vi.fn<(...args: unknown[]) => unknown>();

function createRuntime() {
  return {
    setApprovalStatus: mockRuntimeMethod(),
    setAuthCancelled: mockRuntimeMethod(),
    setAuthConnecting: mockRuntimeMethod(),
    setAuthPending: mockRuntimeMethod(),
  } as unknown as GenerationRuntime & {
    setApprovalStatus: ReturnType<typeof vi.fn>;
  };
}

function renderInterruptActions({
  displaySegments,
  runtime = createRuntime(),
  submitApproval = vi.fn<
    (input: {
      interruptId: string;
      decision: "approve" | "deny";
      questionAnswers?: string[][];
    }) => Promise<unknown>
  >(
    async (_input: {
      interruptId: string;
      decision: "approve" | "deny";
      questionAnswers?: string[][];
    }) => undefined,
  ),
  handleResumePausedRunDeadline = vi.fn<() => Promise<void>>(async () => undefined),
}: {
  displaySegments: ActivitySegment[];
  runtime?: ReturnType<typeof createRuntime> | null;
  submitApproval?: (input: {
    interruptId: string;
    decision: "approve" | "deny";
    questionAnswers?: string[][];
  }) => Promise<unknown>;
  handleResumePausedRunDeadline?: () => Promise<void>;
}) {
  const hook = renderHook(() =>
    useChatGenerationInterruptActions({
      activeGeneration: { generationId: "generation-1" },
      displaySegments,
      getAuthUrl: vi.fn<Parameters<typeof useChatGenerationInterruptActions>[0]["getAuthUrl"]>(
        async () => ({ authUrl: "https://auth.test" }),
      ),
      handleResumePausedRunDeadline,
      interactiveConversationId: "conversation-1",
      optimisticallyResumeInterruptedGeneration:
        vi.fn<
          (
            interruptId: string,
            kind: "approval" | "auth",
            options?: { connectedIntegration?: string; questionAnswers?: string[][] },
          ) => void
        >(),
      pendingRunDeadlineResume: {
        generationId: "generation-1",
        debugRunDeadlineMs: null,
      },
      runtimeRef: { current: runtime },
      setDismissedRunDeadlineGenerationId: vi.fn<(value: unknown) => void>(),
      setHistoricalActivityBlocks: vi.fn<(value: unknown) => void>(),
      setLocallyResolvedApprovalKeys: vi.fn<(value: unknown) => void>(),
      setPendingRunDeadlineResume: vi.fn<(value: unknown) => void>(),
      setStreamError: vi.fn<(value: unknown) => void>(),
      submitApproval,
      submitAuthResult: vi.fn<
        (input: { interruptId: string; integration: string; success: boolean }) => Promise<unknown>
      >(async () => undefined),
      syncFromRuntime: vi.fn<(runtime: GenerationRuntime) => void>(),
    }),
  );

  return {
    handleResumePausedRunDeadline,
    result: hook.result,
    runtime,
    submitApproval,
  };
}

describe("useChatGenerationInterruptActions", () => {
  it("submits approval decisions and updates local runtime approval status", async () => {
    const approvalSegment: ActivitySegment = {
      id: "approval-segment",
      items: [],
      isExpanded: false,
      approval: {
        interruptId: "approval-1",
        toolUseId: "tool-1",
        toolName: "github.create_issue",
        toolInput: {},
        integration: "github",
        operation: "create_issue",
        status: "pending",
      },
    };
    const { result, runtime, submitApproval } = renderInterruptActions({
      displaySegments: [approvalSegment],
    });

    await act(async () => {
      result.current.segmentApproveHandlers.get("approval-segment")?.([["yes"]]);
    });

    expect(submitApproval).toHaveBeenCalledWith({
      interruptId: "approval-1",
      decision: "approve",
      questionAnswers: [["yes"]],
    });
    expect(runtime?.setApprovalStatus).toHaveBeenCalledWith("tool-1", "approved", [["yes"]]);
  });

  it("submits denial decisions and updates local runtime approval status", async () => {
    const approvalSegment: ActivitySegment = {
      id: "approval-segment",
      items: [],
      isExpanded: false,
      approval: {
        interruptId: "approval-1",
        toolUseId: "tool-1",
        toolName: "github.create_issue",
        toolInput: {},
        integration: "github",
        operation: "create_issue",
        status: "pending",
      },
    };
    const { result, runtime, submitApproval } = renderInterruptActions({
      displaySegments: [approvalSegment],
    });

    await act(async () => {
      result.current.segmentDenyHandlers.get("approval-segment")?.();
    });

    expect(submitApproval).toHaveBeenCalledWith({
      interruptId: "approval-1",
      decision: "deny",
    });
    expect(runtime?.setApprovalStatus).toHaveBeenCalledWith("tool-1", "denied");
  });

  it("routes run-deadline resume approvals to the resume action", async () => {
    const resumeSegment: ActivitySegment = {
      id: "resume-segment",
      items: [],
      isExpanded: false,
      approval: {
        interruptId: undefined,
        toolUseId: RUN_DEADLINE_RESUME_TOOL_USE_ID,
        toolName: "question",
        toolInput: {},
        integration: "bap",
        operation: "question",
        status: "pending",
      },
    };
    const { handleResumePausedRunDeadline, result, submitApproval } = renderInterruptActions({
      displaySegments: [resumeSegment],
    });

    await act(async () => {
      result.current.segmentApproveHandlers.get("resume-segment")?.();
    });

    expect(handleResumePausedRunDeadline).toHaveBeenCalledTimes(1);
    expect(submitApproval).not.toHaveBeenCalled();
  });
});
