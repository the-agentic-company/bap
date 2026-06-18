import type { useGT } from "gt-react";
import type { PromptSegment } from "@/lib/prompt-segments";

export type HeroPromptExample = {
  department: string;
  color: string;
  segments: PromptSegment[];
  prompt: string;
};

// Brandfetch CDN icon URLs (fetched via Brand API)
const BF = {
  salesforce:
    "https://cdn.brandfetch.io/idVE84WdIN/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  outreach:
    "https://cdn.brandfetch.io/idppFLnf4N/w/150/h/150/theme/dark/icon.png?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  googleCalendar:
    "https://cdn.brandfetch.io/id6O2oGzv-/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  meta: "https://cdn.brandfetch.io/idWvz5T3V7/w/400/h/400/theme/dark/icon.png?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  slack:
    "https://cdn.brandfetch.io/idJ_HhtG0Z/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  greenhouse:
    "https://cdn.brandfetch.io/id7baa8wpg/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  bamboohr:
    "https://cdn.brandfetch.io/idpB2Dvgzu/w/180/h/180/theme/dark/icon.png?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  atlassian:
    "https://cdn.brandfetch.io/idlQIwGMOK/w/400/h/400/theme/dark/icon.png?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  ironclad:
    "https://cdn.brandfetch.io/id2DIJ2hXq/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  stripe:
    "https://cdn.brandfetch.io/idxAg10C0L/w/480/h/480/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  brex: "https://cdn.brandfetch.io/idu49Dl4i8/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  quickbooks:
    "https://cdn.brandfetch.io/idWrWLZ_I5/w/200/h/200/theme/dark/icon.png?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
  zendesk:
    "https://cdn.brandfetch.io/idNq8SRGPd/w/400/h/400/theme/dark/icon.jpeg?c=1bxslgajlsi6kg3c82drbf3z0eaQApbQkPa",
} as const;

export const HERO_PROMPT_EXAMPLES: HeroPromptExample[] = [
  {
    department: "Sales",
    color: "#3B82F6",
    segments: [
      { type: "text", content: "When a deal in " },
      { type: "brand", name: "Salesforce", icon: BF.salesforce },
      { type: "text", content: " moves to Proposal Sent, draft follow-ups in " },
      { type: "brand", name: "Outreach", icon: BF.outreach },
      { type: "text", content: " and schedule reminders in " },
      { type: "brand", name: "Google Calendar", icon: BF.googleCalendar },
    ],
    prompt:
      "When a deal in Salesforce moves to Proposal Sent, draft follow-ups in Outreach and schedule reminders in Google Calendar.",
  },
  {
    department: "Marketing",
    color: "#F472B6",
    segments: [
      { type: "text", content: "Every morning, compare " },
      { type: "brand", name: "Meta Ads", icon: BF.meta },
      { type: "text", content: " and " },
      { type: "brand", name: "Google Ads", icon: BF.googleCalendar },
      { type: "text", content: " CAC vs yesterday and send a performance digest to " },
      { type: "brand", name: "Slack", icon: BF.slack },
    ],
    prompt:
      "Every morning, compare Meta Ads and Google Ads CAC vs yesterday and send a performance digest to Slack.",
  },
  {
    department: "HR",
    color: "#F59E0B",
    segments: [
      { type: "text", content: "When a candidate is marked Hired in " },
      { type: "brand", name: "Greenhouse", icon: BF.greenhouse },
      { type: "text", content: ", create onboarding tasks in " },
      { type: "brand", name: "BambooHR", icon: BF.bamboohr },
      { type: "text", content: ", " },
      { type: "brand", name: "Jira", icon: BF.atlassian },
      { type: "text", content: ", and " },
      { type: "brand", name: "Google Workspace", icon: BF.googleCalendar },
    ],
    prompt:
      "When a candidate is marked Hired in Greenhouse, create onboarding tasks in BambooHR, Jira, and Google Workspace.",
  },
  {
    department: "Legal",
    color: "#8B5CF6",
    segments: [
      { type: "text", content: "When a new MSA is uploaded to " },
      { type: "brand", name: "Ironclad", icon: BF.ironclad },
      { type: "text", content: ", extract renewal and termination dates and add reminders to " },
      { type: "brand", name: "Google Calendar", icon: BF.googleCalendar },
    ],
    prompt:
      "When a new MSA is uploaded to Ironclad, extract renewal and termination dates and add reminders to Google Calendar.",
  },
  {
    department: "Finance",
    color: "#10B981",
    segments: [
      { type: "text", content: "Every business day, reconcile " },
      { type: "brand", name: "Stripe", icon: BF.stripe },
      { type: "text", content: " and " },
      { type: "brand", name: "Brex", icon: BF.brex },
      { type: "text", content: " transactions in " },
      { type: "brand", name: "QuickBooks", icon: BF.quickbooks },
      { type: "text", content: " and send mismatch reports to " },
      { type: "brand", name: "Slack", icon: BF.slack },
    ],
    prompt:
      "Every business day, reconcile Stripe and Brex transactions in QuickBooks and send mismatch reports to Slack.",
  },
  {
    department: "Support",
    color: "#06B6D4",
    segments: [
      { type: "text", content: "Every hour, triage new " },
      { type: "brand", name: "Zendesk", icon: BF.zendesk },
      {
        type: "text",
        content: " tickets by sentiment, auto-tag priority, and route critical ones to on-call in ",
      },
      { type: "brand", name: "Slack", icon: BF.slack },
    ],
    prompt:
      "Every hour, triage new Zendesk tickets by sentiment, auto-tag priority, and route critical ones to on-call in Slack.",
  },
];

function translateHeroSegmentText(content: string, gt: ReturnType<typeof useGT>) {
  switch (content) {
    case "When a deal in ":
      return gt("When a deal in ");
    case " moves to Proposal Sent, draft follow-ups in ":
      return gt(" moves to Proposal Sent, draft follow-ups in ");
    case " and schedule reminders in ":
      return gt(" and schedule reminders in ");
    case "Every morning, compare ":
      return gt("Every morning, compare ");
    case " and ":
      return gt(" and ");
    case " CAC vs yesterday and send a performance digest to ":
      return gt(" CAC vs yesterday and send a performance digest to ");
    case "When a candidate is marked Hired in ":
      return gt("When a candidate is marked Hired in ");
    case ", create onboarding tasks in ":
      return gt(", create onboarding tasks in ");
    case ", and ":
      return gt(", and ");
    case ", ":
      return gt(", ");
    case "When a new MSA is uploaded to ":
      return gt("When a new MSA is uploaded to ");
    case ", extract renewal and termination dates and add reminders to ":
      return gt(", extract renewal and termination dates and add reminders to ");
    case "Every business day, reconcile ":
      return gt("Every business day, reconcile ");
    case " transactions in ":
      return gt(" transactions in ");
    case " and send mismatch reports to ":
      return gt(" and send mismatch reports to ");
    case "Every hour, triage new ":
      return gt("Every hour, triage new ");
    case " tickets by sentiment, auto-tag priority, and route critical ones to on-call in ":
      return gt(" tickets by sentiment, auto-tag priority, and route critical ones to on-call in ");
    default:
      return content;
  }
}

export function translatePromptSegments(segments: PromptSegment[], gt: ReturnType<typeof useGT>) {
  return segments.map((segment) => {
    if (segment.type !== "text") {
      return segment;
    }
    return {
      ...segment,
      content: translateHeroSegmentText(segment.content, gt),
    };
  });
}

export function translateHeroDepartment(
  department: string | undefined,
  gt: ReturnType<typeof useGT>,
) {
  switch (department) {
    case "Sales":
      return gt("Sales");
    case "Marketing":
      return gt("Marketing");
    case "HR":
      return gt("HR");
    case "Legal":
      return gt("Legal");
    case "Finance":
      return gt("Finance");
    case "Support":
      return gt("Support");
    default:
      return gt("your team");
  }
}

export function translateHeroPrompt(prompt: string, gt: ReturnType<typeof useGT>) {
  switch (prompt) {
    case "When a deal in Salesforce moves to Proposal Sent, draft follow-ups in Outreach and schedule reminders in Google Calendar.":
      return gt(
        "When a deal in Salesforce moves to Proposal Sent, draft follow-ups in Outreach and schedule reminders in Google Calendar.",
      );
    case "Every morning, compare Meta Ads and Google Ads CAC vs yesterday and send a performance digest to Slack.":
      return gt(
        "Every morning, compare Meta Ads and Google Ads CAC vs yesterday and send a performance digest to Slack.",
      );
    case "When a candidate is marked Hired in Greenhouse, create onboarding tasks in BambooHR, Jira, and Google Workspace.":
      return gt(
        "When a candidate is marked Hired in Greenhouse, create onboarding tasks in BambooHR, Jira, and Google Workspace.",
      );
    case "When a new MSA is uploaded to Ironclad, extract renewal and termination dates and add reminders to Google Calendar.":
      return gt(
        "When a new MSA is uploaded to Ironclad, extract renewal and termination dates and add reminders to Google Calendar.",
      );
    case "Every business day, reconcile Stripe and Brex transactions in QuickBooks and send mismatch reports to Slack.":
      return gt(
        "Every business day, reconcile Stripe and Brex transactions in QuickBooks and send mismatch reports to Slack.",
      );
    case "Every hour, triage new Zendesk tickets by sentiment, auto-tag priority, and route critical ones to on-call in Slack.":
      return gt(
        "Every hour, triage new Zendesk tickets by sentiment, auto-tag priority, and route critical ones to on-call in Slack.",
      );
    default:
      return prompt;
  }
}
