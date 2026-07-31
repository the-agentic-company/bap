import { coworkerAutomationRegistration, coworkerHistoryEvent } from "@bap/db/schema";

type AutomationRegistrationDatabase = typeof import("@bap/db/client").db;

export async function activateCoworkerAutomationRegistration(input: {
  database: AutomationRegistrationDatabase;
  coworkerId: string;
  workspaceId: string;
  actor: {
    userId: string;
    name: string | null;
    image: string | null;
  };
}) {
  const now = new Date();
  const [registration] = await input.database
    .insert(coworkerAutomationRegistration)
    .values({
      coworkerId: input.coworkerId,
      workspaceId: input.workspaceId,
      userId: input.actor.userId,
      memberNameSnapshot: input.actor.name,
      memberAvatarSnapshot: input.actor.image,
      status: "active",
      registeredAt: now,
      statusChangedByUserId: input.actor.userId,
    })
    .onConflictDoUpdate({
      target: [coworkerAutomationRegistration.coworkerId, coworkerAutomationRegistration.userId],
      set: {
        status: "active",
        statusReason: null,
        statusChangedByUserId: input.actor.userId,
        registeredAt: now,
        pausedAt: null,
        removedAt: null,
        revokedAt: null,
        memberNameSnapshot: input.actor.name,
        memberAvatarSnapshot: input.actor.image,
        updatedAt: now,
      },
    })
    .returning();

  if (!registration) {
    throw new Error("Failed to activate Coworker automation registration");
  }

  await input.database.insert(coworkerHistoryEvent).values({
    coworkerId: input.coworkerId,
    actorUserId: input.actor.userId,
    actorNameSnapshot: input.actor.name,
    actorAvatarSnapshot: input.actor.image,
    origin: "direct",
    type: "automation_registration_activated",
    payload: { registrationId: registration.id },
  });

  return registration;
}
