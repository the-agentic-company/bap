import { spawn } from "node:child_process";
import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  buildCliCommandArgs,
  defaultServerUrl,
  ensureCliAuth,
  liveEnabled,
  liveSandboxProvider,
  questionPrompt,
  responseTimeoutMs,
  resolveLiveModel,
  runBunCommand,
  runChatMessage,
  trackCliOutput,
  transientRetryCount,
  transientRetryDelayMs,
} from "./live-fixtures";

let liveModel = "";

type InteractiveCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const interactiveQuestionChatDriver = String.raw`
import os
import pty
import select
import subprocess
import sys
import time

command = [
    "bun",
    "run",
    "--cwd",
    "../..",
    "cmdclaw",
    "--",
    "chat",
    "--message",
    os.environ["CHAT_PROMPT"],
    "--model",
    os.environ["CHAT_MODEL"],
    "--sandbox",
    os.environ["CHAT_SANDBOX_PROVIDER"],
    "--no-validate",
]

env = dict(os.environ)
env["CMDCLAW_SERVER_URL"] = os.environ["CHAT_SERVER_URL"]

master_fd, slave_fd = pty.openpty()
process = subprocess.Popen(
    command,
    cwd=os.environ["CHAT_CWD"],
    env=env,
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
)
os.close(slave_fd)

output = bytearray()
answered_question = False
sent_followup = False
sent_exit = False
followup_count = 0

def drive_session(text: str) -> None:
    global answered_question, sent_followup, sent_exit, followup_count

    if not answered_question and "Select an option" in text:
        os.write(master_fd, b"2\n")
        answered_question = True
        return

    next_followup_count = text.count("followup> ")
    while followup_count < next_followup_count:
        followup_count += 1
        if not sent_followup:
            os.write(
                master_fd,
                b"What option did I choose in the previous question? Reply exactly FOLLOWUP=<answer>.\n",
            )
            sent_followup = True
            return
        if not sent_exit:
            os.write(master_fd, b"\n")
            sent_exit = True
            return

while process.poll() is None:
    ready, _, _ = select.select([master_fd], [], [], 1.0)
    if not ready:
        continue
    try:
        chunk = os.read(master_fd, 4096)
    except OSError:
        break
    if not chunk:
        continue
    output.extend(chunk)
    sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()
    drive_session(output.decode("utf-8", errors="ignore"))

drain_deadline = time.time() + 2.0
while time.time() < drain_deadline:
    ready, _, _ = select.select([master_fd], [], [], 0.1)
    if not ready:
        continue
    try:
        chunk = os.read(master_fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()

os.close(master_fd)
sys.exit(process.wait())
`;

async function runInteractiveQuestionChat(args: {
  model: string;
  timeoutMs: number;
}): Promise<InteractiveCommandResult> {
  return new Promise((resolveDone) => {
    const child = spawn("python3", ["-c", interactiveQuestionChatDriver], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CHAT_CWD: process.cwd(),
        CHAT_MODEL: args.model,
        CHAT_PROMPT: questionPrompt,
        CHAT_SANDBOX_PROVIDER: liveSandboxProvider,
        CHAT_SERVER_URL: defaultServerUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      child.kill("SIGTERM");
    }, args.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      trackCliOutput(stdout);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      trackCliOutput(stderr);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveDone({ code, stdout, stderr, timedOut });
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stderr += `\n${String(error)}\n`;
      resolveDone({ code: -1, stdout, stderr, timedOut });
    });
  });
}

const interactiveQuestionAttachDriver = String.raw`
import os
import pty
import select
import subprocess
import sys
import time

command = [
    "bun",
    "run",
    "--cwd",
    "../..",
    "cmdclaw",
    "--",
    "chat",
    "--attach",
    os.environ["CHAT_CONVERSATION_ID"],
]

env = dict(os.environ)
env["CMDCLAW_SERVER_URL"] = os.environ["CHAT_SERVER_URL"]

master_fd, slave_fd = pty.openpty()
process = subprocess.Popen(
    command,
    cwd=os.environ["CHAT_CWD"],
    env=env,
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
)
os.close(slave_fd)

output = bytearray()
answered_question = False

while process.poll() is None:
    ready, _, _ = select.select([master_fd], [], [], 1.0)
    if not ready:
        continue
    try:
        chunk = os.read(master_fd, 4096)
    except OSError:
        break
    if not chunk:
        continue
    output.extend(chunk)
    sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()
    text = output.decode("utf-8", errors="ignore")
    if not answered_question and "Select an option" in text:
        os.write(master_fd, b"2\n")
        answered_question = True

drain_deadline = time.time() + 2.0
while time.time() < drain_deadline:
    ready, _, _ = select.select([master_fd], [], [], 0.1)
    if not ready:
        continue
    try:
        chunk = os.read(master_fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()

os.close(master_fd)
sys.exit(process.wait())
`;

async function runInteractiveQuestionAttach(args: {
  conversationId: string;
  timeoutMs: number;
}): Promise<InteractiveCommandResult> {
  return new Promise((resolveDone) => {
    const child = spawn("python3", ["-c", interactiveQuestionAttachDriver], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CHAT_CWD: process.cwd(),
        CHAT_CONVERSATION_ID: args.conversationId,
        CHAT_SERVER_URL: defaultServerUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      timedOut = true;
      child.kill("SIGTERM");
    }, args.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      trackCliOutput(stdout);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      trackCliOutput(stderr);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveDone({ code, stdout, stderr, timedOut });
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stderr += `\n${String(error)}\n`;
      resolveDone({ code: -1, stdout, stderr, timedOut });
    });
  });
}

function hasTransientInteractiveFailure(result: InteractiveCommandResult): boolean {
  return (
    result.stdout.includes("[error] OpenCode server failed readiness check") ||
    result.stdout.includes("[error] The sandbox stopped while this run was still active.")
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runInteractiveQuestionChatWithRetry(args: {
  model: string;
  timeoutMs: number;
}): Promise<InteractiveCommandResult> {
  const runAttempt = async (attempt: number): Promise<InteractiveCommandResult> => {
    const result = await runInteractiveQuestionChat(args);
    if (!hasTransientInteractiveFailure(result) || attempt >= transientRetryCount) {
      return result;
    }

    await sleep(transientRetryDelayMs);
    return runAttempt(attempt + 1);
  };

  return runAttempt(0);
}

describe.runIf(liveEnabled)("@live CLI chat question", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "submits Beta and model uses selected answer",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const result = await runChatMessage({
        message: questionPrompt,
        model: liveModel,
        questionAnswers: ["Beta"],
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat question");
      expect(result.stdout).toContain("SELECTED=Beta");
      expect(result.stdout).not.toContain("[error]");
    },
  );

  test.runIf(process.platform !== "darwin")(
    "keeps the tty session open for a native follow-up after answering a question",
    { timeout: Math.max(responseTimeoutMs * 2 + 90_000, 420_000) },
    async () => {
      const result = await runInteractiveQuestionChatWithRetry({
        model: liveModel,
        timeoutMs: Math.max(responseTimeoutMs * 2, 300_000),
      });

      assertExitOk(result, "interactive chat question followup");
      expect(result.stdout).toContain("SELECTED=Beta");
      expect(result.stdout).toContain("FOLLOWUP=Beta");
      expect(result.stdout).toContain("followup> ");
      expect(result.stdout).not.toContain("[error]");
    },
  );

  test(
    "parks a runtime question and attach resumes it with the selected answer",
    { timeout: Math.max(responseTimeoutMs + 120_000, 360_000) },
    async () => {
      const parked = await runBunCommand(
        buildCliCommandArgs(
          "chat",
          "--chaos-approval",
          "defer",
          "--chaos-approval-park-after",
          "5s",
          "--message",
          questionPrompt,
          "--model",
          liveModel,
          "--sandbox",
          liveSandboxProvider,
          "--no-validate",
        ),
        Math.max(responseTimeoutMs, 120_000),
      );

      assertExitOk(parked, "chat question parked");
      expect(parked.stdout).toContain("[approval_needed] question");
      expect(parked.stdout).toContain("[approval_deferred]");
      expect(parked.stdout).toContain("[approval_parked]");

      const conversationId = parked.stdout.match(/\[conversation\]\s+([^\s]+)/)?.[1];
      if (!conversationId) {
        throw new Error(`Missing conversation id in output:\n${parked.stdout}`);
      }

      const resumed = await runInteractiveQuestionAttach({
        conversationId,
        timeoutMs: Math.max(responseTimeoutMs, 120_000),
      });

      assertExitOk(resumed, "chat question attach resume");
      expect(resumed.stdout).toContain("[approval_accepted]");
      expect(resumed.stdout).toContain("SELECTED=Beta");
      expect(resumed.stdout).not.toContain("[error]");
    },
  );
});
