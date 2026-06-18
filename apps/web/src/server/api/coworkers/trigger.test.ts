import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { triggerCoworkerRunMock } = vi.hoisted(() => ({
  triggerCoworkerRunMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@bap/core/server/services/coworker-service", () => ({
  triggerCoworkerRun: triggerCoworkerRunMock,
}));

vi.mock("@/env", () => ({
  env: {
    APP_SERVER_SECRET: "test-secret",
  },
}));

import { triggerCoworker } from "./trigger";

function makeRequest(body: unknown, authorization?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== undefined) {
    headers.set("authorization", authorization);
  }
  return new Request("https://heybap.com/api/coworkers/trigger", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("triggerCoworker (POST /api/coworkers/trigger)", () => {
  beforeEach(() => {
    triggerCoworkerRunMock.mockReset();
  });

  it("triggers a run for an authorized request", async () => {
    triggerCoworkerRunMock.mockResolvedValue({ runId: "run-1" });

    const response = await triggerCoworker(
      makeRequest({ coworkerId: "cw-1", payload: { source: "test" } }, "Bearer test-secret"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runId: "run-1" });
    expect(triggerCoworkerRunMock).toHaveBeenCalledWith({
      coworkerId: "cw-1",
      startKind: "external_trigger",
      triggerPayload: { source: "test" },
    });
  });

  it("defaults the trigger payload to an empty object", async () => {
    triggerCoworkerRunMock.mockResolvedValue({ runId: "run-2" });

    await triggerCoworker(makeRequest({ coworkerId: "cw-2" }, "Bearer test-secret"));

    expect(triggerCoworkerRunMock).toHaveBeenCalledWith({
      coworkerId: "cw-2",
      startKind: "external_trigger",
      triggerPayload: {},
    });
  });

  it("rejects requests with a missing or wrong bearer token", async () => {
    const response = await triggerCoworker(makeRequest({ coworkerId: "cw-1" }, "Bearer wrong"));

    expect(response.status).toBe(401);
    expect(triggerCoworkerRunMock).not.toHaveBeenCalled();
  });

  it("returns 400 when coworkerId is missing", async () => {
    const response = await triggerCoworker(makeRequest({}, "Bearer test-secret"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "coworkerId is required" });
    expect(triggerCoworkerRunMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the run trigger throws", async () => {
    triggerCoworkerRunMock.mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await triggerCoworker(
      makeRequest({ coworkerId: "cw-1" }, "Bearer test-secret"),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to trigger coworker" });
    errorSpy.mockRestore();
  });
});
