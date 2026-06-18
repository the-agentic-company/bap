import { describe, expect, it } from "vitest";
import {
  buildHistoricalActivityBlock,
  buildHistoricalActivityBlockFromContentParts,
  buildRunDeadlineResumeSegment,
  markResolvedApprovalInterruptInSegments,
  markResolvedAuthInterruptInSegments,
  stripResolvedInterruptFromSegments,
  RUN_DEADLINE_RESUME_TOOL_USE_ID,
  type ActivitySegment,
} from "./chat-generation-interrupts";

const pendingSegment: ActivitySegment = {
  id: "segment-1",
  items: [],
  isExpanded: false,
  approval: {
    interruptId: "approval-1",
    toolUseId: "tool-1",
    toolName: "question",
    toolInput: { question: "Proceed?" },
    integration: "bap",
    operation: "question",
    status: "pending",
  },
  auth: {
    interruptId: "auth-1",
    integrations: ["github", "slack"],
    connectedIntegrations: [],
    status: "pending",
  },
};

describe("interrupt segment helpers", () => {
  it("marks approval and auth interrupts as locally resolved", () => {
    expect(
      markResolvedApprovalInterruptInSegments([pendingSegment], "approval-1", [["yes"]])[0]
        ?.approval,
    ).toMatchObject({
      interruptId: undefined,
      status: "approved",
      questionAnswers: [["yes"]],
    });

    expect(
      markResolvedAuthInterruptInSegments([pendingSegment], "auth-1", "github")[0]?.auth,
    ).toMatchObject({
      connectedIntegrations: ["github"],
      integrations: ["github", "slack"],
      status: "connecting",
    });

    expect(
      markResolvedAuthInterruptInSegments(
        [
          {
            ...pendingSegment,
            auth: {
              ...pendingSegment.auth!,
              connectedIntegrations: ["github"],
            },
          },
        ],
        "auth-1",
        "slack",
      )[0]?.auth,
    ).toMatchObject({
      connectedIntegrations: ["github", "slack"],
      status: "completed",
    });
  });

  it("strips resolved interrupt state and drops empty interrupt-only segments", () => {
    expect(
      stripResolvedInterruptFromSegments([pendingSegment], "approval-1", "approval")[0],
    ).toMatchObject({
      id: "segment-1",
      approval: undefined,
    });

    expect(
      stripResolvedInterruptFromSegments(
        [
          { id: "empty", items: [], approval: pendingSegment.approval, isExpanded: false },
          {
            id: "other",
            items: [
              {
                id: "item-1",
                type: "text",
                timestamp: 1,
                content: "still visible",
              },
            ],
            isExpanded: false,
          },
        ],
        "approval-1",
        "approval",
      ).map((segment) => segment.id),
    ).toEqual(["other"]);
  });
});

describe("run-deadline helpers", () => {
  it("builds a synthetic resume approval segment", () => {
    const segment = buildRunDeadlineResumeSegment({
      generationId: "generation-1",
      debugRunDeadlineMs: 60_000,
    });

    expect(segment).toMatchObject({
      id: "runtime-deadline-resume",
      approval: {
        toolUseId: RUN_DEADLINE_RESUME_TOOL_USE_ID,
        toolName: "question",
        integration: "bap",
        operation: "question",
        status: "pending",
      },
    });
  });

  it("creates historical activity blocks from snapshots and persisted content parts", () => {
    const fromSnapshot = buildHistoricalActivityBlock({
      generationId: "generation-1",
      runtimeLimitMs: 60_000,
      snapshot: {
        parts: [],
        segments: [
          {
            id: "segment-1",
            items: [
              {
                id: "item-1",
                type: "tool_call",
                timestamp: 1,
                content: "GitHub",
                status: "complete",
                integration: "github",
              },
            ],
            isExpanded: false,
          },
        ],
        integrationsUsed: ["github"],
        sandboxFiles: [],
        traceStatus: "complete",
      },
    });

    expect(fromSnapshot).toMatchObject({
      id: "historical-generation-1",
      generationId: "generation-1",
      runtimeLimitMs: 60_000,
      awaitingResume: true,
      integrationsUsed: ["github"],
    });

    const fromContentParts = buildHistoricalActivityBlockFromContentParts({
      generationId: "generation-2",
      runtimeLimitMs: null,
      contentParts: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "bash",
          input: { command: "echo hi" },
          integration: "github",
          operation: "run",
        },
        { type: "tool_result", tool_use_id: "tool-1", content: "done" },
      ],
    });

    expect(fromContentParts).toMatchObject({
      id: "historical-generation-2",
      generationId: "generation-2",
      awaitingResume: true,
      integrationsUsed: ["github"],
    });
  });
});
