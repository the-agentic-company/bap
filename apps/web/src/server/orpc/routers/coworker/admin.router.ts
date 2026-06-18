import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireActiveWorkspaceAdmin } from "../../workspace-access";
import { listAdminWorkspaceCoworkers } from "@/server/services/coworker-admin-view";
import { getAdminWorkspaceCoworkerRunView } from "@/server/services/coworker-run-view";

const adminListWorkspaceCoworkers = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAdmin(context.user.id);
  return listAdminWorkspaceCoworkers({
    database: context.db,
    workspaceId,
  });
});

const adminGetWorkspaceRun = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAdmin(context.user.id);
    return getAdminWorkspaceCoworkerRunView({
      database: context.db,
      workspaceId,
      runId: input.id,
    });
  });

export const coworkerAdminProcedures = {
  adminListWorkspaceCoworkers,
  adminGetWorkspaceRun,
};
