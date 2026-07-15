import { coworker } from "@bap/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireActiveWorkspaceAccess } from "../../workspace-access";
import { requireAccessibleCoworkerInActiveWorkspace } from "./access";
import { getCoworkerCatalogDetails, listCoworkerCatalog } from "@/server/services/coworker-catalog";

const list = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  const coworkers = await context.db.query.coworker.findMany({
    where: and(eq(coworker.ownerId, context.user.id), eq(coworker.workspaceId, workspaceId)),
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

export const coworkerCatalogProcedures = {
  list,
  get,
};
