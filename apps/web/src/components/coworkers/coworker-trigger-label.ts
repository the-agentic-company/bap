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

const WEEKDAY_SHORT_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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
    .toSorted((left, right) => left - right);

  if (validDays.length === 0) {
    return "Weekly";
  }

  if (validDays.length <= 2) {
    return validDays.map((day) => WEEKDAY_LABELS[day]).join(", ");
  }

  return validDays.map((day) => WEEKDAY_SHORT_LABELS[day]).join("/");
}

function formatMonthlyCadence(dayOfMonth: number) {
  if (dayOfMonth === 1) {
    return "Monthly";
  }
  return `Monthly on the ${dayOfMonth}${getOrdinalSuffix(dayOfMonth)}`;
}

function getOrdinalSuffix(dayOfMonth: number) {
  const remainder = dayOfMonth % 100;
  if (remainder >= 11 && remainder <= 13) {
    return "th";
  }

  switch (dayOfMonth % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
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
