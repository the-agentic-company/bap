import { describe, expect, it } from "vitest";
import {
  filterLocallyResolvedPendingApprovalSegments,
  filterResolvedDuplicateApprovalSegments,
  getApprovalLocalResolutionKeys,
} from "./approval-segment-filter";

describe("filterResolvedDuplicateApprovalSegments", () => {
  it("removes pending approvals that share a resolved interrupt id", () => {
    const segments = filterResolvedDuplicateApprovalSegments([
      {
        id: "approved",
        items: [],
        approval: {
          interruptId: "interrupt-question-1",
          toolUseId: "tool-approved",
          status: "approved" as const,
        },
      },
      {
        id: "stale-pending",
        items: [],
        approval: {
          interruptId: "interrupt-question-1",
          toolUseId: "tool-pending",
          status: "pending" as const,
        },
      },
    ]);

    expect(segments.map((segment) => segment.id)).toEqual(["approved"]);
  });

  it("removes pending approvals that share a resolved tool use id", () => {
    const segments = filterResolvedDuplicateApprovalSegments([
      {
        id: "approved",
        items: [],
        approval: {
          interruptId: undefined,
          toolUseId: "tool-question-1",
          status: "approved" as const,
        },
      },
      {
        id: "stale-pending",
        items: [],
        approval: {
          interruptId: "interrupt-question-2",
          toolUseId: "tool-question-1",
          status: "pending" as const,
        },
      },
    ]);

    expect(segments.map((segment) => segment.id)).toEqual(["approved"]);
  });

  it("keeps distinct pending approvals", () => {
    const segments = filterResolvedDuplicateApprovalSegments([
      {
        id: "approved",
        items: [],
        approval: {
          interruptId: "interrupt-question-1",
          toolUseId: "tool-approved",
          status: "approved" as const,
        },
      },
      {
        id: "pending",
        items: [],
        approval: {
          interruptId: "interrupt-question-2",
          toolUseId: "tool-pending",
          status: "pending" as const,
        },
      },
    ]);

    expect(segments.map((segment) => segment.id)).toEqual(["approved", "pending"]);
  });
});

describe("filterLocallyResolvedPendingApprovalSegments", () => {
  it("removes pending approvals submitted locally by interrupt id", () => {
    const segments = filterLocallyResolvedPendingApprovalSegments(
      [
        {
          id: "locally-submitted",
          items: [],
          approval: {
            interruptId: "interrupt-question-1",
            toolUseId: "tool-question-1",
            status: "pending" as const,
          },
        },
        {
          id: "still-pending",
          items: [],
          approval: {
            interruptId: "interrupt-question-2",
            toolUseId: "tool-question-2",
            status: "pending" as const,
          },
        },
      ],
      new Set(["interrupt:interrupt-question-1"]),
    );

    expect(segments.map((segment) => segment.id)).toEqual(["still-pending"]);
  });

  it("removes repeated pending question approvals by payload when runtime ids change", () => {
    const submittedApproval = {
      interruptId: "interrupt-question-1",
      toolUseId: "tool-question-1",
      toolName: "question",
      integration: "cmdclaw",
      operation: "question",
      toolInput: {
        questions: [
          {
            header: "Current task",
            question: "What are you working on right now?",
            options: [{ label: "Work" }],
          },
        ],
      },
      status: "pending" as const,
    };
    const repeatedApproval = {
      ...submittedApproval,
      interruptId: "interrupt-question-2",
      toolUseId: "tool-question-2",
    };

    const segments = filterLocallyResolvedPendingApprovalSegments(
      [{ id: "repeated-pending", items: [], approval: repeatedApproval }],
      new Set(getApprovalLocalResolutionKeys(submittedApproval)),
    );

    expect(segments).toEqual([]);
  });

  it("keeps distinct pending question approvals with different payloads", () => {
    const submittedApproval = {
      interruptId: "interrupt-question-1",
      toolUseId: "tool-question-1",
      toolName: "question",
      integration: "cmdclaw",
      operation: "question",
      toolInput: {
        questions: [{ header: "Current task", question: "Pick one", options: [] }],
      },
      status: "pending" as const,
    };
    const nextApproval = {
      interruptId: "interrupt-question-2",
      toolUseId: "tool-question-2",
      toolName: "question",
      integration: "cmdclaw",
      operation: "question",
      toolInput: {
        questions: [{ header: "Next task", question: "Pick another", options: [] }],
      },
      status: "pending" as const,
    };

    const segments = filterLocallyResolvedPendingApprovalSegments(
      [{ id: "next-pending", items: [], approval: nextApproval }],
      new Set(getApprovalLocalResolutionKeys(submittedApproval)),
    );

    expect(segments.map((segment) => segment.id)).toEqual(["next-pending"]);
  });
});
