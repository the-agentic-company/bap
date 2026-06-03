import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  ensureCliAuth,
  liveEnabled,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
  transientRetryCount,
  transientRetryDelayMs,
} from "./live-fixtures";

const fixtureFilePath = resolve(process.cwd(), "tests/e2e/fixtures/hello.txt");
const expectedToken = "404df6e0-8ec4-4453-9997-f6e2285acb77";
const fileUploadPrompt =
  process.env.E2E_CHAT_FILE_UPLOAD_PROMPT ??
  "Open the attached file and read it. Reply with the exact file content only.";
const fileUploadCliLiveEnabled = process.env.E2E_ENABLE_FLAKY_FILE_UPLOAD_CLI === "1";

let liveModel = "";

function sleep(ms: number): Promise<void> {
  return new Promise((resolveDone) => setTimeout(resolveDone, ms));
}

async function runFileUploadPromptWithRetry() {
  const runAttempt = async (attempt: number) => {
    const result = await runChatMessage({
      message: fileUploadPrompt,
      model: liveModel,
      files: [fixtureFilePath],
      timeoutMs: responseTimeoutMs,
    });

    if (result.stdout.includes(expectedToken) || attempt >= transientRetryCount) {
      return result;
    }

    await sleep(transientRetryDelayMs);
    return runAttempt(attempt + 1);
  };

  return runAttempt(0);
}

describe.runIf(liveEnabled)("@live CLI chat file upload", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test.runIf(fileUploadCliLiveEnabled)(
    "uploads txt file and assistant can read its content",
    { timeout: Math.max(responseTimeoutMs + 60_000, 240_000) },
    async () => {
      if (!existsSync(fixtureFilePath)) {
        throw new Error(`Missing test fixture at ${fixtureFilePath}`);
      }

      const result = await runFileUploadPromptWithRetry();

      assertExitOk(result, "chat file-upload");
      expect(result.stdout).toContain("[conversation]");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).toContain(expectedToken);
    },
  );
});
