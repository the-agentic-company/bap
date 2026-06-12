import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { getSessionMock, insertMock, valuesMock, onConflictDoUpdateMock } = vi.hoisted(() => {
  const onConflictDoUpdateMock = vi.fn<VitestProcedure>().mockResolvedValue(undefined);
  const valuesMock = vi.fn<VitestProcedure>(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }));
  const insertMock = vi.fn<VitestProcedure>(() => ({ values: valuesMock }));
  return {
    getSessionMock: vi.fn<VitestProcedure>(),
    insertMock,
    valuesMock,
    onConflictDoUpdateMock,
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    insert: insertMock,
  },
}));

vi.mock("@cmdclaw/db/schema", () => ({
  slackUserLink: {
    slackTeamId: "slackTeamId",
    slackUserId: "slackUserId",
  },
}));

import { handleSlackLink } from "./link";

function getLocation(response: Response) {
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Expected redirect location");
  }
  return location;
}

describe("handleSlackLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APP_URL;
    delete process.env.VITE_APP_URL;
    getSessionMock.mockResolvedValue(null);
  });

  it("returns 400 when slack params are missing", async () => {
    const response = await handleSlackLink(
      new Request("https://cmdclaw.ai/api/slack/link?slackUserId=U123"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing slackUserId or slackTeamId",
    });
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("uses APP_URL for login redirects when the request host is internal", async () => {
    process.env.APP_URL = "https://app.example.com";

    const response = await handleSlackLink(
      new Request("https://0.0.0.0:8080/api/slack/link?slackUserId=U123&slackTeamId=T123"),
    );

    expect(response.status).toBe(307);
    expect(getLocation(response)).toBe(
      "https://app.example.com/login?redirect=%2Fapi%2Fslack%2Flink%3FslackUserId%3DU123%26slackTeamId%3DT123",
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("upserts the slack user link and renders confirmation HTML when authenticated", async () => {
    getSessionMock.mockResolvedValue({ session: { userId: "user-1" } });

    const response = await handleSlackLink(
      new Request("https://cmdclaw.ai/api/slack/link?slackUserId=U123&slackTeamId=T123"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    await expect(response.text()).resolves.toContain("Account linked!");

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith({
      slackTeamId: "T123",
      slackUserId: "U123",
      userId: "user-1",
    });
    expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ set: { userId: "user-1" } }),
    );
  });
});
