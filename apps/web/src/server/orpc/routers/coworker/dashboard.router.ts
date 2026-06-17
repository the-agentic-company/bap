import { protectedProcedure } from "../../middleware";
import { queryCoworkerOverview } from "../../shared/overview-queries";
import { queryUsageDashboard } from "../../shared/usage-queries";
import { requireActiveWorkspaceAccess } from "../../workspace-access";

const getOverview = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  return queryCoworkerOverview(context.db, {
    workspaceId,
    ownerId: context.user.id,
  });
});

const getUsageDashboard = protectedProcedure.handler(async ({ context }) => {
  const {
    workspace: { id: workspaceId },
  } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
  return queryUsageDashboard(context.db, workspaceId);
});

export const coworkerDashboardProcedures = {
  getOverview,
  getUsageDashboard,
};
