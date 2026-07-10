import { describe, expect, test, vi } from "vitest";
import {
  collectWorkerProcessMatches,
  formatCliLivePreflightFailure,
  formatCliLivePreflightSuccess,
  resolveCliLiveBapMcpUrl,
  resolveCliLivePreflightTarget,
  resolveCliLiveWebHealthUrl,
  runCliLivePreflight,
  type CliLivePreflightResult,
} from "../../scripts/e2e-live-preflight";

const stagingPreflightEnv = {
  APP_MCP_BASE_URL: "https://mcp.staging.heybap.com",
  APP_SERVER_SECRET: "secret",
  APP_SERVER_URL: "https://staging.heybap.com",
};

type WorkerReadinessResponse = {
  ready: boolean;
  queueName: string;
  workerCount: number;
  counts: Record<string, number>;
};

function mockRemotePreflightFetch(readWorkerQueue: () => WorkerReadinessResponse) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, _init) => {
    const url = String(input);
    if (url === "https://staging.heybap.com/api/health") {
      return Response.json({ ok: true, checks: { database: true, redis: true } });
    }
    if (url === "https://staging.heybap.com/api/internal/testing/cli-live") {
      return Response.json(readWorkerQueue());
    }
    if (url === "https://mcp.staging.heybap.com/bap") {
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  });
}

describe("e2e-live cli preflight", () => {
  test("resolves the web health URL from APP_SERVER_URL", () => {
    expect(resolveCliLiveWebHealthUrl({ APP_SERVER_URL: "http://127.0.0.1:3707/base" })).toBe(
      "http://127.0.0.1:3707/api/dev/health",
    );
  });

  test("uses deployed health checks for remote APP_SERVER_URL targets", () => {
    const env = { APP_SERVER_URL: "https://staging.heybap.com" };

    expect(resolveCliLivePreflightTarget(env)).toBe("remote");
    expect(resolveCliLiveWebHealthUrl(env)).toBe("https://staging.heybap.com/api/health");
  });

  test("keeps localcan targets on the local preflight path", () => {
    const env = { APP_SERVER_URL: "https://localcan.baptistecolle.com/__worktrees/bap-123" };

    expect(resolveCliLivePreflightTarget(env)).toBe("local");
    expect(resolveCliLiveWebHealthUrl(env)).toBe(
      "https://localcan.baptistecolle.com/api/dev/health",
    );
  });

  test("remote preflight does not require local worker or tunnel processes", async () => {
    const fetchMock = mockRemotePreflightFetch(() => {
      return {
        ready: true,
        queueName: "bap-staging",
        workerCount: 1,
        counts: {},
      };
    });

    try {
      const result = await runCliLivePreflight({
        env: stagingPreflightEnv,
        repoRoot: "/does/not/exist",
      });

      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.service)).toEqual([
        "web server",
        "worker",
        "Bap MCP",
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls).toContainEqual([
        "https://staging.heybap.com/api/internal/testing/cli-live",
        expect.objectContaining({ method: "POST" }),
      ]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("waits for a remote worker to register after deploy", async () => {
    let workerChecks = 0;
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const fetchMock = mockRemotePreflightFetch(() => {
      workerChecks += 1;
      return {
        ready: workerChecks >= 3,
        queueName: "bap-staging",
        workerCount: workerChecks >= 3 ? 1 : 0,
        counts: {},
      };
    });

    try {
      const result = await runCliLivePreflight({
        env: stagingPreflightEnv,
        repoRoot: "/does/not/exist",
        remoteWorkerWait: {
          intervalMs: 1,
          sleep,
          timeoutMs: 10_000,
        },
      });

      expect(result.ok).toBe(true);
      expect(workerChecks).toBe(3);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(result.checks.find((check) => check.service === "worker")?.detail).toBe(
        'remote queue "bap-staging" has 1 registered worker(s)',
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("resolves the Bap MCP URL from APP_MCP_BASE_URL", () => {
    expect(resolveCliLiveBapMcpUrl({ APP_MCP_BASE_URL: "https://mcp.example.test/root" })).toBe(
      "https://mcp.example.test/bap",
    );
  });

  test("reports not-started services before check details", () => {
    const result: CliLivePreflightResult = {
      ok: false,
      checks: [
        {
          service: "web server",
          status: "missing",
          detail: "GET http://localhost:3000/api/dev/health failed",
          recovery: "start web",
        },
        {
          service: "worker",
          status: "missing",
          detail: "no worker process found",
          recovery: "start worker",
        },
        {
          service: "local tunnel",
          status: "ok",
          detail: "healthy",
          recovery: "start tunnel",
        },
        {
          service: "Bap MCP",
          status: "unhealthy",
          detail: "GET https://mcp.example.test/bap returned HTTP 502",
          recovery: "fix mcp tunnel",
        },
      ],
    };

    expect(formatCliLivePreflightFailure(result)).toContain("not started: web server, worker");
    expect(formatCliLivePreflightFailure(result)).toContain("unhealthy: Bap MCP");
  });

  test("formats successful preflight checks for CI logs", () => {
    const result: CliLivePreflightResult = {
      ok: true,
      checks: [
        {
          service: "web server",
          status: "ok",
          detail: "healthy at https://staging.heybap.com/api/health",
          recovery: "start web",
        },
        {
          service: "worker",
          status: "ok",
          detail: 'remote queue "bap-staging" has 1 registered worker(s)',
          recovery: "start worker",
        },
      ],
    };

    expect(formatCliLivePreflightSuccess(result, "remote")).toBe(
      [
        "cli-live pre-check passed (remote).",
        "- web server: healthy at https://staging.heybap.com/api/health",
        '- worker: remote queue "bap-staging" has 1 registered worker(s)',
      ].join("\n"),
    );
  });

  test("matches worker entrypoints by cwd when the command is generic", () => {
    const repoRoot = "/Users/dev/Git/bap";
    const processes = [
      { pid: 101, command: "bun --watch --env-file=../../.env index.ts" },
      { pid: 102, command: "bun --watch --env-file=../../.env index.ts" },
    ];

    expect(
      collectWorkerProcessMatches(
        processes,
        repoRoot,
        (pid) => (pid === 101 ? `${repoRoot}/apps/worker` : `${repoRoot}/apps/ws`),
        () => true,
      ).map((processEntry) => processEntry.pid),
    ).toEqual([101]);
  });

  test("ignores stopped worker-like processes", () => {
    const processes = [{ pid: 101, command: "bun --cwd apps/worker start" }];

    expect(
      collectWorkerProcessMatches(
        processes,
        "/Users/dev/Git/bap",
        () => null,
        () => false,
      ),
    ).toEqual([]);
  });
});
