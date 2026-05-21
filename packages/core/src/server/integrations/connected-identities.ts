import { and, eq } from "drizzle-orm";
import type { db as defaultDb } from "@cmdclaw/db/client";
import { connectedIdentity, integration } from "@cmdclaw/db/schema";
import type { IntegrationType } from "../oauth/config";
import {
  getReliableEmailFromMetadata,
  getWorkspaceOrTenantNameFromMetadata,
  planConnectedIdentityAssignment,
  type ExistingConnectedIdentity,
} from "./account-labels";

type Database = typeof defaultDb;

type ProviderAccountInput = {
  userId: string;
  integrationType: IntegrationType;
  providerAccountId: string | null;
  displayName: string | null;
  metadata: Record<string, unknown> | null | undefined;
  requestedAccountLabel?: string | null;
};

export async function listExistingConnectedIdentities(
  db: Database,
  userId: string,
): Promise<ExistingConnectedIdentity[]> {
  const identities = await db.query.connectedIdentity.findMany({
    where: eq(connectedIdentity.userId, userId),
    with: {
      integrations: {
        columns: {
          type: true,
        },
      },
    },
  });

  return identities.map((identity) => ({
    id: identity.id,
    label: identity.label,
    emailIdentity: identity.emailIdentity,
    integrationTypes: identity.integrations.map((item) => item.type),
  }));
}

export async function findExistingConnectedAccount(
  db: Database,
  input: Pick<ProviderAccountInput, "userId" | "integrationType" | "providerAccountId">,
) {
  if (!input.providerAccountId) {
    return null;
  }

  return db.query.integration.findFirst({
    where: and(
      eq(integration.userId, input.userId),
      eq(integration.type, input.integrationType),
      eq(integration.providerAccountId, input.providerAccountId),
    ),
  });
}

export async function assignConnectedIdentityForProviderAccount(
  db: Database,
  input: ProviderAccountInput,
): Promise<{
  connectedIdentityId: string;
  accountLabel: string;
  reusedProviderAccount: boolean;
}> {
  const existingConnectedAccount = await findExistingConnectedAccount(db, input);
  if (existingConnectedAccount?.connectedIdentityId) {
    const identity = await db.query.connectedIdentity.findFirst({
      where: eq(connectedIdentity.id, existingConnectedAccount.connectedIdentityId),
    });
    if (identity) {
      return {
        connectedIdentityId: identity.id,
        accountLabel: identity.label,
        reusedProviderAccount: true,
      };
    }
  }

  const existingIdentities = await listExistingConnectedIdentities(db, input.userId);
  const assignment = planConnectedIdentityAssignment({
    requestedAccountLabel: input.requestedAccountLabel,
    newAccount: {
      userId: input.userId,
      integrationType: input.integrationType,
      providerIdentityId: input.providerAccountId,
      reliableEmail: getReliableEmailFromMetadata(input.displayName, input.metadata),
      displayName: input.displayName,
      workspaceOrTenantName: getWorkspaceOrTenantNameFromMetadata(input.metadata),
    },
    existingIdentities,
  });

  if (assignment.kind === "existing") {
    return {
      connectedIdentityId: assignment.connectedIdentityId,
      accountLabel: assignment.accountLabel,
      reusedProviderAccount: false,
    };
  }

  const [created] = await db
    .insert(connectedIdentity)
    .values({
      userId: input.userId,
      label: assignment.accountLabel,
      emailIdentity: assignment.emailIdentity,
      metadata: assignment.metadata,
    })
    .returning();

  return {
    connectedIdentityId: created.id,
    accountLabel: created.label,
    reusedProviderAccount: false,
  };
}
