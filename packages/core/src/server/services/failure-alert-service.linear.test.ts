import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: dbMock,
}));

function mockSelects(group: Record<string, unknown>, occurrences: Array<Record<string, unknown>>) {
  dbMock.select
    .mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: async () => [group],
        }),
      }),
    })
    .mockReturnValueOnce({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => occurrences,
          }),
        }),
      }),
    });
}

function mockUpdate() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  dbMock.update.mockReturnValue({ set });
  return { set, where };
}

function buildGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: "group-1",
    environment: "prod",
    kind: "chat",
    journey: "chat",
    occurrenceCount: 1,
    firstSeenAt: new Date("2026-05-18T05:00:00.000Z"),
    lastSeenAt: new Date("2026-05-18T05:01:00.000Z"),
    completionReason: "runtime_error",
    model: "claude-sonnet-4-6",
    runtimeHarness: "opencode",
    sandboxProvider: "daytona",
    normalizedError: "session.messages returned 404 for session sess-<id>",
    title: "Chat failure: session.messages returned 404 for session sess-<id>",
    linearIssueId: null,
    linearIssueIdentifier: null,
    linearIssueUrl: null,
    lastCommentedOccurrenceCount: 0,
    ...overrides,
  };
}

function buildOccurrence(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conv-1",
    generationId: "gen-1",
    userEmail: "user@example.com",
    userId: "user-1",
    traceId: "trace-1",
    failedAt: new Date("2026-05-18T05:01:00.000Z"),
    ...overrides,
  };
}

function createLinearFetchRecorder() {
  const operations: string[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
    const query = body.query ?? "";

    if (query.includes("query Teams")) {
      operations.push("Teams");
      return Response.json({
        data: { teams: { nodes: [{ id: "team-1", key: "OPS", name: "Operations" }] } },
      });
    }
    if (query.includes("query TeamLabels")) {
      operations.push("TeamLabels");
      return Response.json({ data: { team: { labels: { nodes: [] } } } });
    }
    if (query.includes("mutation IssueLabelCreate")) {
      operations.push("IssueLabelCreate");
      return Response.json({
        data: {
          issueLabelCreate: { success: true, issueLabel: { id: `label-${operations.length}` } },
        },
      });
    }
    if (query.includes("mutation IssueCreate")) {
      operations.push("IssueCreate");
      return Response.json({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "linear-issue-1",
              identifier: "OPS-123",
              url: "https://linear.app/cmdclaw/issue/OPS-123/test",
            },
          },
        },
      });
    }
    if (query.includes("mutation IssueUpdate")) {
      operations.push("IssueUpdate");
      return Response.json({ data: { issueUpdate: { success: true } } });
    }
    if (query.includes("mutation CommentCreate")) {
      operations.push("CommentCreate");
      return Response.json({ data: { commentCreate: { success: true } } });
    }

    throw new Error(`Unexpected Linear query: ${query}`);
  });

  return { fetchImpl, operations };
}

describe("failure alert Linear sync", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dbMock.select.mockReset();
    dbMock.update.mockReset();
    process.env.LINEAR_API_KEY = "lin_api_test";
    delete process.env.LINEAR_TEAM_ID;
    process.env.LINEAR_TEAM_KEY = "OPS";
    process.env.LINEAR_FAILURE_ALERT_ENV = "prod";
    process.env.APP_URL = "https://app.cmdclaw.test";
  });

  it("creates one Linear issue for a new failure group with recent cases", async () => {
    mockSelects(buildGroup(), [buildOccurrence()]);
    const update = mockUpdate();
    const { fetchImpl, operations } = createLinearFetchRecorder();
    const { syncFailureAlertGroupToLinear } = await import("./failure-alert-service");

    const result = await syncFailureAlertGroupToLinear(
      { groupId: "group-1" },
      { fetchImpl: fetchImpl as typeof fetch },
    );

    expect(result).toEqual({ action: "created", issueIdentifier: "OPS-123" });
    expect(operations).toContain("IssueCreate");
    expect(operations).not.toContain("CommentCreate");
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueId: "linear-issue-1",
        linearIssueIdentifier: "OPS-123",
        linearIssueUrl: "https://linear.app/cmdclaw/issue/OPS-123/test",
      }),
    );
  }, 10_000);

  it("updates and comments on the same Linear issue at low fast-failure milestones", async () => {
    mockSelects(
      buildGroup({
        occurrenceCount: 3,
        linearIssueId: "linear-issue-1",
        linearIssueIdentifier: "OPS-123",
        lastCommentedOccurrenceCount: 2,
      }),
      [
        buildOccurrence({ conversationId: "conv-3", generationId: "gen-3" }),
        buildOccurrence({ conversationId: "conv-2", generationId: "gen-2" }),
      ],
    );
    const update = mockUpdate();
    const { fetchImpl, operations } = createLinearFetchRecorder();
    const { syncFailureAlertGroupToLinear } = await import("./failure-alert-service");

    const result = await syncFailureAlertGroupToLinear(
      { groupId: "group-1" },
      { fetchImpl: fetchImpl as typeof fetch },
    );

    expect(result).toEqual({ action: "updated", issueIdentifier: "OPS-123" });
    expect(operations).toContain("IssueUpdate");
    expect(operations).toContain("CommentCreate");
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastCommentedOccurrenceCount: 3,
      }),
    );
  }, 10_000);
});
