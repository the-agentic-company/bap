import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  conversationFindFirstMock,
  generationFindFirstMock,
  emitClientObservationMock,
  requireActiveWorkspaceAccessMock,
  redisExecMock,
  redisIncrbyMock,
  redisPttlMock,
  redisPexpireMock,
  redisSetMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  conversationFindFirstMock: vi.fn(),
  generationFindFirstMock: vi.fn(),
  emitClientObservationMock: vi.fn(),
  requireActiveWorkspaceAccessMock: vi.fn(),
  redisExecMock: vi.fn(),
  redisIncrbyMock: vi.fn(),
  redisPttlMock: vi.fn(),
  redisPexpireMock: vi.fn(),
  redisSetMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    query: {
      conversation: {
        findFirst: conversationFindFirstMock,
      },
      generation: {
        findFirst: generationFindFirstMock,
      },
    },
  },
}));

vi.mock("@cmdclaw/core/server/utils/observability", () => ({
  emitClientObservation: emitClientObservationMock,
}));

vi.mock("@/server/orpc/workspace-access", () => ({
  requireActiveWorkspaceAccess: requireActiveWorkspaceAccessMock,
}));

vi.mock("ioredis", () => ({
  default: function IORedisMock() {
    return {
      pexpire: redisPexpireMock,
      set: redisSetMock,
      multi: () => {
        const chain = {
          incrby: (...args: unknown[]) => {
            redisIncrbyMock(...args);
            return chain;
          },
          pttl: (...args: unknown[]) => {
            redisPttlMock(...args);
            return chain;
          },
          exec: redisExecMock,
        };
        return chain;
      },
    };
  },
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("https://app.example.com/api/observability/client-observations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });
}

describe("client observation intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { id: "session-1" },
    });
    requireActiveWorkspaceAccessMock.mockResolvedValue({
      workspace: { id: "ws-1" },
    });
    generationFindFirstMock.mockResolvedValue({
      id: "gen-1",
      conversationId: "conv-1",
      traceId: "trace-123",
      conversation: { userId: "user-1", workspaceId: "ws-1" },
    });
    conversationFindFirstMock.mockResolvedValue({ id: "conv-1" });
    redisExecMock.mockResolvedValue([
      [null, 1],
      [null, 1],
    ]);
    redisSetMock.mockResolvedValue("OK");
  });

  it("requires authentication", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await POST(request({ observations: [] }));

    expect(response.status).toBe(401);
    expect(emitClientObservationMock).not.toHaveBeenCalled();
  });

  it("rejects arbitrary client log event types", async () => {
    const response = await POST(
      request({
        observations: [
          {
            eventId: "event-123456",
            eventType: "anything.client.wants",
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect(emitClientObservationMock).not.toHaveBeenCalled();
  });

  it("verifies Generation access before forwarding", async () => {
    generationFindFirstMock.mockResolvedValue({
      id: "gen-1",
      conversationId: "conv-1",
      conversation: { userId: "other-user", workspaceId: "ws-1" },
    });

    const response = await POST(
      request({
        observations: [
          {
            eventId: "event-123456",
            eventType: "generation.stream.error",
            generationId: "gen-1",
          },
        ],
      }),
    );

    expect(response.status).toBe(404);
    expect(emitClientObservationMock).not.toHaveBeenCalled();
  });

  it("forwards a safe observation without storing it", async () => {
    const response = await POST(
      request({
        observations: [
          {
            eventId: "event-123456",
            eventType: "generation.stream.opened",
            generationId: "gen-1",
            elapsedMs: 42,
            online: true,
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(emitClientObservationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-123456",
        eventType: "generation.stream.opened",
        context: expect.objectContaining({
          traceId: "trace-123",
          generationId: "gen-1",
          conversationId: "conv-1",
          userId: "user-1",
        }),
      }),
    );
  });

  it("rate-limits with the durable user-session-ip bucket", async () => {
    redisExecMock.mockResolvedValue([
      [null, 121],
      [null, 1],
    ]);

    const response = await POST(
      request({
        observations: [
          {
            eventId: "event-123456",
            eventType: "generation.stream.error",
            generationId: "gen-1",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, rateLimited: true });
    expect(redisIncrbyMock).toHaveBeenCalledWith(
      "client_observation_rate:user-1:session-1:127.0.0.1",
      1,
    );
    expect(emitClientObservationMock).not.toHaveBeenCalled();
  });

  it("suppresses duplicate browser event ids within the dedupe window", async () => {
    redisSetMock.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);

    const response = await POST(
      request({
        observations: [
          {
            eventId: "event-123456",
            eventType: "generation.stream.error",
            generationId: "gen-1",
          },
          {
            eventId: "event-123456",
            eventType: "generation.stream.error",
            generationId: "gen-1",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(redisSetMock).toHaveBeenCalledWith(
      "client_observation_event:event-123456",
      "1",
      "PX",
      10 * 60 * 1000,
      "NX",
    );
    expect(emitClientObservationMock).toHaveBeenCalledTimes(1);
  });
});
