import { user } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireActiveWorkspaceAccess } from "../../workspace-access";
import { requireAccessibleCoworkerInActiveWorkspace } from "./access";
import {
  exportCoworkerDefinition,
  importCoworkerDefinitionFromJson,
} from "@/server/services/coworker-definition";

const exportDefinition = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: coworkerRow } = await requireAccessibleCoworkerInActiveWorkspace(
      context,
      input.id,
    );
    return exportCoworkerDefinition({
      context,
      coworker: coworkerRow,
    });
  });

const importDefinition = protectedProcedure
  .input(z.object({ definitionJson: z.string().min(2).max(50_000_000) }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    const dbUser = await context.db.query.user.findFirst({
      where: eq(user.id, context.user.id),
      columns: { role: true },
    });

    return importCoworkerDefinitionFromJson({
      context,
      workspaceId,
      definitionJson: input.definitionJson,
      userRole: dbUser?.role ?? null,
    });
  });

export const coworkerDefinitionProcedures = {
  exportDefinition,
  importDefinition,
};
