import type { Session, User } from "better-auth";
import { recordUserActiveToday } from "@bap/core/server/services/user-telemetry";
import { user as userTable, workspace } from "@bap/db/schema";
import { os, ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import type { ORPCContext } from "./context";

// Base procedure with context
export const baseProcedure = os.$context<ORPCContext>();

// Authenticated context type
export type AuthenticatedContext = ORPCContext & {
  user: User;
  session: Session;
};

type SessionWithImpersonation = Session & {
  impersonatedBy?: string | null;
};

function getImpersonatedBy(session: Session): string | null {
  const impersonatedBy = (session as SessionWithImpersonation).impersonatedBy;
  return typeof impersonatedBy === "string" && impersonatedBy.trim().length > 0
    ? impersonatedBy
    : null;
}

export function resolveDailyActivityUserId(params: { session: Session; user: User }): string {
  return getImpersonatedBy(params.session) ?? params.user.id;
}

// Protected procedure requiring authentication
export const protectedProcedure = baseProcedure.use(async ({ context, next }) => {
  if (!context.user || !context.session) {
    console.error("[Auth Middleware] No user or session found");
    throw new ORPCError("UNAUTHORIZED", { message: "You must be logged in" });
  }

  if (context.authSource === "session" && context.workspaceId) {
    const [dbUser, activeWorkspace] = await Promise.all([
      context.db.query.user.findFirst({
        where: eq(userTable.id, context.user.id),
        columns: { twoFactorEnabled: true },
      }),
      context.db.query.workspace.findFirst({
        where: eq(workspace.id, context.workspaceId),
        columns: { requiresTwoFactor: true },
      }),
    ]);

    if (activeWorkspace?.requiresTwoFactor && dbUser?.twoFactorEnabled !== true) {
      throw new ORPCError("FORBIDDEN", {
        message: "Two-factor authentication is required by this Workspace.",
        data: { code: "TWO_FACTOR_SETUP_REQUIRED" },
      });
    }
  }

  try {
    await recordUserActiveToday({
      userId: resolveDailyActivityUserId({
        session: context.session,
        user: context.user,
      }),
    });
  } catch (error) {
    console.error("[Auth Middleware] Failed to record daily user activity", error);
  }

  try {
    return await next({
      context: {
        ...context,
        user: context.user,
        session: context.session,
      } satisfies AuthenticatedContext,
    });
  } catch (error) {
    console.error("[Procedure Error]", error);
    throw error;
  }
});

// Optional auth - passes through but includes user if available
export const optionalAuthProcedure = baseProcedure;
