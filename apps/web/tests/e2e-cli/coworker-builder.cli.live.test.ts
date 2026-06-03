import { spawn } from "node:child_process";
import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  buildCliCommandArgs,
  commandTimeoutMs,
  defaultServerUrl,
  ensureCliAuth,
  liveEnabled,
  liveSandboxProvider,
  requireMatch,
  responseTimeoutMs,
  resolveLiveModel,
  runBunCommand,
  trackCliOutput,
  waitForGenerationState,
} from "./live-fixtures";

let liveModel = "";

type InteractiveCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const buildMessage = "create a coworker that says hi";

const coworkerBuildDriver = String.raw`
import os
import pty
import json
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
    "coworker",
    "build",
]

attach = os.environ.get("COWORKER_ATTACH")
if attach:
    command.extend(["--attach", attach])
else:
    command.extend(["--message", os.environ["COWORKER_BUILD_MESSAGE"]])

command.extend([
    "--model",
    os.environ["COWORKER_MODEL"],
    "--sandbox",
    os.environ["COWORKER_SANDBOX_PROVIDER"],
    "--no-validate",
])

if os.environ.get("COWORKER_CHAOS_APPROVAL"):
    command.extend(["--chaosApproval", os.environ["COWORKER_CHAOS_APPROVAL"]])

if os.environ.get("COWORKER_CHAOS_APPROVAL_PARK_AFTER"):
    command.extend(["--chaosApprovalParkAfter", os.environ["COWORKER_CHAOS_APPROVAL_PARK_AFTER"]])

if os.environ.get("COWORKER_CHAOS_RUN_DEADLINE"):
    command.extend(["--chaosRunDeadline", os.environ["COWORKER_CHAOS_RUN_DEADLINE"]])

for answer in json.loads(os.environ.get("COWORKER_QUESTION_ANSWERS") or "[]"):
    command.extend(["--question-answer", answer])

env = dict(os.environ)
env["CMDCLAW_SERVER_URL"] = os.environ["COWORKER_SERVER_URL"]

master_fd, slave_fd = pty.openpty()
process = subprocess.Popen(
    command,
    cwd=os.environ["COWORKER_CWD"],
    env=env,
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
)
os.close(slave_fd)

output = bytearray()
answered_prompts = 0
followup_count = 0
sent_exit = False

def drive_session(text: str) -> None:
    global answered_prompts, followup_count, sent_exit

    select_count = text.count("Select an option")
    while answered_prompts < select_count:
        os.write(master_fd, b"1\n")
        answered_prompts += 1
        return

    next_followup_count = text.count("followup> ")
    while followup_count < next_followup_count:
        followup_count += 1
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

function runInteractiveCoworkerBuild(args: {
  attach?: string;
  chaosApproval?: "ask" | "defer";
  chaosApprovalParkAfter?: string;
  chaosRunDeadline?: string;
  message?: string;
  questionAnswers?: readonly string[];
  timeoutMs: number;
}): Promise<InteractiveCommandResult> {
  return new Promise((resolveDone) => {
    const child = spawn("python3", ["-c", coworkerBuildDriver], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        COWORKER_ATTACH: args.attach ?? "",
        COWORKER_BUILD_MESSAGE: args.message ?? buildMessage,
        COWORKER_CHAOS_APPROVAL: args.chaosApproval ?? "",
        COWORKER_CHAOS_APPROVAL_PARK_AFTER: args.chaosApprovalParkAfter ?? "",
        COWORKER_CHAOS_RUN_DEADLINE: args.chaosRunDeadline ?? "",
        COWORKER_CWD: process.cwd(),
        COWORKER_MODEL: liveModel,
        COWORKER_QUESTION_ANSWERS: JSON.stringify(args.questionAnswers ?? []),
        COWORKER_SANDBOX_PROVIDER: liveSandboxProvider,
        COWORKER_SERVER_URL: defaultServerUrl,
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

async function expectCoworkerPromptContainsHi(coworkerId: string): Promise<void> {
  const shown = await runBunCommand(
    buildCliCommandArgs("coworker", "get", coworkerId, "--json"),
    commandTimeoutMs,
  );

  assertExitOk(shown, "coworker get");
  const details = JSON.parse(shown.stdout) as { prompt?: string };
  expect(details.prompt?.toLowerCase()).toMatch(/\b(hi|hello|greet|greeting)\b/);
}

function extractBuilderCoworkerId(output: string): string {
  return requireMatch(output, /Created builder coworker:\s*[\s\S]*?\n\s*id:\s+([^\s]+)/, output);
}

function extractBuilderConversationId(output: string): string {
  return requireMatch(output, /builder conversation id:\s+([^\s]+)/, output);
}

function extractGenerationId(output: string): string {
  return requireMatch(output, /\[generation\]\s+([^\s]+)/, output);
}

describe.runIf(liveEnabled)("@live CLI coworker builder", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "builds a manual coworker and persists hi instructions",
    { timeout: Math.max(responseTimeoutMs + 240_000, 480_000) },
    async () => {
      const result = await runInteractiveCoworkerBuild({
        timeoutMs: Math.max(responseTimeoutMs + 120_000, 300_000),
      });

      assertExitOk(result, "coworker build");
      expect(result.stdout).toContain("[approval_accepted]");
      expect(result.stdout).toContain("coworker edit");
      expect(result.stdout).toContain("Saved coworker edits");
      expect(result.stdout).not.toContain("[error]");

      await expectCoworkerPromptContainsHi(extractBuilderCoworkerId(result.stdout));
    },
  );

  test(
    "parks a builder question, attach resumes it, and persists hi instructions",
    { timeout: Math.max(responseTimeoutMs * 2 + 120_000, 480_000) },
    async () => {
      const parked = await runInteractiveCoworkerBuild({
        chaosApproval: "defer",
        chaosApprovalParkAfter: "5s",
        timeoutMs: Math.max(responseTimeoutMs, 180_000),
      });

      assertExitOk(parked, "coworker build parked");
      expect(parked.stdout).toContain("[approval_needed] question");
      expect(parked.stdout).toContain("[approval_deferred]");
      expect(parked.stdout).toContain("[approval_parked]");
      expect(parked.stdout).not.toContain("[error]");

      const coworkerId = extractBuilderCoworkerId(parked.stdout);
      const conversationId = extractBuilderConversationId(parked.stdout);
      const resumed = await runInteractiveCoworkerBuild({
        attach: conversationId,
        timeoutMs: Math.max(responseTimeoutMs, 180_000),
      });

      assertExitOk(resumed, "coworker build attach");
      expect(resumed.stdout).toContain("[approval_accepted]");
      expect(resumed.stdout).toContain("coworker edit");
      expect(resumed.stdout).toContain("Saved coworker edits");
      expect(resumed.stdout).not.toContain("[error]");

      await expectCoworkerPromptContainsHi(coworkerId);
    },
  );

  test(
    "parks on runtime deadline, attach resumes it, and persists hi instructions",
    { timeout: Math.max(responseTimeoutMs * 2 + 120_000, 480_000) },
    async () => {
      const parked = await runInteractiveCoworkerBuild({
        chaosRunDeadline: "5s",
        message:
          "create a manual coworker named Hi Bot. It should simply reply exactly hi when run. Use no integrations.",
        timeoutMs: Math.max(responseTimeoutMs, 180_000),
      });

      assertExitOk(parked, "coworker build runtime deadline parked");
      expect(parked.stdout).toContain("[run_deadline_parked]");
      expect(parked.stdout).not.toContain("[error]");

      const coworkerId = extractBuilderCoworkerId(parked.stdout);
      const conversationId = extractBuilderConversationId(parked.stdout);
      await waitForGenerationState({
        generationId: extractGenerationId(parked.stdout),
        expectedStatus: "paused",
        completionReason: "run_deadline",
        timeoutMs: 30_000,
      });

      const resumed = await runInteractiveCoworkerBuild({
        attach: conversationId,
        questionAnswers: ["Manual", "No integrations", "Keep current model (Recommended)"],
        timeoutMs: Math.max(responseTimeoutMs, 240_000),
      });

      assertExitOk(resumed, "coworker build runtime deadline attach");
      expect(resumed.stdout).toContain("reason=run_deadline; sending continue");
      expect(resumed.stdout).toContain("coworker edit");
      expect(resumed.stdout).toContain("Saved coworker edits");
      expect(resumed.stdout).not.toContain("[error]");

      await expectCoworkerPromptContainsHi(coworkerId);
    },
  );
});
