import { beforeEach, describe, expect, it, vi } from "vitest";

type AsyncUnknownMock = (...args: never[]) => Promise<unknown>;

const { reconcileOneMock, reconcileManyMock } = vi.hoisted(() => ({
  reconcileOneMock: vi.fn<AsyncUnknownMock>(),
  reconcileManyMock: vi.fn<AsyncUnknownMock>(),
}));

vi.mock("@bap/core/server/services/coworker-service", () => ({
  reconcileStaleCoworkerRunsForCoworker: reconcileOneMock,
  reconcileStaleCoworkerRunsForCoworkers: reconcileManyMock,
}));

import { getCoworkerRunView } from "./coworker-run-view";

function createContext(input: {
  startKind: "user_intent" | "external_trigger";
  initiatedByUserId: string | null;
}) {
  const run = {
    id: "run-1",
    coworkerId: "coworker-1",
    workspaceId: "workspace-1",
    status: "completed" as const,
    startKind: input.startKind,
    initiatedByUserId: input.initiatedByUserId,
    executionUserId: "owner-1",
    triggerPayload: { private: "payload" },
    generationId: "generation-1",
    conversationId: "conversation-1",
    startedAt: new Date("2026-07-30T10:00:00.000Z"),
    finishedAt: new Date("2026-07-30T10:01:00.000Z"),
    errorMessage: "private error",
    failureKind: "private_failure",
    debugInfo: { private: "debug" },
  };
  const runFindFirst = vi.fn<AsyncUnknownMock>().mockResolvedValue(run);
  const eventFindMany = vi.fn<AsyncUnknownMock>().mockResolvedValue([
    {
      id: "event-1",
      type: "trigger",
      payload: { private: "event" },
      createdAt: run.startedAt,
    },
  ]);
  const generationFindFirst = vi.fn<AsyncUnknownMock>().mockResolvedValue({
    conversationId: "conversation-1",
    debugInfo: { private: "generation debug" },
    failureKind: "generation_failure",
  });

  return {
    context: {
      user: { id: "viewer-1" },
      db: {
        query: {
          coworkerRun: { findFirst: runFindFirst },
          coworker: {
            findFirst: vi.fn<AsyncUnknownMock>().mockResolvedValue({
              id: "coworker-1",
              name: "Shared Coworker",
              username: "shared",
              visibility: "workspace",
              sharedAt: null,
              createdByUserId: "creator-1",
              ownerId: "creator-1",
            }),
          },
          coworkerRunEvent: { findMany: eventFindMany },
          generation: { findFirst: generationFindFirst },
        },
      },
    },
    eventFindMany,
    generationFindFirst,
  };
}

describe("getCoworkerRunView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcileOneMock.mockResolvedValue(undefined);
    reconcileManyMock.mockResolvedValue(undefined);
  });

  it("shows safe metadata but hides manual-run content from other workspace members", async () => {
    const fixture = createContext({
      startKind: "user_intent",
      initiatedByUserId: "initiator-1",
    });

    const result = await getCoworkerRunView({
      context: fixture.context as never,
      workspaceId: "workspace-1",
      runId: "run-1",
    });

    expect(result).toMatchObject({
      id: "run-1",
      status: "completed",
      startKind: "user_intent",
      initiatedByUserId: "initiator-1",
      contentVisible: false,
      triggerPayload: null,
      conversationId: null,
      errorMessage: null,
      failureKind: null,
      debugInfo: null,
      events: [],
    });
    expect(fixture.eventFindMany).not.toHaveBeenCalled();
    expect(fixture.generationFindFirst).not.toHaveBeenCalled();
  });

  it("shows automated-run content to workspace members", async () => {
    const fixture = createContext({
      startKind: "external_trigger",
      initiatedByUserId: null,
    });

    const result = await getCoworkerRunView({
      context: fixture.context as never,
      workspaceId: "workspace-1",
      runId: "run-1",
    });

    expect(result).toMatchObject({
      contentVisible: true,
      triggerPayload: { private: "payload" },
      conversationId: "conversation-1",
      errorMessage: "private error",
      failureKind: "private_failure",
      debugInfo: { private: "debug" },
      events: [{ id: "event-1", payload: { private: "event" } }],
    });
    expect(fixture.eventFindMany).toHaveBeenCalledOnce();
    expect(fixture.generationFindFirst).toHaveBeenCalledOnce();
  });
});
