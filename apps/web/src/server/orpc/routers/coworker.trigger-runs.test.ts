import { beforeEach, describe, expect, it } from "vitest";
import {
  applyCoworkerEditMock,
  coworkerRouterAny,
  createContext,
  reconcileStaleCoworkerRunsForCoworkerMock,
  reconcileStaleCoworkerRunsForCoworkersMock,
  resetCoworkerRouterTestHarness,
  searchRemoteIntegrationUsersMock,
  triggerCoworkerRunMock,
} from "./coworker.test-harness";

describe("coworkerRouter", () => {
  beforeEach(resetCoworkerRouterTestHarness);
  it("forwards trigger payload and user role to triggerCoworkerRun", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({ role: "admin" });

    const result = await coworkerRouterAny.trigger({
      input: { id: "wf-1", payload: { source: "manual" } },
      context,
    });

    expect(result).toEqual({
      coworkerId: "wf-1",
      runId: "run-1",
      generationId: "gen-1",
      conversationId: "conv-1",
    });

    expect(triggerCoworkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: "wf-1",
        startKind: "user_intent",
        triggerPayload: { source: "manual" },
        userId: "user-1",
        userRole: "admin",
      }),
    );
  });

  it("defaults trigger payload to empty object when omitted", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue(null);

    await coworkerRouterAny.trigger({
      input: { id: "wf-1" },
      context,
    });

    expect(triggerCoworkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: "wf-1",
        startKind: "user_intent",
        triggerPayload: {},
        userId: "user-1",
        userRole: null,
      }),
    );
  });

  it("passes remote integration source and actor metadata for admin triggers", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({
      role: "admin",
      email: "admin@example.com",
    });

    await coworkerRouterAny.trigger({
      input: {
        id: "wf-1",
        payload: { source: "manual" },
        remoteIntegrationSource: {
          targetEnv: "prod",
          remoteUserId: "remote-user-1",
        },
      },
      context,
    });

    expect(triggerCoworkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: "wf-1",
        startKind: "user_intent",
        triggerPayload: { source: "manual" },
        userId: "user-1",
        userRole: "admin",
        remoteIntegrationSource: {
          targetEnv: "prod",
          remoteUserId: "remote-user-1",
          requestedByUserId: "user-1",
          requestedByEmail: "admin@example.com",
        },
      }),
    );
  });

  it("passes manual trigger attachments through to triggerCoworkerRun", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({ role: "member" });

    await coworkerRouterAny.trigger({
      input: {
        id: "wf-1",
        payload: { source: "manual_inbox", message: "Check this" },
        fileAttachments: [
          {
            fileAssetId: "asset-notes",
            name: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 5,
          },
        ],
      },
      context,
    });

    expect(triggerCoworkerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        coworkerId: "wf-1",
        startKind: "user_intent",
        triggerPayload: { source: "manual_inbox", message: "Check this" },
        fileAttachments: [
          {
            fileAssetId: "asset-notes",
            name: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 5,
          },
        ],
        userId: "user-1",
        userRole: "member",
      }),
    );
  });

  it("rejects remote integration triggers for non-admin users", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({
      role: "member",
      email: "member@example.com",
    });

    await expect(
      coworkerRouterAny.trigger({
        input: {
          id: "wf-1",
          remoteIntegrationSource: {
            targetEnv: "staging",
            remoteUserId: "remote-user-1",
          },
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists configured remote integration targets for admins", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({
      role: "admin",
      email: "admin@example.com",
    });

    const result = await coworkerRouterAny.listRemoteIntegrationTargets({
      input: {},
      context,
    });

    expect(result).toEqual({ targets: ["staging", "prod"] });
  });

  it("searches remote integration users for admins", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({
      role: "admin",
      email: "admin@example.com",
    });

    const result = await coworkerRouterAny.searchRemoteIntegrationUsers({
      input: { targetEnv: "prod", query: "client" },
      context,
    });

    expect(searchRemoteIntegrationUsersMock).toHaveBeenCalledWith({
      targetEnv: "prod",
      query: "client",
      limit: undefined,
    });
    expect(result).toEqual({
      users: [
        {
          id: "remote-user-1",
          email: "client@example.com",
          name: "Client User",
          enabledIntegrationTypes: ["google_gmail", "hubspot"],
        },
      ],
    });
  });

  it("applies coworker builder edits with user role context", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({ role: "admin" });

    const result = await coworkerRouterAny.edit({
      input: {
        coworkerId: "wf-1",
        baseUpdatedAt: "2026-03-03T12:00:00.000Z",
        changes: { prompt: "new prompt" },
      },
      context,
    });

    expect(result).toEqual({
      status: "applied",
      coworker: {
        coworkerId: "wf-1",
        updatedAt: "2026-03-03T12:01:00.000Z",
        prompt: "updated",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["github"],
      },
      appliedChanges: ["prompt"],
    });
    expect(applyCoworkerEditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userRole: "admin",
        coworkerId: "wf-1",
      }),
    );
  });

  it("returns minimal coworker impersonation target metadata for app admins", async () => {
    const context = createContext();
    context.db.query.user.findFirst.mockResolvedValue({ role: "admin" });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-2",
      name: "Inbox Triage",
      username: "inbox-triage",
      ownerId: "user-2",
      owner: {
        id: "user-2",
        name: "Other User",
        email: "other@example.com",
        image: "https://example.com/avatar.png",
      },
    });

    const result = await coworkerRouterAny.getImpersonationTarget({
      input: { coworkerId: "wf-2" },
      context,
    });

    expect(result).toEqual({
      resourceType: "coworker",
      resourceId: "wf-2",
      resourceLabel: "@inbox-triage",
      owner: {
        id: "user-2",
        name: "Other User",
        email: "other@example.com",
        image: "https://example.com/avatar.png",
      },
    });
  });

  it("returns NOT_FOUND when getting a missing run", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findFirst.mockResolvedValue(null);

    await expect(
      coworkerRouterAny.getRun({
        input: { id: "run-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND when run exists but coworker is not accessible", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findFirst.mockResolvedValue({
      id: "run-1",
      coworkerId: "wf-1",
      status: "success",
      triggerPayload: {},
      generationId: null,
      startedAt: new Date("2026-02-12T00:00:00.000Z"),
      finishedAt: null,
      errorMessage: null,
    });
    context.db.query.coworker.findFirst.mockResolvedValue(null);

    await expect(
      coworkerRouterAny.getRun({
        input: { id: "run-1" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gets run details with ordered events and conversation id", async () => {
    const context = createContext();
    const createdAt = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.coworkerRun.findFirst.mockResolvedValue({
      id: "run-1",
      coworkerId: "wf-1",
      status: "success",
      triggerPayload: { source: "schedule" },
      generationId: "gen-1",
      startedAt: createdAt,
      finishedAt: createdAt,
      errorMessage: null,
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      name: "Inbox Triage",
      username: "inbox-triage",
      ownerId: "user-1",
    });
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([
      {
        id: "evt-1",
        type: "started",
        payload: { ok: true },
        createdAt,
      },
    ]);
    context.db.query.generation.findFirst.mockResolvedValue({
      conversationId: "conv-1",
    });

    const result = await coworkerRouterAny.getRun({
      input: { id: "run-1" },
      context,
    });
    const eventArgs = context.db.query.coworkerRunEvent.findMany.mock.calls[0]?.[0];
    const eventsOrderBy = eventArgs.orderBy(
      { createdAt: "created-col" },
      { asc: (value: unknown) => `a:${value}` },
    );

    expect(result).toEqual({
      id: "run-1",
      coworkerId: "wf-1",
      coworkerName: "Inbox Triage",
      coworkerUsername: "inbox-triage",
      status: "success",
      triggerPayload: { source: "schedule" },
      generationId: "gen-1",
      conversationId: "conv-1",
      startedAt: createdAt,
      finishedAt: createdAt,
      errorMessage: null,
      debugInfo: null,
      events: [
        {
          id: "evt-1",
          type: "started",
          payload: { ok: true },
          createdAt,
        },
      ],
    });
    expect(reconcileStaleCoworkerRunsForCoworkerMock).toHaveBeenCalledWith("wf-1");
    expect(eventsOrderBy).toEqual(["a:created-col"]);
  });

  it("allows an existing admin impersonator to fetch minimal run impersonation target metadata", async () => {
    const context = createContext();
    (context.session as { impersonatedBy: string | null }).impersonatedBy = "admin-user";
    context.db.query.user.findFirst
      .mockResolvedValueOnce({ role: "member" })
      .mockResolvedValueOnce({ role: "admin" });
    context.db.query.coworkerRun.findFirst.mockResolvedValue({
      id: "run-2",
      coworkerId: "wf-2",
      ownerId: "user-2",
      owner: {
        id: "user-2",
        name: "Other User",
        email: "other@example.com",
        image: null,
      },
      coworker: {
        id: "wf-2",
        name: "Inbox Triage",
        username: null,
      },
    });

    const result = await coworkerRouterAny.getRunImpersonationTarget({
      input: { runId: "run-2", coworkerId: "wf-2" },
      context,
    });

    expect(result).toEqual({
      resourceType: "coworker_run",
      resourceId: "run-2",
      resourceLabel: "Inbox Triage",
      owner: {
        id: "user-2",
        name: "Other User",
        email: "other@example.com",
        image: null,
      },
    });
  });

  it("sets null conversation id when run has no generation", async () => {
    const context = createContext();
    context.db.query.coworkerRun.findFirst.mockResolvedValue({
      id: "run-2",
      coworkerId: "wf-1",
      status: "success",
      triggerPayload: {},
      generationId: null,
      startedAt: new Date("2026-02-12T00:00:00.000Z"),
      finishedAt: null,
      errorMessage: null,
    });
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      name: "Inbox Triage",
      username: null,
      ownerId: "user-1",
    });
    context.db.query.coworkerRunEvent.findMany.mockResolvedValue([]);

    const result = (await coworkerRouterAny.getRun({
      input: { id: "run-2" },
      context,
    })) as { conversationId: string | null };

    expect(result.conversationId).toBeNull();
    expect(result).toMatchObject({
      coworkerName: "Inbox Triage",
      coworkerUsername: null,
    });
    expect(context.db.query.generation.findFirst).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when listing runs for missing coworker", async () => {
    const context = createContext();
    context.db.query.coworker.findFirst.mockResolvedValue(null);

    await expect(
      coworkerRouterAny.listRuns({
        input: { coworkerId: "wf-missing", limit: 10 },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists coworker runs with public fields", async () => {
    const context = createContext();
    const now = new Date("2026-02-12T00:00:00.000Z");
    context.db.query.coworker.findFirst.mockResolvedValue({
      id: "wf-1",
      ownerId: "user-1",
    });
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "success",
        startedAt: now,
        finishedAt: now,
        errorMessage: null,
      },
    ]);

    const result = await coworkerRouterAny.listRuns({
      input: { coworkerId: "wf-1", limit: 10 },
      context,
    });
    const listRunsArgs = context.db.query.coworkerRun.findMany.mock.calls[0]?.[0];
    const listRunsOrderBy = listRunsArgs.orderBy(
      { startedAt: "started-col" },
      { desc: (value: unknown) => `d:${value}` },
    );

    expect(result).toEqual([
      {
        id: "run-1",
        status: "success",
        startedAt: now,
        finishedAt: now,
        errorMessage: null,
      },
    ]);
    expect(reconcileStaleCoworkerRunsForCoworkerMock).toHaveBeenCalledWith("wf-1");
    expect(listRunsOrderBy).toEqual(["d:started-col"]);
  });

  it("lists workspace runs with cursor pagination", async () => {
    const context = createContext();
    const newestRunAt = new Date("2026-04-13T10:00:00.000Z");
    const olderRunAt = new Date("2026-04-13T09:00:00.000Z");
    context.db.query.coworkerRun.findMany.mockResolvedValue([
      {
        id: "run-1",
        status: "success",
        startedAt: newestRunAt,
        finishedAt: newestRunAt,
        errorMessage: null,
        coworker: {
          id: "wf-1",
          name: "Inbox Triage",
        },
        generation: {
          conversationId: "conv-1",
        },
      },
      {
        id: "run-2",
        status: "error",
        startedAt: olderRunAt,
        finishedAt: olderRunAt,
        errorMessage: "boom",
        coworker: {
          id: "wf-2",
          name: "Follow Up",
        },
        generation: {
          conversationId: "conv-2",
        },
      },
    ]);

    const result = (await coworkerRouterAny.listWorkspaceRuns({
      input: { limit: 1 },
      context,
    })) as {
      runs: Array<{
        id: string;
        coworkerName: string;
        conversationId: string | null;
      }>;
      nextCursor?: string;
    };
    const listRunsArgs = context.db.query.coworkerRun.findMany.mock.calls[0]?.[0];

    expect(result.runs).toEqual([
      {
        id: "run-1",
        status: "success",
        startedAt: newestRunAt,
        finishedAt: newestRunAt,
        errorMessage: null,
        conversationId: "conv-1",
        coworkerId: "wf-1",
        coworkerName: "Inbox Triage",
      },
    ]);
    expect(result.nextCursor).toBeTruthy();
    expect(JSON.parse(result.nextCursor!)).toEqual({
      startedAt: newestRunAt.toISOString(),
      runId: "run-1",
    });
    expect(reconcileStaleCoworkerRunsForCoworkersMock).toHaveBeenCalledWith(["wf-1"]);
    expect(listRunsArgs.orderBy).toHaveLength(2);
  });

  it("lists workspace runs with status and coworker filters", async () => {
    const context = createContext();

    await coworkerRouterAny.listWorkspaceRuns({
      input: { status: "error", coworkerId: "wf-1", limit: 25 },
      context,
    });

    const listRunsArgs = context.db.query.coworkerRun.findMany.mock.calls[0]?.[0];
    const conditionParts = collectSqlConditionParts(listRunsArgs.where);

    expect(listRunsArgs.limit).toBe(26);
    expect(conditionParts.columns).toContain("status");
    expect(conditionParts.columns).toContain("coworker_id");
    expect(conditionParts.params).toContain("error");
    expect(conditionParts.params).toContain("wf-1");
  });
});

function collectSqlConditionParts(value: unknown): { columns: string[]; params: unknown[] } {
  const columns: string[] = [];
  const params: unknown[] = [];
  const seen = new Set<unknown>();

  function visit(node: unknown) {
    if (!node || typeof node !== "object" || seen.has(node)) {
      return;
    }
    seen.add(node);

    const record = node as Record<string, unknown>;
    if (typeof record.name === "string" && typeof record.columnType === "string") {
      columns.push(record.name);
    }
    if ("encoder" in record && "value" in record) {
      params.push(record.value);
    }

    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          visit(item);
        }
      } else {
        visit(child);
      }
    }
  }

  visit(value);
  return { columns, params };
}
