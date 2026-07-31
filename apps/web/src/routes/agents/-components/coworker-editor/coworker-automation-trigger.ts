import { EMAIL_FORWARDED_TRIGGER_TYPE } from "@bap/core/lib/email-forwarding";

export function usesAutomationOwner(triggerType: string): boolean {
  return triggerType !== "manual" && triggerType !== EMAIL_FORWARDED_TRIGGER_TYPE;
}
