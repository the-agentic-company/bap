import { and, eq } from "drizzle-orm";
import { db } from "@bap/db/client";
import {
  coworker,
  coworkerAutomationRegistration,
  coworkerRun,
  coworkerScheduleOccurrence,
  workspaceMember,
} from "@bap/db/schema";
import { triggerCoworkerRun } from "./coworker-service";

export type ScheduledCoworkerDispatchResult = {
  occurrenceId: string;
  registeredCount: number;
  dispatchedCount: number;
  existingCount: number;
  failedCount: number;
};

export async function dispatchScheduledCoworkerOccurrence(input: {
  coworkerId: string;
  dispatchKey: string;
  scheduledFor: Date;
  scheduleType: string;
}): Promise<ScheduledCoworkerDispatchResult> {
  const wf = await db.query.coworker.findFirst({
    where: eq(coworker.id, input.coworkerId),
    columns: { id: true, workspaceId: true, triggerType: true, status: true },
  });
  if (!wf?.workspaceId || wf.triggerType !== "schedule" || wf.status !== "on") {
    throw new Error(`Scheduled Coworker "${input.coworkerId}" is not active`);
  }

  const [insertedOccurrence] = await db
    .insert(coworkerScheduleOccurrence)
    .values({
      coworkerId: wf.id,
      workspaceId: wf.workspaceId,
      dispatchKey: input.dispatchKey,
      scheduledFor: input.scheduledFor,
      status: "dispatching",
    })
    .onConflictDoNothing({
      target: [coworkerScheduleOccurrence.coworkerId, coworkerScheduleOccurrence.dispatchKey],
    })
    .returning();
  const occurrence =
    insertedOccurrence ??
    (await db.query.coworkerScheduleOccurrence.findFirst({
      where: and(
        eq(coworkerScheduleOccurrence.coworkerId, wf.id),
        eq(coworkerScheduleOccurrence.dispatchKey, input.dispatchKey),
      ),
    }));
  if (!occurrence) throw new Error("Could not create scheduled Coworker occurrence");

  const registrations = await db.query.coworkerAutomationRegistration.findMany({
    where: and(
      eq(coworkerAutomationRegistration.coworkerId, wf.id),
      eq(coworkerAutomationRegistration.status, "active"),
    ),
  });
  let dispatchedCount = 0;
  let existingCount = 0;
  let failedCount = 0;

  await Promise.all(
    registrations.map(async (registration) => {
      const membership = await db.query.workspaceMember.findFirst({
        where: and(
          eq(workspaceMember.organizationId, wf.workspaceId!),
          eq(workspaceMember.userId, registration.userId),
        ),
        columns: { id: true },
      });
      if (!membership) {
        await db
          .update(coworkerAutomationRegistration)
          .set({
            status: "membership_revoked",
            statusReason: "Workspace membership ended",
            revokedAt: new Date(),
          })
          .where(eq(coworkerAutomationRegistration.id, registration.id));
        return;
      }
      const existing = await db.query.coworkerRun.findFirst({
        where: and(
          eq(coworkerRun.scheduleOccurrenceId, occurrence.id),
          eq(coworkerRun.automationRegistrationId, registration.id),
        ),
        columns: { id: true },
      });
      if (existing) {
        existingCount += 1;
        return;
      }
      try {
        await triggerCoworkerRun({
          coworkerId: wf.id,
          startKind: "external_trigger",
          automationRegistrationId: registration.id,
          scheduleOccurrenceId: occurrence.id,
          triggerPayload: {
            source: "schedule",
            coworkerId: wf.id,
            scheduleType: input.scheduleType,
            scheduledFor: input.scheduledFor.toISOString(),
            scheduleOccurrenceId: occurrence.id,
          },
        });
        dispatchedCount += 1;
      } catch (error) {
        const created = await db.query.coworkerRun.findFirst({
          where: and(
            eq(coworkerRun.scheduleOccurrenceId, occurrence.id),
            eq(coworkerRun.automationRegistrationId, registration.id),
          ),
          columns: { id: true },
        });
        if (created) dispatchedCount += 1;
        else failedCount += 1;
        console.warn("[coworker-schedule] member dispatch failed", {
          coworkerId: wf.id,
          occurrenceId: occurrence.id,
          registrationId: registration.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  const status =
    failedCount === 0 ? "completed" : dispatchedCount + existingCount > 0 ? "partial" : "failed";
  await db
    .update(coworkerScheduleOccurrence)
    .set({
      status,
      registeredCount: registrations.length,
      dispatchedCount: dispatchedCount + existingCount,
      failedCount,
      completedAt: new Date(),
    })
    .where(eq(coworkerScheduleOccurrence.id, occurrence.id));

  return {
    occurrenceId: occurrence.id,
    registeredCount: registrations.length,
    dispatchedCount,
    existingCount,
    failedCount,
  };
}
