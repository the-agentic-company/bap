import { beforeEach, describe, expect, it } from "vitest";
import {
  coworkerRouterAny,
  createContext,
  reconcileStaleCoworkerRunsForCoworkersMock,
  resetCoworkerRouterTestHarness,
} from "./coworker.test-harness";

describe("coworkerRouter", () => {
  beforeEach(resetCoworkerRouterTestHarness);
  it("returns normalized history entries for successful writes", async () => {
    const context = createContext();
    const startedAt = new Date("2026-04-07T09:00:00.000Z");
    const actionAt = new Date("2026-04-07T09:01:00.000Z");

    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "completed",
        errorMessage: null,
        startedAt,
        coworker: {
          id: "wf-1",
          name: "Slack Notifier",
          username: "slack-notifier",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-1",
        coworkerRunId: "run-1",
        type: "tool_use",
        createdAt: actionAt,
        payload: {
          type: "tool_use",
          toolUseId: "tool-1",
          toolName: "bash",
          toolInput: {
            command: 'slack send -c "#eng" -t "hello"',
          },
          integration: "slack",
          operation: "send",
          isWrite: true,
        },
      },
      {
        id: "evt-2",
        coworkerRunId: "run-1",
        type: "tool_result",
        createdAt: new Date("2026-04-07T09:01:03.000Z"),
        payload: {
          type: "tool_result",
          toolUseId: "tool-1",
          toolName: "bash",
          result: { ok: true, channel: "#eng" },
        },
      },
    ]);

    const result = await coworkerRouterAny.getHistory({ context });

    expect(result).toEqual({
      entries: [
        {
          id: "run-1:tool-1",
          runId: "run-1",
          toolUseId: "tool-1",
          timestamp: actionAt,
          coworker: {
            id: "wf-1",
            name: "Slack Notifier",
            username: "slack-notifier",
          },
          integration: "slack",
          operation: "send",
          operationLabel: "Sending message",
          status: "success",
          target: "#eng",
          preview: {
            command: 'slack send -c "#eng" -t "hello"',
          },
        },
      ],
      nextCursor: undefined,
    });
    expect(reconcileStaleCoworkerRunsForCoworkersMock).toHaveBeenCalledWith(["wf-1"]);
  });

  it("marks rejected interrupts as denied", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-2",
        status: "completed",
        errorMessage: null,
        startedAt: new Date("2026-04-07T10:00:00.000Z"),
        coworker: {
          id: "wf-2",
          name: "GitHub Bot",
          username: "github-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-3",
        coworkerRunId: "run-2",
        type: "tool_use",
        createdAt: new Date("2026-04-07T10:00:05.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-2",
          toolName: "bash",
          toolInput: {
            command: 'github issues create --repo acme/api --title "Bug"',
          },
          integration: "github",
          operation: "issues.create",
          isWrite: true,
        },
      },
      {
        id: "evt-4",
        coworkerRunId: "run-2",
        type: "interrupt_resolved",
        createdAt: new Date("2026-04-07T10:00:10.000Z"),
        payload: {
          type: "interrupt_resolved",
          providerToolUseId: "tool-2",
          status: "rejected",
          display: {
            title: "Bash",
            integration: "github",
            operation: "issues.create",
            command: 'github issues create --repo acme/api --title "Bug"',
            toolInput: {
              command: 'github issues create --repo acme/api --title "Bug"',
            },
          },
        },
      },
    ]);

    const result = await coworkerRouterAny.getHistory({ context });

    expect(result).toEqual({
      entries: [
        expect.objectContaining({
          id: "run-2:tool-2",
          integration: "github",
          status: "denied",
          target: "acme/api",
        }),
      ],
      nextCursor: undefined,
    });
  });

  it("marks pending writes and prefers edited approval payloads", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-3",
        status: "awaiting_auth",
        errorMessage: null,
        startedAt: new Date("2026-04-07T11:00:00.000Z"),
        coworker: {
          id: "wf-3",
          name: "Docs Bot",
          username: "docs-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-5",
        coworkerRunId: "run-3",
        type: "tool_use",
        createdAt: new Date("2026-04-07T11:00:03.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-3",
          toolName: "bash",
          toolInput: {
            command: 'google-docs create --title "Draft Spec"',
          },
          integration: "google_docs",
          operation: "create-issue",
          isWrite: true,
        },
      },
      {
        id: "evt-6",
        coworkerRunId: "run-3",
        type: "interrupt_pending",
        createdAt: new Date("2026-04-07T11:00:04.000Z"),
        payload: {
          type: "interrupt_pending",
          providerToolUseId: "tool-3",
          status: "pending",
          kind: "auth",
          display: {
            title: "Bash",
            integration: "google_docs",
            operation: "create-issue",
            command: 'google-docs create --title "Draft Spec"',
            toolInput: {
              title: "Draft Spec",
            },
          },
        },
      },
      {
        id: "evt-7",
        coworkerRunId: "run-3",
        type: "user_interrupt",
        createdAt: new Date("2026-04-07T11:00:05.000Z"),
        payload: {
          toolUseId: "tool-3",
          toolName: "Bash",
          integration: "google_docs",
          operation: "create-issue",
          command: 'google-docs create --title "Edited Spec"',
          originalToolInput: { title: "Draft Spec" },
          updatedToolInput: { title: "Edited Spec" },
        },
      },
    ]);

    const result = await coworkerRouterAny.getHistory({ context });

    expect(result).toEqual({
      entries: [
        expect.objectContaining({
          id: "run-3:tool-3",
          status: "pending",
          target: "Edited Spec",
          preview: {
            title: "Edited Spec",
          },
        }),
      ],
      nextCursor: undefined,
    });
  });

  it("marks failed writes as errors when the run ends before a tool result", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-4",
        status: "error",
        errorMessage: "channel archived",
        startedAt: new Date("2026-04-07T12:00:00.000Z"),
        coworker: {
          id: "wf-4",
          name: "Alerts Bot",
          username: "alerts-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-8",
        coworkerRunId: "run-4",
        type: "tool_use",
        createdAt: new Date("2026-04-07T12:00:02.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-4",
          toolName: "bash",
          toolInput: {
            command: 'slack send -c "#alerts" -t "Outage"',
          },
          integration: "slack",
          operation: "send",
          isWrite: true,
        },
      },
    ]);

    const result = await coworkerRouterAny.getHistory({ context });

    expect(result).toEqual({
      entries: [
        expect.objectContaining({
          id: "run-4:tool-4",
          status: "error",
          preview: {
            command: 'slack send -c "#alerts" -t "Outage"',
            error: "channel archived",
          },
        }),
      ],
      nextCursor: undefined,
    });
  });

  it("returns multiple write actions from the same run", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-5",
        status: "completed",
        errorMessage: null,
        startedAt: new Date("2026-04-07T13:00:00.000Z"),
        coworker: {
          id: "wf-5",
          name: "Ops Bot",
          username: "ops-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-9",
        coworkerRunId: "run-5",
        type: "tool_use",
        createdAt: new Date("2026-04-07T13:00:01.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-5a",
          toolName: "bash",
          toolInput: {
            command: 'slack send -c "#ops" -t "Deploy"',
          },
          integration: "slack",
          operation: "send",
          isWrite: true,
        },
      },
      {
        id: "evt-10",
        coworkerRunId: "run-5",
        type: "tool_result",
        createdAt: new Date("2026-04-07T13:00:02.000Z"),
        payload: {
          type: "tool_result",
          toolUseId: "tool-5a",
          toolName: "bash",
          result: { ok: true },
        },
      },
      {
        id: "evt-11",
        coworkerRunId: "run-5",
        type: "tool_use",
        createdAt: new Date("2026-04-07T13:00:03.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-5b",
          toolName: "bash",
          toolInput: {
            command: 'github create-issue -o acme -r app -t "Follow-up"',
          },
          integration: "github",
          operation: "create-issue",
          isWrite: true,
        },
      },
      {
        id: "evt-12",
        coworkerRunId: "run-5",
        type: "tool_result",
        createdAt: new Date("2026-04-07T13:00:04.000Z"),
        payload: {
          type: "tool_result",
          toolUseId: "tool-5b",
          toolName: "bash",
          result: { ok: true },
        },
      },
    ]);

    const result = (await coworkerRouterAny.getHistory({ context })) as {
      entries: Array<{ id: string }>;
    };

    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.id)).toEqual(["run-5:tool-5b", "run-5:tool-5a"]);
  });

  it("excludes read-only tool events from history", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-6",
        status: "completed",
        errorMessage: null,
        startedAt: new Date("2026-04-07T14:00:00.000Z"),
        coworker: {
          id: "wf-6",
          name: "Reader Bot",
          username: "reader-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-13",
        coworkerRunId: "run-6",
        type: "tool_use",
        createdAt: new Date("2026-04-07T14:00:01.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-6",
          toolName: "bash",
          toolInput: {
            command: "slack channels",
          },
          integration: "slack",
          operation: "channels",
          isWrite: false,
        },
      },
      {
        id: "evt-14",
        coworkerRunId: "run-6",
        type: "tool_result",
        createdAt: new Date("2026-04-07T14:00:02.000Z"),
        payload: {
          type: "tool_result",
          toolUseId: "tool-6",
          toolName: "bash",
          result: { ok: true },
        },
      },
    ]);

    const result = await coworkerRouterAny.getHistory({ context });

    expect(result).toEqual({
      entries: [],
      nextCursor: undefined,
    });
  });

  it("returns a cursor when older runs are available", async () => {
    const context = createContext();
    const newestRunAt = new Date("2026-04-07T15:00:00.000Z");
    const olderRunAt = new Date("2026-04-07T14:00:00.000Z");
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-7",
        status: "completed",
        errorMessage: null,
        startedAt: newestRunAt,
        coworker: {
          id: "wf-7",
          name: "Pager Bot",
          username: "pager-bot",
        },
      },
      {
        id: "run-8",
        status: "completed",
        errorMessage: null,
        startedAt: olderRunAt,
        coworker: {
          id: "wf-8",
          name: "Older Bot",
          username: "older-bot",
        },
      },
    ]);
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-15",
        coworkerRunId: "run-7",
        type: "tool_use",
        createdAt: new Date("2026-04-07T15:00:05.000Z"),
        payload: {
          type: "tool_use",
          toolUseId: "tool-7",
          toolName: "bash",
          toolInput: {
            command: 'slack send -c "#pager" -t "Heads up"',
          },
          integration: "slack",
          operation: "send",
          isWrite: true,
        },
      },
      {
        id: "evt-16",
        coworkerRunId: "run-7",
        type: "tool_result",
        createdAt: new Date("2026-04-07T15:00:06.000Z"),
        payload: {
          type: "tool_result",
          toolUseId: "tool-7",
          toolName: "bash",
          result: { ok: true },
        },
      },
    ]);

    const result = (await coworkerRouterAny.getHistory({
      input: { limit: 1 },
      context,
    })) as {
      entries: Array<{ id: string }>;
      nextCursor?: string;
    };

    expect(result.entries.map((entry) => entry.id)).toEqual(["run-7:tool-7"]);
    expect(result.nextCursor).toBe(
      JSON.stringify({ startedAt: newestRunAt.toISOString(), runId: "run-7" }),
    );
  });
});
