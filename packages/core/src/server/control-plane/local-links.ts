import { and, eq, lt } from "drizzle-orm";
import { db } from "@cmdclaw/db/client";
import { cloudAccountLink, cloudAccountLinkState } from "@cmdclaw/db/schema";

const LINK_STATE_TTL_MS = 10 * 60 * 1000;

export async function getCloudAccountLinkForUser(userId: string) {
  return db.query.cloudAccountLink.findFirst({
    where: eq(cloudAccountLink.userId, userId),
  });
}

export async function upsertCloudAccountLinkForUser(userId: string, cloudUserId: string) {
  const [link] = await db
    .insert(cloudAccountLink)
    .values({
      userId,
      cloudUserId,
      status: "linked",
    })
    .onConflictDoUpdate({
      target: [cloudAccountLink.userId],
      set: {
        cloudUserId,
        status: "linked",
        linkedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  return link;
}

async function clearCloudAccountLinkForUser(userId: string) {
  await db.delete(cloudAccountLink).where(eq(cloudAccountLink.userId, userId));
}

export async function createCloudAccountLinkState(params: {
  userId: string;
  requestedIntegrationType?: string | null;
  returnPath?: string | null;
}) {
  const cutoff = new Date(Date.now() - LINK_STATE_TTL_MS);
  await db.delete(cloudAccountLinkState).where(lt(cloudAccountLinkState.createdAt, cutoff));

  const state = crypto.randomUUID();
  await db.insert(cloudAccountLinkState).values({
    state,
    userId: params.userId,
    requestedIntegrationType: params.requestedIntegrationType ?? null,
    returnPath: params.returnPath ?? null,
  });

  return state;
}

export async function consumeCloudAccountLinkState(params: { state: string; userId: string }) {
  const [row] = await db
    .delete(cloudAccountLinkState)
    .where(
      and(eq(cloudAccountLinkState.state, params.state), eq(cloudAccountLinkState.userId, params.userId)),
    )
    .returning();

  if (!row) {
    return null;
  }

  if (Date.now() - row.createdAt.getTime() > LINK_STATE_TTL_MS) {
    return null;
  }

  return row;
}
