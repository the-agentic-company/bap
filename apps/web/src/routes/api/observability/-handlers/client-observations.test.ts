import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

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
  getSessionMock: vi.fn<VitestProcedure>(),
  conversationFindFirstMock: vi.fn<VitestProcedure>(),
  generationFindFirstMock: vi.fn<VitestProcedure>(),
  emitClientObservationMock: vi.fn<VitestProcedure>(),
  requireActiveWorkspaceAccessMock: vi.fn<VitestProcedure>(),
  redisExecMock: vi.fn<VitestProcedure>(),
  redisIncrbyMock: vi.fn<VitestProcedure>(),
  redisPttlMock: vi.fn<VitestProcedure>(),
  redisPexpireMock: vi.fn<VitestProcedure>(),
  redisSetMock: vi.fn<VitestProcedure>(),
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

let handleClientObservations: typeof import("./client-observations").handleClientObservations;

function request(body: unknown): Request {
  return new Request("https://app.example.com/api/observability/client-observations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });
}

describe("client observation intake", () => {
  beforeEach(async () => {
    vi.resetModules();
    const redisState = globalThis as typeof globalThis & {
      cmdclawClientObservationRedis?: unknown;
      cmdclawClientObservationRedisFactory?: () => unknown;
    };
    delete redisState.cmdclawClientObservationRedis;
    redisState.cmdclawClientObservationRedisFactory = () => ({
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
    });
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
    ({ handleClientObservations } = await import("./client-observations"));
  });

  it("requires authentication", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await handleClientObservations(request({ observations: [] }));

    expect(response.status).toBe(401);
    expect(emitClientObservationMock).not.toHaveBeenCalled();
  });

  it("rejects arbitrary client log event types", async () => {
    const response = await handleClientObservations(
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

    const response = await handleClientObservations(
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
    const response = await handleClientObservations(
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

  it("prefers the durable Generation trace id over a browser-supplied trace id", async () => {
    const response = await handleClientObservations(
      request({
        observations: [
          {
            eventId: "event-123456",
            eventType: "generation.stream.opened",
            generationId: "gen-1",
            traceId: "browser-trace",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(emitClientObservationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          traceId: "trace-123",
        }),
      }),
    );
  });

  it("rate-limits with the durable user-session-ip bucket", async () => {
    redisExecMock.mockResolvedValue([
      [null, 121],
      [null, 1],
    ]);

    const response = await handleClientObservations(
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

    const response = await handleClientObservations(
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
