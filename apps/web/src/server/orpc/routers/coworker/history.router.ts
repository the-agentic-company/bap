import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireActiveWorkspaceAccess } from "../../workspace-access";
import { getCoworkerHistory } from "@/server/services/coworker-history";

const getHistory = protectedProcedure
  .input(
    z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(200).default(100),
      })
      .optional(),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    return getCoworkerHistory({
      database: context.db as Parameters<typeof getCoworkerHistory>[0]["database"],
      userId: context.user.id,
      workspaceId,
      from: input?.from,
      to: input?.to,
      cursor: input?.cursor,
      limit: input?.limit,
    });
  });

export const coworkerHistoryProcedures = {
  getHistory,
};
