import { eq } from "drizzle-orm";
import type { db as defaultDb } from "@cmdclaw/db/client";
import { connectedIdentity, integration } from "@cmdclaw/db/schema";
import {
  getReliableEmailFromMetadata,
  getWorkspaceOrTenantNameFromMetadata,
  planConnectedIdentityAssignment,
  type ExistingConnectedIdentity,
} from "./account-labels";

type Database = typeof defaultDb;

export async function backfillConnectedIdentities(db: Database, userId?: string): Promise<{
  createdConnectedIdentities: number;
  updatedConnectedAccounts: number;
}> {
  const rows = await db.query.integration.findMany({
    where: userId ? eq(integration.userId, userId) : undefined,
    orderBy: (table, { asc }) => [asc(table.userId), asc(table.createdAt)],
  });

  let createdConnectedIdentities = 0;
  let updatedConnectedAccounts = 0;
  const identitiesByUser = new Map<string, ExistingConnectedIdentity[]>();

  for (const row of rows) {
    if (row.connectedIdentityId) {
      continue;
    }

    let identities = identitiesByUser.get(row.userId);
    if (!identities) {
      const existing = await db.query.connectedIdentity.findMany({
        where: eq(connectedIdentity.userId, row.userId),
        with: { integrations: { columns: { type: true } } },
      });
      identities = existing.map((identity) => ({
        id: identity.id,
        label: identity.label,
        emailIdentity: identity.emailIdentity,
        integrationTypes: identity.integrations.map((item) => item.type),
      }));
      identitiesByUser.set(row.userId, identities);
    }

    const metadata =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : null;
    const assignment = planConnectedIdentityAssignment({
      newAccount: {
        userId: row.userId,
        integrationType: row.type,
        providerIdentityId: row.providerAccountId,
        reliableEmail: getReliableEmailFromMetadata(row.displayName, metadata),
        displayName: row.displayName,
        workspaceOrTenantName: getWorkspaceOrTenantNameFromMetadata(metadata),
      },
      existingIdentities: identities,
    });

    let connectedIdentityId: string;
    let label: string;
    if (assignment.kind === "existing") {
      connectedIdentityId = assignment.connectedIdentityId;
      label = assignment.accountLabel;
    } else {
      const [created] = await db
        .insert(connectedIdentity)
        .values({
          userId: row.userId,
          label: assignment.accountLabel,
          emailIdentity: assignment.emailIdentity,
          metadata: assignment.metadata,
        })
        .returning();
      connectedIdentityId = created.id;
      label = created.label;
      createdConnectedIdentities += 1;
      identities.push({
        id: created.id,
        label: created.label,
        emailIdentity: created.emailIdentity,
        integrationTypes: [],
      });
    }

    await db
      .update(integration)
      .set({ connectedIdentityId })
      .where(eq(integration.id, row.id));
    updatedConnectedAccounts += 1;

    const identity = identities.find((item) => item.id === connectedIdentityId);
    if (identity && !identity.integrationTypes.includes(row.type)) {
      identities[identities.indexOf(identity)] = {
        ...identity,
        label,
        integrationTypes: [...identity.integrationTypes, row.type],
      };
    }
  }

  return { createdConnectedIdentities, updatedConnectedAccounts };
}
