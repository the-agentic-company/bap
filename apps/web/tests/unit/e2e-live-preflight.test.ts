import { describe, expect, test } from "vitest";
import {
  collectWorkerProcessMatches,
  formatCliLivePreflightFailure,
  resolveCliLiveWebHealthUrl,
  type CliLivePreflightResult,
} from "../../scripts/e2e-live-preflight";

describe("e2e-live cli preflight", () => {
  test("resolves the web health URL from APP_SERVER_URL", () => {
    expect(resolveCliLiveWebHealthUrl({ APP_SERVER_URL: "http://127.0.0.1:3707/base" })).toBe(
      "http://127.0.0.1:3707/api/dev/health",
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
      ],
    };

    expect(formatCliLivePreflightFailure(result)).toContain("not started: web server, worker");
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
