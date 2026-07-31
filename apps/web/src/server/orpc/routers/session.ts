import { session as sessionTable } from "@bap/db/schema";
import { and, eq } from "drizzle-orm";
import { protectedProcedure } from "../middleware";

const recordActivity = protectedProcedure.handler(async ({ context }) => {
  if (context.authSource !== "session") {
    return { success: true };
  }

  await context.db
    .update(sessionTable)
    .set({ lastActivityAt: new Date() })
    .where(and(eq(sessionTable.id, context.session.id), eq(sessionTable.userId, context.user.id)));

  return { success: true };
});

export const sessionRouter = { recordActivity };
