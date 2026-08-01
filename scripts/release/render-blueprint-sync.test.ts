import { describe, expect, it, vi } from "vitest";
import { waitForBlueprintSync } from "./render-blueprint-sync";

const blueprintId = "exs-d7llg1aqqhas73ft4uo0";
const expectedCommit = "1234567890abcdef1234567890abcdef12345678";

function response(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function syncList(commit: string, state: string) {
  return [
    {
      sync: {
        id: "exe-sync-1",
        state,
        commit: { id: commit },
        startedAt: "2026-07-31T14:29:00.000Z",
        completedAt: state === "success" ? "2026-07-31T14:29:01.000Z" : undefined,
      },
    },
  ];
}

function dependencies(fetchMock: typeof fetch, now: () => number = () => 0) {
  return {
    fetch: fetchMock,
    now,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Render Blueprint sync", () => {
  it("waits until the automatic sync for the expected commit succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(syncList("abcdefabcdefabcdefabcdefabcdefabcdefabcd", "success")),
      )
      .mockResolvedValueOnce(response(syncList(expectedCommit, "running")))
      .mockResolvedValueOnce(response(syncList(expectedCommit, "success")));

    const result = await waitForBlueprintSync(
      {
        apiKey: "render-api-key",
        blueprintId,
        expectedCommit,
        pollMs: 1,
        timeoutMs: 10_000,
      },
      dependencies(fetchMock),
    );

    expect(result.state).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/blueprints/${blueprintId}/syncs`);
  });

  it("times out when Render never syncs the expected commit", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response(syncList("abcdefabcdefabcdefabcdefabcdefabcdefabcd", "success")),
    );
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(200);

    await expect(
      waitForBlueprintSync(
        {
          apiKey: "render-api-key",
          blueprintId,
          expectedCommit,
          pollMs: 1,
          timeoutMs: 100,
        },
        dependencies(fetchMock, now),
      ),
    ).rejects.toThrow("Timed out waiting");
  });

  it("fails when the expected sync ends unsuccessfully", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response(syncList(expectedCommit, "error")),
    );

    await expect(
      waitForBlueprintSync(
        {
          apiKey: "render-api-key",
          blueprintId,
          expectedCommit,
        },
        dependencies(fetchMock),
      ),
    ).rejects.toThrow("ended in state error");
  });

  it("fails when the Render sync list cannot be inspected", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(null, 503));

    await expect(
      waitForBlueprintSync(
        { apiKey: "render-api-key", blueprintId, expectedCommit },
        dependencies(fetchMock),
      ),
    ).rejects.toThrow("HTTP 503");
  });
});
