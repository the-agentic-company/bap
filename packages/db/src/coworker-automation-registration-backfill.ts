import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { coworker, coworkerAutomationRegistration, user, workspaceMember } from "./schema";

type Database = typeof db;

export function isAutomationRegistrationMigrationCandidate(input: {
  triggerType: string;
  workspaceId: string | null;
  automationOwnerUserId: string | null;
  automationOwnerConsentedAt: Date | null;
  hasActiveMembership: boolean;
}): boolean {
  return Boolean(
    input.triggerType === "schedule" &&
    input.workspaceId &&
    input.automationOwnerUserId &&
    input.automationOwnerConsentedAt &&
    input.hasActiveMembership,
  );
}

export async function backfillCoworkerAutomationRegistrations(database: Database = db) {
  const rows = await database.query.coworker.findMany({
    where: eq(coworker.triggerType, "schedule"),
  });
  let created = 0;
  for (const row of rows) {
    if (!row.workspaceId || !row.automationOwnerUserId || !row.automationOwnerConsentedAt) {
      continue;
    }
    const membership = await database.query.workspaceMember.findFirst({
      where: and(
        eq(workspaceMember.organizationId, row.workspaceId),
        eq(workspaceMember.userId, row.automationOwnerUserId),
      ),
      columns: { id: true },
    });
    if (
      !isAutomationRegistrationMigrationCandidate({
        triggerType: row.triggerType,
        workspaceId: row.workspaceId,
        automationOwnerUserId: row.automationOwnerUserId,
        automationOwnerConsentedAt: row.automationOwnerConsentedAt,
        hasActiveMembership: Boolean(membership),
      })
    ) {
      continue;
    }
    const owner = await database.query.user.findFirst({
      where: eq(user.id, row.automationOwnerUserId),
      columns: { name: true, email: true, image: true },
    });
    const inserted = await database
      .insert(coworkerAutomationRegistration)
      .values({
        coworkerId: row.id,
        workspaceId: row.workspaceId,
        userId: row.automationOwnerUserId,
        memberNameSnapshot: owner?.name ?? owner?.email ?? null,
        memberAvatarSnapshot: owner?.image ?? null,
        status: "active",
        registeredAt: row.automationOwnerConsentedAt,
      })
      .onConflictDoNothing({
        target: [coworkerAutomationRegistration.coworkerId, coworkerAutomationRegistration.userId],
      })
      .returning({ id: coworkerAutomationRegistration.id });
    created += inserted.length;
  }
  return { examined: rows.length, created };
}

if (process.argv[1]?.endsWith("coworker-automation-registration-backfill.ts")) {
  const result = await backfillCoworkerAutomationRegistrations();
  console.info(
    `Coworker Automation Registration backfill complete: ${result.created}/${result.examined} created`,
  );
  process.exit(0);
}
