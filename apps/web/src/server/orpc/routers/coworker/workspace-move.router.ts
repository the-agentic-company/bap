import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { moveCoworkerToWorkspace } from "@/server/services/coworker-workspace-move";

const moveWorkspace = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string().min(1),
      targetWorkspaceId: z.string().min(1),
    }),
  )
  .handler(async ({ input, context }) => {
    return moveCoworkerToWorkspace({
      context,
      coworkerId: input.coworkerId,
      targetWorkspaceId: input.targetWorkspaceId,
    });
  });

export const coworkerWorkspaceMoveProcedures = {
  moveWorkspace,
};
