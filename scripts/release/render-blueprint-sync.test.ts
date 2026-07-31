import { describe, expect, it, vi } from "vitest";
import {
  triggerAndWaitForBlueprintSync,
  validateBlueprintSyncHookUrl,
} from "./render-blueprint-sync";

const blueprintId = "exs-d7llg1aqqhas73ft4uo0";
const expectedCommit = "1234567890abcdef1234567890abcdef12345678";
const hookUrl = `https://api.render.com/sync/${blueprintId}?key=test-secret`;

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

describe("Render Blueprint sync", () => {
  it("accepts only the private hook for the configured Blueprint", () => {
    expect(validateBlueprintSyncHookUrl(hookUrl, blueprintId).pathname).toBe(
      `/sync/${blueprintId}`,
    );
    expect(() =>
      validateBlueprintSyncHookUrl(
        `https://example.com/sync/${blueprintId}?key=test-secret`,
        blueprintId,
      ),
    ).toThrow("does not match");
  });

  it("triggers the hook and proves the expected commit synchronized", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null, 202))
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
      {
        fetch: fetchMock,
        now: vi
          .fn()
          .mockReturnValueOnce(Date.parse("2026-07-31T14:29:00.000Z"))
          .mockReturnValue(Date.parse("2026-07-31T14:29:02.000Z")),
        sleep: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result.state).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("fails when the hook synchronizes a different commit", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null, 202))
      .mockResolvedValueOnce(
        response(syncList("abcdefabcdefabcdefabcdefabcdefabcdefabcd", "success")),
      );

    await expect(
      triggerAndWaitForBlueprintSync(
        {
          apiKey: "render-api-key",
          blueprintId,
          expectedCommit,
          hookUrl,
        },
        {
          fetch: fetchMock,
          now: () => Date.parse("2026-07-31T14:29:00.000Z"),
          sleep: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).rejects.toThrow("Latest Sync Hook commit");
  });

  it("fails when the expected sync ends unsuccessfully", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null, 202))
      .mockResolvedValueOnce(response(syncList(expectedCommit, "failure")));

    await expect(
      triggerAndWaitForBlueprintSync(
        {
          apiKey: "render-api-key",
          blueprintId,
          expectedCommit,
          hookUrl,
        },
        {
          fetch: fetchMock,
          now: () => Date.parse("2026-07-31T14:29:00.000Z"),
          sleep: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).rejects.toThrow("ended in state failure");
  });
});
