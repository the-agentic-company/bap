import { existsSync } from "node:fs";
import { expect, test } from "../live-fixtures";

const liveEnabled = process.env.E2E_LIVE === "1";
const storageStatePath = process.env.E2E_AUTH_STATE_PATH ?? "playwright/.auth/user.json";
const responseTimeoutMs = Number(process.env.E2E_RESPONSE_TIMEOUT_MS ?? "180000");
const builderPrompt =
  process.env.E2E_COWORKER_BUILDER_PROMPT ??
  "create a coworker that summarizes every new support ticket";

test.describe("@live coworker landing builder", () => {
  test.skip(!liveEnabled, "Set E2E_LIVE=1 to run live Playwright tests");
  test.use({ storageState: storageStatePath });

  test("submits landing prompt directly to an edit route with the prompt visible", async ({
    page,
  }) => {
    test.setTimeout(Math.max(responseTimeoutMs + 60_000, 240_000));

    if (!existsSync(storageStatePath)) {
      throw new Error(
        `Missing auth storage state at "${storageStatePath}". Generate it first before running @live e2e tests.`,
      );
    }

    const visitedPaths: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        visitedPaths.push(new URL(frame.url()).pathname);
      }
    });

    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

    const promptInput = page.getByRole("textbox", { name: "Automation prompt" });
    await promptInput.fill(builderPrompt);
    await promptInput.press("Enter");

    await expect
      .poll(async () => page.url(), {
        timeout: responseTimeoutMs,
        message: "Landing prompt did not navigate directly to /agents/edit/:id",
      })
      .toMatch(/\/agents\/edit\/[^/?#]+/);

    expect(visitedPaths).not.toContain("/agents/new");
    await expect(page.getByText(builderPrompt).first()).toBeVisible({ timeout: responseTimeoutMs });
  });
});
