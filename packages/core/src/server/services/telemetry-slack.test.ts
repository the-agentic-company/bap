import { describe, expect, it, vi } from "vitest";

vi.mock("../../env", () => ({
  env: {
    SLACK_BOT_TOKEN: undefined,
  },
}));

import {
  buildInviteOnlyAccessRequestSlackMessage,
  buildSignupSlackMessage,
} from "./telemetry-slack";

describe("telemetry Slack helpers", () => {
  it("formats a readable signup message", () => {
    const message = buildSignupSlackMessage({
      email: "new@example.com",
      name: "New User",
      signupMethod: "google",
      userId: "user-1",
      occurredAt: new Date("2026-03-13T10:00:00.000Z"),
    });

    expect(message).toContain("New CmdClaw signup");
    expect(message).toContain("Email: new@example.com");
    expect(message).toContain("Name: New User");
    expect(message).toContain("Method: google");
    expect(message).toContain("User ID: user-1");
    expect(message).toContain("Created at: 2026-03-13T10:00:00.000Z");
  });

  it("formats a readable invite-only access request message", () => {
    const message = buildInviteOnlyAccessRequestSlackMessage({
      email: "waitlist@example.com",
      source: "magic-link",
      referrer: "https://cmdclaw.ai/invite-only?source=magic-link",
      occurredAt: new Date("2026-03-27T12:00:00.000Z"),
    });

    expect(message).toContain("Invite-only access request");
    expect(message).toContain("Email: waitlist@example.com");
    expect(message).toContain("Source: magic-link");
    expect(message).toContain("Referrer: https://cmdclaw.ai/invite-only?source=magic-link");
    expect(message).toContain("Requested at: 2026-03-27T12:00:00.000Z");
  });
});
