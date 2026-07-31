import type { CoworkerAutomationRegistrationStatus } from "@bap/db/schema";

export type AutomationRegistrationAction = "register" | "pause" | "resume" | "remove";

export function canManageAutomationRegistration(input: {
  action: AutomationRegistrationAction;
  actorUserId: string;
  registrationUserId: string;
  workspaceRole: string | null;
  isActiveWorkspaceMember: boolean;
}): boolean {
  if (!input.isActiveWorkspaceMember) return false;
  const isSelf = input.actorUserId === input.registrationUserId;
  if (input.action === "register" || input.action === "resume") return isSelf;
  return isSelf || input.workspaceRole === "admin" || input.workspaceRole === "owner";
}

export function pausedRegistrationStatus(input: {
  actorUserId: string;
  registrationUserId: string;
}): CoworkerAutomationRegistrationStatus {
  return input.actorUserId === input.registrationUserId ? "member_paused" : "admin_paused";
}

export function isActiveAutomationRegistration(
  status: CoworkerAutomationRegistrationStatus,
): boolean {
  return status === "active";
}
