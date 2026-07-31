import { coworker } from "@bap/db/schema";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireActiveWorkspaceAccess } from "../../workspace-access";
import { requireAccessibleCoworkerInActiveWorkspace } from "./access";
import {
  getCoworkerCatalogDetails,
  listCoworkerCatalog,
  listCoworkerUsers,
} from "@/server/services/coworker-catalog";

const list = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  const coworkers = await context.db.query.coworker.findMany({
    where: and(
      eq(coworker.workspaceId, workspaceId),
      or(
        eq(coworker.visibility, "workspace"),
        eq(coworker.createdByUserId, context.user.id),
        eq(coworker.ownerId, context.user.id),
      ),
    ),
    orderBy: (wf, { desc }) => [desc(wf.updatedAt)],
  });

  return listCoworkerCatalog({
    context,
    coworkers,
  });
});

const get = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: coworkerRow } = await requireAccessibleCoworkerInActiveWorkspace(
      context,
      input.id,
    );

    return getCoworkerCatalogDetails({
      context,
      coworker: coworkerRow,
    });
  });

const listUsers = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  const coworkers = await context.db.query.coworker.findMany({
    where: and(
      eq(coworker.workspaceId, workspaceId),
      or(
        eq(coworker.visibility, "workspace"),
        eq(coworker.createdByUserId, context.user.id),
        eq(coworker.ownerId, context.user.id),
      ),
    ),
    columns: { id: true },
  });

  return listCoworkerUsers({
    context,
    coworkerIds: coworkers.map((item) => item.id),
  });
});

export const coworkerCatalogProcedures = {
  list,
  get,
  listUsers,
};
