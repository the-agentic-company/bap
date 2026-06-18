/**
 * PTY terminal bridge for interactive TUIs inside a Daytona sandbox.
 *
 * Behind `runInteractiveCommandWithPty(sandbox, cmd)` sits the full machinery
 * to relay the host TTY to a sandbox PTY for tools like `opencode` and
 * `claude`: raw-mode stdin, resize forwarding, and — the bulk of it —
 * hand-rolled ANSI escape-sequence scanners that strip terminal probe
 * queries/responses in both directions so they do not corrupt the stream.
 */

import type { DaytonaSandbox } from "./daytona-client";

export const DEFAULT_WORKDIR = "/app";

export function shouldUsePty(cmd: string): boolean {
  const firstToken = cmd.trim().split(/\s+/)[0]?.toLowerCase();
  return firstToken === "opencode" || firstToken === "claude";
}

export function normalizeInteractiveCommand(cmd: string): string {
  const trimmed = cmd.trim();
  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase();
  if (firstToken === "opencode") {
    return `OPENCODE_CONFIG=/app/opencode.json ${trimmed}`;
  }
  return trimmed;
}

function buildPtyEnvs(): Record<string, string> {
  const termFromHost = process.env.TERM;
  const safeTerm =
    !termFromHost || termFromHost === "dumb" || termFromHost === "unknown"
      ? "xterm-256color"
      : termFromHost;

  const envs: Record<string, string> = {
    TERM: safeTerm,
    COLORTERM: process.env.COLORTERM || "truecolor",
    LANG: process.env.LANG || "C.UTF-8",
  };

  if (process.env.TERM_PROGRAM) {
    envs.TERM_PROGRAM = process.env.TERM_PROGRAM;
  }
  if (process.env.TERM_PROGRAM_VERSION) {
    envs.TERM_PROGRAM_VERSION = process.env.TERM_PROGRAM_VERSION;
  }

  return envs;
}

export async function runInteractiveCommandWithPty(
  sandbox: DaytonaSandbox,
  cmd: string,
): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("[warn] PTY mode requires a TTY; cannot run interactive command.");
    return 1;
  }

  if (!sandbox.process.createPty) {
    throw new Error("This Daytona sandbox does not expose process.createPty().");
  }

  const cols = process.stdout.columns ?? 120;
  const rows = process.stdout.rows ?? 40;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let stdinRawEnabled = false;
  let stdinCarry = new Uint8Array();
  let stdoutCarry = new Uint8Array();

  const filterTerminalQueriesFromOutput = (chunk: Uint8Array): Uint8Array => {
    const merged = new Uint8Array(stdoutCarry.length + chunk.length);
    merged.set(stdoutCarry);
    merged.set(chunk, stdoutCarry.length);

    const out: number[] = [];
    let i = 0;

    while (i < merged.length) {
      const b = merged[i];
      if (b !== 0x1b || i + 1 >= merged.length) {
        out.push(b);
        i += 1;
        continue;
      }

      const next = merged[i + 1];

      if (next === 0x5d) {
        let j = i + 2;
        while (
          j < merged.length &&
          merged[j] !== 0x07 &&
          !(merged[j] === 0x1b && j + 1 < merged.length && merged[j + 1] === 0x5c)
        ) {
          j += 1;
        }
        if (j >= merged.length) {
          stdoutCarry = merged.slice(i);
          return new Uint8Array(out);
        }

        const payload = decoder.decode(merged.slice(i + 2, j));
        const isStTerminated = merged[j] === 0x1b;
        const end = isStTerminated ? j + 1 : j;
        if (/^1[01];\?/i.test(payload)) {
          i = end + 1;
          continue;
        }

        for (let k = i; k <= end; k += 1) {
          out.push(merged[k]);
        }
        i = end + 1;
        continue;
      }

      if (next === 0x5b) {
        let j = i + 2;
        while (j < merged.length && (merged[j] < 0x40 || merged[j] > 0x7e)) {
          j += 1;
        }
        if (j >= merged.length) {
          stdoutCarry = merged.slice(i);
          return new Uint8Array(out);
        }

        const finalByte = merged[j];
        const body = decoder.decode(merged.slice(i + 2, j));
        const isCsiQuery =
          (finalByte === 0x70 && body.startsWith("?") && body.includes("$")) ||
          ((finalByte === 0x6e || finalByte === 0x74 || finalByte === 0x75 || finalByte === 0x71) &&
            /^[?>]?[0-9;]*\$?[a-z]?$/i.test(body));
        if (isCsiQuery) {
          i = j + 1;
          continue;
        }

        for (let k = i; k <= j; k += 1) {
          out.push(merged[k]);
        }
        i = j + 1;
        continue;
      }

      out.push(b);
      i += 1;
    }

    stdoutCarry = new Uint8Array();
    return new Uint8Array(out);
  };

  const pty = await sandbox.process.createPty({
    id: `bap-${Date.now()}`,
    cwd: DEFAULT_WORKDIR,
    envs: buildPtyEnvs(),
    cols,
    rows,
    onData: (data) => {
      const filtered = filterTerminalQueriesFromOutput(data);
      if (filtered.length > 0) {
        process.stdout.write(Buffer.from(filtered));
      }
    },
  });

  const filterProbeResponses = (chunk: Uint8Array): Uint8Array => {
    const merged = new Uint8Array(stdinCarry.length + chunk.length);
    merged.set(stdinCarry);
    merged.set(chunk, stdinCarry.length);
    const out: number[] = [];
    let i = 0;

    while (i < merged.length) {
      const b = merged[i];

      if (b === 0x1b && i + 1 < merged.length) {
        const next = merged[i + 1];

        if (next === 0x5d) {
          let j = i + 2;
          while (
            j < merged.length &&
            merged[j] !== 0x07 &&
            !(merged[j] === 0x1b && j + 1 < merged.length && merged[j + 1] === 0x5c)
          ) {
            j += 1;
          }
          if (j >= merged.length) {
            stdinCarry = merged.slice(i);
            return new Uint8Array(out);
          }

          const oscPayload = decoder.decode(merged.slice(i + 2, j));
          const isOscTerminatedBySt = merged[j] === 0x1b;
          const end = isOscTerminatedBySt ? j + 1 : j;

          if (/^1[01];rgb:/i.test(oscPayload)) {
            i = end + 1;
            continue;
          }

          for (let k = i; k <= end; k += 1) {
            out.push(merged[k]);
          }
          i = end + 1;
          continue;
        }

        if (next === 0x5b) {
          let j = i + 2;
          while (j < merged.length && (merged[j] < 0x40 || merged[j] > 0x7e)) {
            j += 1;
          }
          if (j >= merged.length) {
            stdinCarry = merged.slice(i);
            return new Uint8Array(out);
          }

          const finalByte = merged[j];
          const csiBody = decoder.decode(merged.slice(i + 2, j));

          if (finalByte === 0x79 && csiBody.startsWith("?") && csiBody.includes("$")) {
            i = j + 1;
            continue;
          }

          for (let k = i; k <= j; k += 1) {
            out.push(merged[k]);
          }
          i = j + 1;
          continue;
        }
      }

      out.push(b);
      i += 1;
    }

    stdinCarry = new Uint8Array();
    return new Uint8Array(out);
  };

  const stdinHandler = (chunk: Buffer | string) => {
    if (typeof chunk === "string") {
      if (/(?:^|])11;rgb:[0-9a-f/]+/i.test(chunk) || /\?\d+(?:;\d+)*\$[a-z]/i.test(chunk)) {
        return;
      }
    }

    const rawInput = typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk);
    const filteredInput = filterProbeResponses(rawInput);
    if (filteredInput.length === 0) {
      return;
    }
    pty.sendInput(filteredInput).catch(() => {});
  };

  const resizeHandler = () => {
    const nextCols = process.stdout.columns ?? cols;
    const nextRows = process.stdout.rows ?? rows;
    pty.resize(nextCols, nextRows).catch(() => {});
  };

  try {
    await pty.waitForConnection();

    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
      stdinRawEnabled = true;
    }
    process.stdin.resume();
    process.stdin.on("data", stdinHandler);
    process.stdout.on("resize", resizeHandler);

    const normalizedCommand = normalizeInteractiveCommand(cmd);
    await pty.sendInput(encoder.encode(`exec env ${normalizedCommand}\n`));
    const result = await pty.wait();
    return result.exitCode ?? 0;
  } finally {
    process.stdin.off("data", stdinHandler);
    process.stdout.off("resize", resizeHandler);
    if (stdinRawEnabled && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    await pty.disconnect().catch(() => undefined);
  }
}
