export const liveEnabled = process.env.E2E_LIVE === "1";
export const defaultServerUrl = process.env.APP_SERVER_URL ?? "http://localhost:3000";
export const responseTimeoutMs = Number(process.env.E2E_RESPONSE_TIMEOUT_MS ?? "180000");
export const commandTimeoutMs = Number(process.env.E2E_CLI_TIMEOUT_MS ?? String(responseTimeoutMs));
export const artifactTimeoutMs = Number(process.env.E2E_ARTIFACT_TIMEOUT_MS ?? "45000");
export const slackPollIntervalMs = Number(process.env.E2E_SLACK_POLL_INTERVAL_MS ?? "2500");
export const slackPostVerifyTimeoutMs = Number(
  process.env.E2E_SLACK_POST_VERIFY_TIMEOUT_MS ?? "90000",
);
export const gmailPollIntervalMs = Number(process.env.E2E_GMAIL_POLL_INTERVAL_MS ?? "2500");
export const transientRetryCount = Number(process.env.E2E_TRANSIENT_RETRY_COUNT ?? "1");
export const transientRetryDelayMs = Number(process.env.E2E_TRANSIENT_RETRY_DELAY_MS ?? "2000");
export const productionLiveTarget = (() => {
  try {
    return new URL(defaultServerUrl).hostname === "heybap.com";
  } catch {
    return false;
  }
})();
export const optionalProdFixtureTestsEnabled =
  process.env.E2E_ENABLE_PROD_OPTIONAL_FIXTURES === "1";

export const expectedUserEmail =
  process.env.E2E_TEST_EMAIL?.trim() ||
  process.env.APP_DEFAULT_USER_EMAIL?.trim() ||
  "bap@example.com";
export const expectedGmailAccountLabel = process.env.E2E_GMAIL_ACCOUNT_LABEL ?? "baptiste";
export const sourceChannelName = "experiment-bap-testing";
export const targetChannelName = process.env.E2E_SLACK_TARGET_CHANNEL ?? "ops-e2e-slack-testing";
export const echoPrefix = "test message: the previous message is:";

export const questionPrompt =
  process.env.E2E_CHAT_QUESTION_PROMPT ??
  "Use the question tool exactly once with header 'Pick', question 'Choose one', and options 'Alpha' and 'Beta'. After I answer, respond exactly as SELECTED=<answer>.";
export const fillPdfPrompt =
  process.env.E2E_FILL_PDF_PROMPT ??
  "Using your pdf-fill tool. Fill the attached PDF form. Use the name Sandra wherever a name is requested. Save the output as filled-sandra.pdf";

export type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
