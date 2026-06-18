import { coworker } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAppAdminActor } from "../../app-admin-access";
import { protectedProcedure } from "../../middleware";

const getImpersonationTarget = protectedProcedure
  .input(z.object({ coworkerId: z.string() }))
  .handler(async ({ input, context }) => {
    await requireAppAdminActor(context);

    const wf = await context.db.query.coworker.findFirst({
      where: eq(coworker.id, input.coworkerId),
      columns: {
        id: true,
        name: true,
        username: true,
        ownerId: true,
      },
      with: {
        owner: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    if (!wf?.ownerId || !wf.owner) {
      throw new ORPCError("NOT_FOUND", { message: "Coworker not found" });
    }

    return {
      resourceType: "coworker" as const,
      resourceId: wf.id,
      resourceLabel: wf.username ? `@${wf.username}` : wf.name,
      owner: {
        id: wf.owner.id,
        name: wf.owner.name,
        email: wf.owner.email,
        image: wf.owner.image,
      },
    };
  });

export const coworkerImpersonationProcedures = {
  getImpersonationTarget,
};
