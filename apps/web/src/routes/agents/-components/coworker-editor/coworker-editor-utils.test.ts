import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoworkerSchedule } from "@/orpc/hooks/coworkers";
import {
  formatFileSize,
  formatRelativeTime,
  inferUploadMimeType,
  schedulesEqual,
  stringArraysEqual,
} from "./coworker-editor-utils";

describe("coworker editor utils", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("compares unordered string arrays without mutating the inputs", () => {
    const left = ["gmail", "slack"];
    const right = ["slack", "gmail"];

    expect(stringArraysEqual(left, right)).toBe(true);
    expect(left).toEqual(["gmail", "slack"]);
    expect(right).toEqual(["slack", "gmail"]);
    expect(stringArraysEqual(left, ["gmail"])).toBe(false);
  });

  it("normalizes schedules before comparison", () => {
    const mondayWednesday = {
      type: "weekly",
      time: "09:30",
      daysOfWeek: [1, 3],
      timezone: "Europe/Dublin",
    } satisfies CoworkerSchedule;
    const wednesdayMonday = {
      type: "weekly",
      time: "09:30",
      daysOfWeek: [3, 1],
      timezone: "Europe/Dublin",
    } satisfies CoworkerSchedule;
    const differentTime = {
      ...mondayWednesday,
      time: "10:30",
    } satisfies CoworkerSchedule;

    expect(schedulesEqual(mondayWednesday, wednesdayMonday)).toBe(true);
    expect(schedulesEqual(mondayWednesday, differentTime)).toBe(false);
    expect(schedulesEqual(null, null)).toBe(true);
  });

  it("infers upload MIME types from file metadata or filename fallback", () => {
    expect(inferUploadMimeType({ name: "notes.md", type: "" } as File)).toBe("text/plain");
    expect(inferUploadMimeType({ name: "report.pdf", type: "application/custom" } as File)).toBe(
      "application/custom",
    );
    expect(inferUploadMimeType({ name: "archive.unknown", type: "" } as File)).toBe(
      "application/octet-stream",
    );
  });

  it("formats sizes and relative times for compact UI labels", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T12:00:00Z"));

    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatRelativeTime("2026-06-17T11:58:20Z")).toBe("1m ago");
    expect(formatRelativeTime("not-a-date")).toBe("just now");
  });
});
