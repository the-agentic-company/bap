import type { CoworkerSchedule } from "@/orpc/hooks/coworkers";

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function formatIntervalLabel(intervalMinutes: number) {
  if (intervalMinutes % (24 * 60) === 0) {
    const days = intervalMinutes / (24 * 60);
    return days === 1 ? "Every day" : `Every ${days}d`;
  }

  if (intervalMinutes % 60 === 0) {
    const hours = intervalMinutes / 60;
    return hours === 1 ? "Hourly" : `Every ${hours}h`;
  }

  return `Every ${intervalMinutes} min`;
}

function formatWeeklyCadence(daysOfWeek: number[]) {
  const validDays = [...new Set(daysOfWeek)]
    .filter((day) => day >= 0 && day <= 6)
    .toSorted((left, right) => left - right)
    .map((day) => WEEKDAY_LABELS[day]);

  if (validDays.length === 0) {
    return "Weekly";
  }

  return validDays.length <= 2 ? validDays.join(", ") : "Weekly";
}

function formatMonthlyCadence(dayOfMonth: number) {
  if (dayOfMonth === 1) {
    return "Monthly";
  }
  return `${dayOfMonth} monthly`;
}

export function getCoworkerTriggerLabel(triggerType: string, schedule?: CoworkerSchedule | null) {
  if (triggerType !== "schedule" || !schedule) {
    const map: Record<string, string> = {
      manual: "Manual",
      schedule: "Scheduled",
      email: "Email",
      webhook: "Webhook",
    };
    return map[triggerType] ?? triggerType;
  }

  switch (schedule.type) {
    case "interval":
      return formatIntervalLabel(schedule.intervalMinutes);
    case "daily":
      return `Daily at ${schedule.time}`;
    case "weekly":
      return `${formatWeeklyCadence(schedule.daysOfWeek)} at ${schedule.time}`;
    case "monthly":
      return `${formatMonthlyCadence(schedule.dayOfMonth)} at ${schedule.time}`;
    default:
      return "Scheduled";
  }
}
