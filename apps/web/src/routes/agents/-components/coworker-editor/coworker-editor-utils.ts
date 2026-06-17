import { formatDistanceToNowStrict } from "date-fns";
import type { CoworkerSchedule } from "@/orpc/hooks/coworkers";

export function isUuidRouteSlug(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

export function normalizeScheduleForComparison(schedule: CoworkerSchedule | null) {
  if (!schedule) {
    return null;
  }

  switch (schedule.type) {
    case "interval":
      return {
        type: "interval" as const,
        intervalMinutes: schedule.intervalMinutes,
      };
    case "daily":
      return {
        type: "daily" as const,
        time: schedule.time,
        timezone: schedule.timezone,
      };
    case "weekly":
      return {
        type: "weekly" as const,
        time: schedule.time,
        daysOfWeek: [...schedule.daysOfWeek].toSorted(),
        timezone: schedule.timezone,
      };
    case "monthly":
      return {
        type: "monthly" as const,
        time: schedule.time,
        dayOfMonth: schedule.dayOfMonth,
        timezone: schedule.timezone,
      };
    default:
      return schedule;
  }
}

export function stringArraysEqual(left: string[], right: string[]) {
  return JSON.stringify([...left].toSorted()) === JSON.stringify([...right].toSorted());
}

export function schedulesEqual(left: CoworkerSchedule | null, right: CoworkerSchedule | null) {
  return (
    JSON.stringify(normalizeScheduleForComparison(left)) ===
    JSON.stringify(normalizeScheduleForComparison(right))
  );
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    const handleLoad = () => {
      reader.removeEventListener("load", handleLoad);
      reader.removeEventListener("error", handleError);
      resolve(String(reader.result ?? ""));
    };

    const handleError = () => {
      reader.removeEventListener("load", handleLoad);
      reader.removeEventListener("error", handleError);
      reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    };

    reader.addEventListener("load", handleLoad);
    reader.addEventListener("error", handleError);
    reader.readAsDataURL(file);
  });
}

export function inferUploadMimeType(file: File): string {
  if (file.type.trim()) {
    return file.type;
  }

  const normalizedName = file.name.toLowerCase();
  if (normalizedName.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (normalizedName.endsWith(".doc")) {
    return "application/msword";
  }
  if (normalizedName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (normalizedName.endsWith(".xls")) {
    return "application/vnd.ms-excel";
  }
  if (normalizedName.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (normalizedName.endsWith(".csv")) {
    return "text/csv";
  }
  if (normalizedName.endsWith(".html") || normalizedName.endsWith(".htm")) {
    return "text/html";
  }
  if (normalizedName.endsWith(".txt") || normalizedName.endsWith(".md")) {
    return "text/plain";
  }
  if (normalizedName.endsWith(".png")) {
    return "image/png";
  }
  if (normalizedName.endsWith(".jpg") || normalizedName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalizedName.endsWith(".gif")) {
    return "image/gif";
  }
  if (normalizedName.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalizedName.endsWith(".svg")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildCoworkerDocumentBuilderMessage(filenames: string[]): string {
  return [
    "I uploaded new coworker documents:",
    ...filenames.map((filename) => `- ${filename}`),
    "",
    "Please add them to my agent instruction and use them when relevant.",
  ].join("\n");
}

export function buildCoworkerDocumentRemovalBuilderMessage(filenames: string[]): string {
  return [
    "I removed coworker documents:",
    ...filenames.map((filename) => `- ${filename}`),
    "",
    "Please remove them from my agent instruction and stop using them.",
  ].join("\n");
}

export function formatRelativeTime(value?: Date | string | null) {
  if (!value) {
    return "just now";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }

  const rawDistance = formatDistanceToNowStrict(date, { roundingMethod: "floor" });
  const [amount, unit] = rawDistance.split(" ");
  if (!amount || !unit || amount === "0") {
    return "just now";
  }

  const shortUnit = unit.startsWith("second")
    ? "s"
    : unit.startsWith("minute")
      ? "m"
      : unit.startsWith("hour")
        ? "h"
        : unit.startsWith("day")
          ? "d"
          : unit.startsWith("month")
            ? "mo"
            : unit.startsWith("year")
              ? "y"
              : unit;

  return `${amount}${shortUnit} ago`;
}
