import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DaytonaSandboxBackend,
  getDaytonaClientConfig,
  getDaytonaSandboxLifecycleIntervals,
  isDaytonaConfigured,
  listDaytonaSandboxPages,
  normalizeDaytonaListItems,
} from "./daytona";
import { generationLifecyclePolicy } from "../services/lifecycle-policy";

const { daytonaCreateMock } = vi.hoisted(() => ({
  daytonaCreateMock: vi.fn(),
}));

vi.mock("@daytonaio/sdk", () => ({
  Daytona: vi.fn(function Daytona() {
    return {
      create: daytonaCreateMock,
    };
  }),
}));

const originalEnv = {
  DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
  DAYTONA_API_URL: process.env.DAYTONA_API_URL,
  DAYTONA_TARGET: process.env.DAYTONA_TARGET,
  DAYTONA_SERVER_URL: process.env.DAYTONA_SERVER_URL,
  E2B_DAYTONA_SANDBOX_NAME: process.env.E2B_DAYTONA_SANDBOX_NAME,
};

function restoreEnvVar(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("daytona sandbox config", () => {
  afterEach(() => {
    daytonaCreateMock.mockReset();
    restoreEnvVar("DAYTONA_API_KEY");
    restoreEnvVar("DAYTONA_API_URL");
    restoreEnvVar("DAYTONA_TARGET");
    restoreEnvVar("DAYTONA_SERVER_URL");
    restoreEnvVar("E2B_DAYTONA_SANDBOX_NAME");
  });

  it("builds Daytona client config from the self-hosted env", () => {
    process.env.DAYTONA_API_KEY = "test-daytona-key";
    process.env.DAYTONA_API_URL = "http://localhost:3300/api";
    process.env.DAYTONA_TARGET = "us";

    expect(getDaytonaClientConfig()).toEqual({
      apiKey: "test-daytona-key",
      apiUrl: "http://localhost:3300/api",
      target: "us",
    });
    expect(isDaytonaConfigured()).toBe(true);
  });

  it("ignores legacy serverUrl env for the runtime client config", () => {
    process.env.DAYTONA_API_KEY = "test-daytona-key";
    delete process.env.DAYTONA_API_URL;
    delete process.env.DAYTONA_TARGET;
    process.env.DAYTONA_SERVER_URL = "https://cloud.daytona.io";

    expect(getDaytonaClientConfig()).toEqual({
      apiKey: "test-daytona-key",
    });
  });
});

describe("daytona sandbox lifecycle", () => {
  afterEach(() => {
    daytonaCreateMock.mockReset();
    restoreEnvVar("E2B_DAYTONA_SANDBOX_NAME");
  });

  it("derives auto-stop from the Generation run deadline and deletes five minutes after stop", () => {
    const runDeadlineMinutes = Math.ceil(generationLifecyclePolicy.runDeadlineMs / 60_000);

    expect(getDaytonaSandboxLifecycleIntervals()).toEqual({
      autoStopInterval: runDeadlineMinutes,
      autoDeleteInterval: 5,
    });
  });

  it("passes lifecycle intervals when creating a Daytona backend sandbox", async () => {
    const lifecycleIntervals = getDaytonaSandboxLifecycleIntervals();
    daytonaCreateMock.mockResolvedValue({
      process: { executeCommand: vi.fn() },
      fs: { uploadFile: vi.fn(), downloadFile: vi.fn() },
      delete: vi.fn(),
    });

    const backend = new DaytonaSandboxBackend();
    await backend.setup("conversation-1");

    expect(daytonaCreateMock).toHaveBeenCalledWith({
      snapshot: "bap-agent-dev",
      autoStopInterval: lifecycleIntervals.autoStopInterval,
      autoDeleteInterval: lifecycleIntervals.autoDeleteInterval,
    });
  });
});

describe("daytona sandbox listing", () => {
  it("normalizes legacy array and paginated list responses", () => {
    expect(normalizeDaytonaListItems([{ id: "sbx-array" }])).toEqual([{ id: "sbx-array" }]);
    expect(normalizeDaytonaListItems({ items: [{ id: "sbx-page" }] })).toEqual([
      { id: "sbx-page" },
    ]);
  });

  it("collects all paginated Daytona sandbox pages", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "sbx-1" }], totalPages: 2 })
      .mockResolvedValueOnce({ items: [{ id: "sbx-2" }], totalPages: 2 });

    await expect(
      listDaytonaSandboxPages(
        { list },
        {
          "bap-generation-id": "gen-1",
        },
      ),
    ).resolves.toEqual([{ id: "sbx-1" }, { id: "sbx-2" }]);
    expect(list).toHaveBeenNthCalledWith(1, { "bap-generation-id": "gen-1" }, 1, 100);
    expect(list).toHaveBeenNthCalledWith(2, { "bap-generation-id": "gen-1" }, 2, 100);
  });

  it("collects current async iterable Daytona list responses for unfiltered inventory", async () => {
    async function* sandboxes() {
      yield { id: "sbx-1", labels: { "bap-generation-id": "gen-1" } };
      yield { id: "sbx-2", labels: { "bap-generation-id": "gen-2" } };
    }
    const list = vi.fn(() => sandboxes());

    await expect(listDaytonaSandboxPages({ list })).resolves.toEqual([
      { id: "sbx-1", labels: { "bap-generation-id": "gen-1" } },
      { id: "sbx-2", labels: { "bap-generation-id": "gen-2" } },
    ]);
    expect(list).toHaveBeenCalledWith({ limit: 100 });
  });
});
