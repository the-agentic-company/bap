import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: {
      user: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(),
  },
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: dbMock,
}));

vi.mock("./telemetry-slack", () => ({
  postMessageToOpsTelemetryChannel: vi.fn(),
}));

vi.mock("../queues/queue-client", () => ({
  DAILY_TELEMETRY_DIGEST_JOB_NAME: "daily-telemetry-digest",
  getQueue: vi.fn(),
}));

import {
  buildDailyTelemetryDigestMessage,
  getDailyTelemetryDigestSummary,
} from "./telemetry-digest";

function mockCountSelect(value: number) {
  const where = vi.fn().mockResolvedValue([{ value }]);
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ where, innerJoin }));
  dbMock.select.mockReturnValueOnce({ from });
  return { where, innerJoin, from };
}

function mockPreviewSelect(rows: Array<{ id: string; email: string; name: string }>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ where, innerJoin }));
  dbMock.select.mockReturnValueOnce({ from });
  return { from, innerJoin, where, orderBy, limit };
}

describe("telemetry digest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APP_URL;
    delete process.env.VITE_APP_URL;
  });

  it("builds the previous-day summary from the DB queries", async () => {
    process.env.APP_URL = "https://cmdclaw.ai";
    mockCountSelect(4);
    mockCountSelect(11);
    mockCountSelect(7);
    dbMock.query.user.findMany.mockResolvedValueOnce([
      { id: "user-1", email: "alice@example.com", name: "Alice" },
      { id: "user-2", email: "bob@example.com", name: "Bob" },
    ]);
    mockPreviewSelect([
      { id: "user-3", email: "carol@example.com", name: "Carol" },
      { id: "user-4", email: "dan@example.com", name: "Dan" },
    ]);
    mockPreviewSelect([
      { id: "user-3", email: "carol@example.com", name: "Carol" },
      { id: "user-5", email: "eve@example.com", name: "Eve" },
    ]);

    const summary = await getDailyTelemetryDigestSummary(new Date(2026, 2, 13, 9, 0, 0));

    expect(summary).toEqual({
      activityDate: "2026-03-12",
      newSignups: 4,
      activeUsers: 11,
      returningActiveUsers: 7,
      signupsPreview: [
        { id: "user-1", email: "alice@example.com", name: "Alice" },
        { id: "user-2", email: "bob@example.com", name: "Bob" },
      ],
      activeUsersPreview: [
        { id: "user-3", email: "carol@example.com", name: "Carol" },
        { id: "user-4", email: "dan@example.com", name: "Dan" },
      ],
      returningActiveUsersPreview: [
        { id: "user-3", email: "carol@example.com", name: "Carol" },
        { id: "user-5", email: "eve@example.com", name: "Eve" },
      ],
      appUrl: "https://cmdclaw.ai",
      appUrlDomain: "cmdclaw.ai",
      appUrlSource: "APP_URL",
    });
  });

  it("formats a readable Slack message", () => {
    const message = buildDailyTelemetryDigestMessage({
      activityDate: "2026-03-12",
      newSignups: 2,
      activeUsers: 9,
      returningActiveUsers: 6,
      signupsPreview: [
        { id: "user-1", email: "alice@example.com", name: "Alice" },
        { id: "user-2", email: "bob@example.com", name: "" },
      ],
      activeUsersPreview: [
        { id: "user-3", email: "carol@example.com", name: "Carol" },
        { id: "user-4", email: "dan@example.com", name: "" },
      ],
      returningActiveUsersPreview: [
        { id: "user-3", email: "carol@example.com", name: "Carol" },
      ],
      appUrl: "https://cmdclaw.ai",
      appUrlDomain: "cmdclaw.ai",
      appUrlSource: "APP_URL",
    });

    expect(message).toContain("CmdClaw daily ops digest for 2026-03-12");
    expect(message).toContain("App URL domain: cmdclaw.ai (APP_URL)");
    expect(message).toContain("New signups: 2");
    expect(message).toContain("Active users: 9");
    expect(message).toContain("Returning active users: 6");
    expect(message).toContain("- Alice <alice@example.com>");
    expect(message).toContain("- bob@example.com");
    expect(message).toContain("Active user preview:");
    expect(message).toContain("- Carol <carol@example.com>");
    expect(message).toContain("- dan@example.com");
    expect(message).toContain("Returning active user preview:");
  });
});
