import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertExpectedUserExists,
  assertExitOk,
  buildCliCommandArgs,
  closeDbPool,
  defaultServerUrl,
  ensureCliAuth,
  expectedUserEmail,
  getSlackAccessTokenForExpectedUser,
  getGenerationRuntimeFields,
  getCliClient,
  liveEnabled,
  parseSlackTimestamp,
  readLatestMessageOrNull,
  readLatestAssistantMessage,
  responseTimeoutMs,
  resolveChannelId,
  resolveLiveModel,
  slackPostVerifyTimeoutMs,
  targetChannelName,
  trackCliOutput,
  withIntegrationTokensTemporarilyRemoved,
  waitForGenerationState,
  waitForPendingInterrupt,
  waitForPromptGeneration,
} from "./live-fixtures";

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type RunningCommand = {
  write(chars: string): void;
  waitFor(pattern: RegExp, timeoutMs: number): Promise<string>;
  waitForExit(timeoutMs: number): Promise<CommandResult>;
  stop(signal?: NodeJS.Signals): void;
  stdout(): string;
  stderr(): string;
};

type SlackHistoryMessage = {
  ts?: string;
  text?: string;
  subtype?: string;
};

let liveModel = "";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runChatCommand(args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolveDone) => {
    const child = spawn("bun", args, {
      env: {
        ...process.env,
        APP_SERVER_URL: defaultServerUrl,
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
    }, timeoutMs);

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

function startInteractiveChatCommand(args: string[], options?: { pty?: boolean }): RunningCommand {
  const usePty = options?.pty ?? false;
  const child = usePty
    ? spawn(
        "python3",
        [
          "-c",
          [
            "import os, pty, select, sys",
            "argv = sys.argv[1:]",
            "pid, fd = pty.fork()",
            "if pid == 0:",
            "    os.execvp(argv[0], argv)",
            "stdin_fd = sys.stdin.fileno()",
            "stdout_fd = sys.stdout.fileno()",
            "while True:",
            "    ready, _, _ = select.select([fd, stdin_fd], [], [])",
            "    if fd in ready:",
            "        try:",
            "            data = os.read(fd, 4096)",
            "        except OSError:",
            "            data = b''",
            "        if not data:",
            "            break",
            "        os.write(stdout_fd, data)",
            "    if stdin_fd in ready:",
            "        try:",
            "            data = os.read(stdin_fd, 4096)",
            "        except OSError:",
            "            data = b''",
            "        if not data:",
            "            continue",
            "        os.write(fd, data)",
            "_, status = os.waitpid(pid, 0)",
            "sys.exit(os.waitstatus_to_exitcode(status))",
          ].join("\n"),
          "bun",
          ...args,
        ],
        {
          env: {
            ...process.env,
            APP_SERVER_URL: defaultServerUrl,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      )
    : spawn("bun", args, {
        env: {
          ...process.env,
          APP_SERVER_URL: defaultServerUrl,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

  let stdout = "";
  let stderr = "";
  let closed = false;
  let exitCode: number | null = null;
  const closeWaiters: Array<(result: CommandResult) => void> = [];

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += chunk.toString();
    trackCliOutput(stdout);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
    trackCliOutput(stderr);
  });
  child.on("close", (code) => {
    closed = true;
    exitCode = code;
    const result = { code, stdout, stderr, timedOut: false };
    while (closeWaiters.length > 0) {
      closeWaiters.shift()?.(result);
    }
  });
  child.on("error", (error) => {
    stderr += `\n${String(error)}\n`;
  });

  return {
    write(chars: string) {
      child.stdin.write(chars);
    },
    async waitFor(pattern: RegExp, timeoutMs: number): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      const poll = async (): Promise<string> => {
        if (pattern.test(stdout)) {
          return stdout;
        }
        if (closed) {
          throw new Error(
            `Command exited before matching ${pattern}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          );
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `Timed out waiting for ${pattern}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          );
        }
        await sleep(100);
        return poll();
      };

      return poll();
    },
    waitForExit(timeoutMs: number): Promise<CommandResult> {
      if (closed) {
        return Promise.resolve({ code: exitCode, stdout, stderr, timedOut: false });
      }
      return new Promise((resolveDone) => {
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          resolveDone({ code: exitCode, stdout, stderr, timedOut: true });
        }, timeoutMs);
        closeWaiters.push((result) => {
          clearTimeout(timer);
          resolveDone(result);
        });
      });
    },
    stop(signal = "SIGINT") {
      child.kill(signal);
    },
    stdout() {
      return stdout;
    },
    stderr() {
      return stderr;
    },
  };
}

function extractGenerationId(output: string): string {
  const match = output.match(/\[generation\]\s+([^\s]+)/);
  if (!match?.[1]) {
    throw new Error(`Missing generation id in output:\n${output}`);
  }
  return match[1];
}

function extractSandboxId(output: string): string {
  const match = output.match(/\[sandbox\]\s+provider=[^\s]+\s+id=([^\s]+)/);
  if (!match?.[1]) {
    throw new Error(`Missing sandbox id in output:\n${output}`);
  }
  return match[1];
}

function extractAttachGenerationId(output: string): string {
  const generations = Array.from(output.matchAll(/\[generation\]\s+([^\s]+)/g)).map(
    (match) => match[1],
  );
  const generationId = generations.at(-1);
  if (!generationId) {
    throw new Error(`Missing resumed generation id in attach output:\n${output}`);
  }
  return generationId;
}

async function waitForApprovalPromptAnsweringQuestions(
  command: RunningCommand,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let answeredQuestionPromptCount = 0;
  const poll = async (): Promise<void> => {
    const stdout = command.stdout();
    if (/Approve\? \(y\/n\)/.test(stdout)) {
      return;
    }

    const questionPromptCount = stdout.match(/Select an option/g)?.length ?? 0;
    while (answeredQuestionPromptCount < questionPromptCount) {
      command.write("1\n");
      answeredQuestionPromptCount += 1;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for approval prompt while answering questions\nstdout:\n${command.stdout()}\nstderr:\n${command.stderr()}`,
      );
    }

    await sleep(100);
    return poll();
  };

  await poll();
}

async function pollSlackMessagesContaining(args: {
  token: string;
  channelId: string;
  afterTs: number;
  marker: string;
  expectedCount: number;
  timeoutMs: number;
}): Promise<SlackHistoryMessage[]> {
  const deadline = Date.now() + args.timeoutMs;
  const poll = async (): Promise<SlackHistoryMessage[]> => {
    const response = await fetch("https://slack.com/api/conversations.history", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: args.channelId,
        limit: 50,
      }),
    });
    if (!response.ok) {
      throw new Error(`Slack history failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      messages?: SlackHistoryMessage[];
    };
    if (!payload.ok) {
      throw new Error(`Slack history error: ${String(payload.error ?? "unknown")}`);
    }
    const matches = (payload.messages ?? []).filter((message) => {
      const ts = parseSlackTimestamp(message.ts ?? "0");
      return (
        ts > args.afterTs && typeof message.text === "string" && message.text.includes(args.marker)
      );
    });
    if (matches.length >= args.expectedCount) {
      return matches;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${args.expectedCount} Slack messages containing ${args.marker}`,
      );
    }
    await sleep(1_000);
    return poll();
  };

  return poll();
}

describe.runIf(liveEnabled)("@live CLI chat interrupt", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  afterAll(async () => {
    await closeDbPool();
  });

  test(
    "cancels in-flight generation and prints cancelled marker",
    { timeout: Math.max(responseTimeoutMs + 90_000, 270_000) },
    async () => {
      await assertExpectedUserExists(expectedUserEmail);

      const interruptToken = `interrupt-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

      const promptBase =
        process.env.E2E_CHAT_INTERRUPT_PROMPT ??
        "Use the bash tool to run exactly `sleep 30` and wait for it to finish before replying. Do not summarize early.";
      const prompt = `${promptBase}\nInterrupt token: ${interruptToken}`;

      const runPromise = runChatCommand(
        buildCliCommandArgs("chat", "--message", prompt, "--model", liveModel, "--no-validate"),
        Math.max(responseTimeoutMs, 180_000),
      );

      const target = await waitForPromptGeneration({
        promptToken: interruptToken,
        timeoutMs: 90_000,
      });

      const client = getCliClient();
      await sleep(15_000);
      const cancelResult = await client.generation.cancelGeneration({
        generationId: target.generationId,
      });
      expect(cancelResult.success).toBe(true);

      const result = await runPromise;
      assertExitOk(result, "chat interrupt");
      expect(result.stdout).toContain("[cancelled]");
      expect(result.stdout).toContain("[conversation]");
      expect(result.stdout).not.toContain("[error]");

      const latest = await readLatestAssistantMessage(target.conversationId);
      if (!latest) {
        throw new Error(
          `No assistant message persisted for interrupted generation in conversation ${target.conversationId}`,
        );
      }

      const hasInterruptedText =
        latest.content.includes("Interrupted by user") ||
        (Array.isArray(latest.contentParts) &&
          latest.contentParts.some(
            (part) =>
              part &&
              typeof part === "object" &&
              "type" in part &&
              "content" in part &&
              part.type === "system" &&
              part.content === "Interrupted by user",
          ));
      expect(hasInterruptedText).toBe(true);
    },
  );

  test(
    "parks deferred Slack approval and attach resumes it on a fresh sandbox",
    { timeout: Math.max(responseTimeoutMs + 120_000, 360_000) },
    async () => {
      const slackAccessToken = await getSlackAccessTokenForExpectedUser();
      const targetChannelId = await resolveChannelId(slackAccessToken, targetChannelName);
      const latestTargetBeforePrompt = await readLatestMessageOrNull(
        slackAccessToken,
        targetChannelId,
      );
      const latestTargetBeforePromptTs = parseSlackTimestamp(latestTargetBeforePrompt?.ts ?? "0");
      const marker = `slack-chaos-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const prompt = [
        "Use the Slack integration tool only.",
        "Do not ask any clarification questions.",
        "Do not list channels.",
        "Run exactly this Slack command and do not change the flags:",
        `slack send -c ${targetChannelId} -t "hi ${marker}" --as bot`,
        "Do not use custom scripts, direct Slack API calls, node, python, or curl.",
        "After it succeeds, reply with only the posted text.",
      ].join("\n");

      const result = await runChatCommand(
        buildCliCommandArgs(
          "chat",
          "--chaos-approval",
          "defer",
          "--chaos-approval-park-after",
          "5s",
          "--message",
          prompt,
          "--model",
          liveModel,
          "--no-validate",
        ),
        Math.max(responseTimeoutMs, 120_000),
      );

      assertExitOk(result, "chat chaos approval parked");
      expect(result.stdout).toContain("[approval_needed]");
      expect(result.stdout).toContain("[approval_deferred]");

      const conversationId = result.stdout.match(/\[conversation\]\s+([^\s]+)/)?.[1];
      const generationId = extractGenerationId(result.stdout);
      if (!conversationId) {
        throw new Error(`Missing conversation id in output:\n${result.stdout}`);
      }

      await waitForGenerationState({
        generationId,
        expectedStatus: "awaiting_approval",
        timeoutMs: 30_000,
      });
      const attach = startInteractiveChatCommand(
        buildCliCommandArgs("chat", "--attach", conversationId),
        { pty: true },
      );

      await attach.waitFor(/\[attach\] conversation=/, 60_000);
      await waitForApprovalPromptAnsweringQuestions(attach, 60_000);
      attach.write("y\n");
      await attach.waitFor(/\[approval_accepted\]/, 30_000);
      const postedMessages = await pollSlackMessagesContaining({
        token: slackAccessToken,
        channelId: targetChannelId,
        afterTs: latestTargetBeforePromptTs,
        marker,
        expectedCount: 1,
        timeoutMs: Math.min(responseTimeoutMs, slackPostVerifyTimeoutMs),
      });
      const texts = postedMessages.map((message) => message.text ?? "");
      expect(texts.some((text) => text.includes(`hi ${marker}`))).toBe(true);

      const attachResult = await attach.waitForExit(Math.max(responseTimeoutMs, 120_000));
      assertExitOk(attachResult, "chat chaos approval attach");
      expect(attachResult.stdout).not.toContain("[approval_parked]");
      expect(attachResult.stdout).toContain("[approval_accepted]");
    },
  );

  test(
    "parks disconnected Notion auth after the hot wait",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const prompt =
        "Use the Notion integration to list my first 5 Notion databases by name. Do not use any other source.";

      const result = await withIntegrationTokensTemporarilyRemoved({
        email: expectedUserEmail,
        integrationType: "notion",
        run: () =>
          runChatCommand(
            buildCliCommandArgs(
              "chat",
              "--chaos-approval-park-after",
              "5s",
              "--message",
              prompt,
              "--model",
              liveModel,
              "--no-validate",
            ),
            Math.max(responseTimeoutMs, 120_000),
          ),
      });

      assertExitOk(result, "chat chaos auth parked");
      expect(result.stdout).toContain("[auth_needed] notion");
      expect(result.stdout).toContain("[conversation]");

      const generationId = extractGenerationId(result.stdout);
      await waitForGenerationState({
        generationId,
        expectedStatus: "awaiting_auth",
        timeoutMs: 30_000,
      });
      await waitForPendingInterrupt({
        generationId,
        expectedKind: "auth",
        timeoutMs: 30_000,
      });
    },
  );

  test(
    "parks runtime deadline and attach resumes with a fresh full budget",
    { timeout: Math.max(responseTimeoutMs + 120_000, 360_000) },
    async () => {
      const result = await runChatCommand(
        buildCliCommandArgs(
          "chat",
          "--chaos-run-deadline",
          "5s",
          "--message",
          "analyze my last 30 emails and classify them as urgent with a summary of next action point to do",
          "--model",
          liveModel,
          "--no-validate",
        ),
        Math.max(responseTimeoutMs, 120_000),
      );

      assertExitOk(result, "chat chaos runtime parked");
      expect(result.stdout).toContain("[run_deadline_parked]");

      const conversationId = result.stdout.match(/\[conversation\]\s+([^\s]+)/)?.[1];
      const generationId = extractGenerationId(result.stdout);
      const parkedSandboxId = extractSandboxId(result.stdout);
      if (!conversationId) {
        throw new Error(`Missing conversation id in output:\n${result.stdout}`);
      }

      await waitForGenerationState({
        generationId,
        expectedStatus: "paused",
        completionReason: "run_deadline",
        timeoutMs: 30_000,
      });

      const attach = startInteractiveChatCommand(
        buildCliCommandArgs("chat", "--attach", conversationId),
      );

      await attach.waitFor(/reason=run_deadline; sending continue/, 60_000);
      await attach.waitFor(/\[generation\]\s+[^\s]+/, 30_000);
      await attach.waitFor(/\[sandbox\] provider=[^\n]+/i, 60_000);
      await attach.waitFor(/\[thinking\]|\[tool_use\]/, 60_000);

      const resumedOutput = attach.stdout();
      const resumedGenerationId = extractAttachGenerationId(resumedOutput);
      const resumedSandboxId = extractSandboxId(resumedOutput);
      expect(resumedSandboxId).not.toBe(parkedSandboxId);

      const resumedGeneration = await getGenerationRuntimeFields(resumedGenerationId);
      expect(resumedGeneration?.remainingRunMs).toBe(15 * 60 * 1000);
      expect(
        (resumedGeneration?.executionPolicy as { debugRunDeadlineMs?: number } | null | undefined)
          ?.debugRunDeadlineMs,
      ).toBeUndefined();

      attach.stop("SIGINT");
      const attachResult = await attach.waitForExit(10_000);
      expect(attachResult.stdout).toContain(`[generation] ${resumedGenerationId}`);
    },
  );
});
