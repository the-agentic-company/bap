import { describe, expect, it, vi } from "vitest";
import {
  triggerAndWaitForBlueprintSync,
  validateBlueprintSyncHookUrl,
} from "./render-blueprint-sync";

const blueprintId = "exs-d7llg1aqqhas73ft4uo0";
const expectedCommit = "1234567890abcdef1234567890abcdef12345678";
const hookUrl = `https://api.render.com/sync/${blueprintId}?key=secret`;

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
  it("triggers the configured hook and waits for the expected commit to succeed", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null, 202))
      .mockResolvedValueOnce(
        response(syncList("abcdefabcdefabcdefabcdefabcdefabcdefabcd", "success")),
      )
      .mockResolvedValueOnce(response(syncList(expectedCommit, "running")))
      .mockResolvedValueOnce(response(syncList(expectedCommit, "success")));

    const result = await triggerAndWaitForBlueprintSync(
      {
        apiKey: "render-api-key",
        blueprintId,
        expectedCommit,
        hookUrl,
        pollMs: 1,
        timeoutMs: 10_000,
      },
      dependencies(fetchMock),
    );

    expect(result.state).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL(hookUrl));
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[1]?.[0]).toContain(`/blueprints/${blueprintId}/syncs`);
  });

  it("times out when Render never syncs the expected commit", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null, 202))
      .mockResolvedValue(
        response(syncList("abcdefabcdefabcdefabcdefabcdefabcdefabcd", "success")),
      );
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(200);

    await expect(
      triggerAndWaitForBlueprintSync(
        {
          apiKey: "render-api-key",
          blueprintId,
          expectedCommit,
          hookUrl,
          pollMs: 1,
          timeoutMs: 100,
        },
        dependencies(fetchMock, now),
      ),
    ).rejects.toThrow("Timed out waiting");
  });

  it("fails when the expected sync ends unsuccessfully", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response(null, 202),
    ).mockResolvedValueOnce(
      response(syncList(expectedCommit, "error")),
    );

    await expect(
      triggerAndWaitForBlueprintSync(
        { apiKey: "render-api-key", blueprintId, expectedCommit, hookUrl },
        dependencies(fetchMock),
      ),
    ).rejects.toThrow("ended in state error");
  });

  it("fails when the Render sync list cannot be inspected", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null, 202))
      .mockResolvedValueOnce(response(null, 503));

    await expect(
      triggerAndWaitForBlueprintSync(
        { apiKey: "render-api-key", blueprintId, expectedCommit, hookUrl },
        dependencies(fetchMock),
      ),
    ).rejects.toThrow("HTTP 503");
  });

  it("fails when the Blueprint Sync Hook cannot be triggered", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(null, 503));

    await expect(
      triggerAndWaitForBlueprintSync(
        { apiKey: "render-api-key", blueprintId, expectedCommit, hookUrl },
        dependencies(fetchMock),
      ),
    ).rejects.toThrow("Sync Hook returned HTTP 503");
  });

  it("rejects a hook for a different Blueprint", () => {
    expect(() =>
      validateBlueprintSyncHookUrl(
        "https://api.render.com/sync/exs-aaaaaaaaaaaaaaaaaaaa?key=secret",
        blueprintId,
      ),
    ).toThrow("does not match the configured Blueprint");
  });
});
