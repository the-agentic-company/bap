import { describe, expect, it } from "vitest";
import { getCoworkerTriggerLabel } from "./coworker-trigger-label";

describe("getCoworkerTriggerLabel", () => {
  it("keeps non-scheduled triggers unchanged", () => {
    expect(getCoworkerTriggerLabel("manual", null)).toBe("Manual");
    expect(getCoworkerTriggerLabel("email", null)).toBe("Email");
  });

  it("formats interval schedules with a readable cadence", () => {
    expect(getCoworkerTriggerLabel("schedule", { type: "interval", intervalMinutes: 60 })).toBe(
      "Hourly",
    );
    expect(getCoworkerTriggerLabel("schedule", { type: "interval", intervalMinutes: 180 })).toBe(
      "Every 3h",
    );
    expect(getCoworkerTriggerLabel("schedule", { type: "interval", intervalMinutes: 90 })).toBe(
      "Every 90 min",
    );
  });

  it("formats daily, weekly, and monthly schedules with time", () => {
    expect(
      getCoworkerTriggerLabel("schedule", { type: "daily", time: "17:00", timezone: "UTC" }),
    ).toBe("Daily at 17:00");
    expect(
      getCoworkerTriggerLabel("schedule", {
        type: "weekly",
        daysOfWeek: [1, 3],
        time: "09:30",
        timezone: "UTC",
      }),
    ).toBe("Monday, Wednesday at 09:30");
    expect(
      getCoworkerTriggerLabel("schedule", {
        type: "weekly",
        daysOfWeek: [5, 1, 3],
        time: "10:00",
        timezone: "UTC",
      }),
    ).toBe("Mon/Wed/Fri at 10:00");
    expect(
      getCoworkerTriggerLabel("schedule", {
        type: "monthly",
        dayOfMonth: 15,
        time: "08:00",
        timezone: "UTC",
      }),
    ).toBe("Monthly on the 15th at 08:00");
  });

  it("falls back to Scheduled when schedule details are missing", () => {
    expect(getCoworkerTriggerLabel("schedule", null)).toBe("Scheduled");
  });
});
