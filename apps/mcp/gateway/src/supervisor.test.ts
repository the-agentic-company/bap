import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  getMcpChildRestartDelayMs,
  getManagedChildMode,
  parseMcpChildListeningPort,
  shouldManageGatewayChildren,
  superviseManagedGatewayChild,
  type ManagedGatewayChild,
  type ManagedGatewaySupervisorDependencies,
} from "./supervisor";

function fakeChildProcess(pid: number): ChildProcess {
  return { pid } as ChildProcess;
}

const spawnParams = {
  slug: "bap" as const,
  childRoot: "servers/bap",
  mode: "dev" as const,
  port: 4101,
  env: {},
  rootDir: "/repo/apps/mcp",
};

function managedChild(process: ChildProcess): ManagedGatewayChild {
  return {
    slug: "bap",
    port: 4101,
    target: "http://127.0.0.1:4101",
    process,
  };
}

async function runSupervisorScenario(args: {
  child: ManagedGatewayChild;
  controller: AbortController;
  dependencies: ManagedGatewaySupervisorDependencies;
}): Promise<void> {
  await superviseManagedGatewayChild(
    {
      child: args.child,
      initialHandle: { process: args.child.process, readyPort: Promise.resolve(4101) },
      spawnParams,
      signal: args.controller.signal,
    },
    args.dependencies,
  );
}

describe("gateway supervisor config", () => {
  it("enables managed children only when requested", () => {
    expect(shouldManageGatewayChildren({ MCP_GATEWAY_MANAGED_CHILDREN: "true" })).toBe(true);
    expect(shouldManageGatewayChildren({ MCP_GATEWAY_MANAGED_CHILDREN: "false" })).toBe(false);
  });

  it("defaults child mode to dev", () => {
    expect(getManagedChildMode({})).toBe("dev");
    expect(getManagedChildMode({ MCP_GATEWAY_CHILD_MODE: "start" })).toBe("start");
  });

  it("parses the actual child listening port from xmcp startup output", () => {
    expect(
      parseMcpChildListeningPort(
        "✔ MCP Server running on http://127.0.0.1:4102/mcp",
        "127.0.0.1",
      ),
    ).toBe(4102);
  });

  it("ignores unrelated child log lines", () => {
    expect(parseMcpChildListeningPort("✔ Built HTTP server", "127.0.0.1")).toBeNull();
    expect(
      parseMcpChildListeningPort(
        "✔ MCP Server running on http://0.0.0.0:4102/mcp",
        "127.0.0.1",
      ),
    ).toBeNull();
  });

  it("uses capped exponential backoff for child restarts", () => {
    expect(getMcpChildRestartDelayMs(0)).toBe(250);
    expect(getMcpChildRestartDelayMs(1)).toBe(500);
    expect(getMcpChildRestartDelayMs(2)).toBe(1_000);
    expect(getMcpChildRestartDelayMs(10)).toBe(5_000);
    expect(getMcpChildRestartDelayMs(-1)).toBe(250);
  });

  it.each(["process_exit", "target_unhealthy"] as const)(
    "restarts on the same port after %s",
    async (failureReason) => {
      const initialProcess = fakeChildProcess(101);
      const replacementProcess = fakeChildProcess(102);
      const controller = new AbortController();
      let failureChecks = 0;
      const waitForFailure = vi.fn(async () => {
        failureChecks += 1;
        if (failureChecks === 1) {
          return failureReason;
        }
        controller.abort();
        return "shutdown" as const;
      });
      const spawnChild = vi.fn(async () => ({
        process: replacementProcess,
        readyPort: Promise.resolve(4101),
      }));
      const waitForDelay = vi.fn(async () => undefined);
      const terminateChild = vi.fn();
      const child = managedChild(initialProcess);

      await runSupervisorScenario({
        child,
        controller,
        dependencies: {
          waitForFailure,
          spawnChild,
          waitForDelay,
          terminateChild,
          now: () => 0,
        },
      });

      expect(waitForDelay).toHaveBeenCalledWith(250, controller.signal);
      expect(spawnChild).toHaveBeenCalledWith(expect.objectContaining({ port: 4101 }));
      expect(terminateChild).toHaveBeenCalledWith(initialProcess);
      expect(child.process).toBe(replacementProcess);
    },
  );

  it("terminates a replacement spawned while shutdown is in flight", async () => {
    const initialProcess = fakeChildProcess(201);
    const replacementProcess = fakeChildProcess(202);
    const controller = new AbortController();
    const terminateChild = vi.fn();
    const child = managedChild(initialProcess);
    const spawnChild = vi.fn(async () => {
      controller.abort();
      return {
        process: replacementProcess,
        readyPort: Promise.resolve(4101),
      };
    });

    await runSupervisorScenario({
      child,
      controller,
      dependencies: {
        waitForFailure: vi.fn(async () => "target_unhealthy" as const),
        spawnChild,
        waitForDelay: vi.fn(async () => undefined),
        terminateChild,
        now: () => 0,
      },
    });

    expect(terminateChild).toHaveBeenCalledWith(initialProcess);
    expect(terminateChild).toHaveBeenCalledWith(replacementProcess);
    expect(child.process).toBe(initialProcess);
  });

  it("backs off across replacements that become ready and quickly fail", async () => {
    const initialProcess = fakeChildProcess(301);
    const firstReplacement = fakeChildProcess(302);
    const secondReplacement = fakeChildProcess(303);
    const controller = new AbortController();
    let failureChecks = 0;
    const waitForFailure = vi.fn(async () => {
      failureChecks += 1;
      if (failureChecks <= 2) {
        return "process_exit" as const;
      }
      controller.abort();
      return "shutdown" as const;
    });
    const spawnChild = vi
      .fn()
      .mockResolvedValueOnce({
        process: firstReplacement,
        readyPort: Promise.resolve(4101),
      })
      .mockResolvedValueOnce({
        process: secondReplacement,
        readyPort: Promise.resolve(4101),
      });
    const waitForDelay = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(
      async () => undefined,
    );
    const child = managedChild(initialProcess);

    await runSupervisorScenario({
      child,
      controller,
      dependencies: {
        waitForFailure,
        spawnChild,
        waitForDelay,
        terminateChild: vi.fn(),
        now: () => 0,
      },
    });

    expect(waitForDelay.mock.calls.map(([delay]) => delay)).toEqual([250, 500]);
    expect(child.process).toBe(secondReplacement);
  });
});
