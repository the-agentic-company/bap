import type { CoworkerStartKind } from "./coworker-run-policy";

export type CoworkerExecutionIdentityDecision =
  | { ok: true; executionUserId: string }
  | {
      ok: false;
      reason:
        | "initiator_required"
        | "automation_owner_required"
        | "automation_owner_unconsented"
        | "automation_owner_inactive";
    };

export function resolveCoworkerExecutionIdentity(input: {
  startKind: CoworkerStartKind;
  initiatingUserId: string | null;
  automationOwner: {
    userId: string;
    consentedAt: Date | null;
    isActiveWorkspaceMember: boolean;
  } | null;
}): CoworkerExecutionIdentityDecision {
  if (input.startKind === "user_intent") {
    return input.initiatingUserId
      ? { ok: true, executionUserId: input.initiatingUserId }
      : { ok: false, reason: "initiator_required" };
  }

  if (!input.automationOwner) {
    return { ok: false, reason: "automation_owner_required" };
  }
  if (!input.automationOwner.consentedAt) {
    return { ok: false, reason: "automation_owner_unconsented" };
  }
  if (!input.automationOwner.isActiveWorkspaceMember) {
    return { ok: false, reason: "automation_owner_inactive" };
  }

  return { ok: true, executionUserId: input.automationOwner.userId };
}
