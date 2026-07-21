import { coworkerRun } from "@bap/db/schema";
import { resetCoworkerRunsAndEnable } from "@bap/core/server/services/coworker-run-reset";
import { reconcileCoworkerScheduleJob } from "@bap/core/server/services/coworker-scheduler";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAppAdminActor } from "../../app-admin-access";
import { protectedProcedure } from "../../middleware";
import { requireActiveWorkspaceAccess } from "../../workspace-access";
import {
  requireAccessibleCoworkerInActiveWorkspace,
  requireOwnedCoworkerInActiveWorkspace,
} from "./access";
import {
  getCoworkerRunView,
  listCoworkerRunViews,
  listWorkspaceCoworkerRunViews,
} from "@/server/services/coworker-run-view";

const getRun = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    return getCoworkerRunView({
      context,
      workspaceId,
      runId: input.id,
    });
  });

const getRunImpersonationTarget = protectedProcedure
  .input(
    z.object({
      runId: z.string(),
      coworkerId: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireAppAdminActor(context);

    const filters = [eq(coworkerRun.id, input.runId)];
    if (input.coworkerId) {
      filters.push(eq(coworkerRun.coworkerId, input.coworkerId));
    }

    const run = await context.db.query.coworkerRun.findFirst({
      where: and(...filters),
      columns: {
        id: true,
        coworkerId: true,
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
        coworker: {
          columns: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    if (!run?.ownerId || !run.owner) {
      throw new ORPCError("NOT_FOUND", { message: "Run not found" });
    }

    return {
      resourceType: "coworker_run" as const,
      resourceId: run.id,
      resourceLabel: run.coworker?.username
        ? `@${run.coworker.username}`
        : (run.coworker?.name ?? "Coworker run"),
      owner: {
        id: run.owner.id,
        name: run.owner.name,
        email: run.owner.email,
        image: run.owner.image,
      },
    };
  });

const listRuns = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string(),
      limit: z.number().min(1).max(50).default(20),
    }),
  )
  .handler(async ({ input, context }) => {
    const { coworker: wf, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.coworkerId,
    );

    return listCoworkerRunViews({
      context,
      workspaceId,
      coworkerId: wf.id,
      limit: input.limit,
    });
  });

const listWorkspaceRuns = protectedProcedure
  .input(
    z.object({
      cursor: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      status: z
        .enum([
          "needs_user_input",
          "running",
          "awaiting_approval",
          "awaiting_auth",
          "paused",
          "cancelling",
          "completed",
          "error",
          "cancelled",
        ])
        .optional(),
      coworkerId: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    return listWorkspaceCoworkerRunViews({
      context,
      workspaceId,
      cursor: input.cursor,
      limit: input.limit,
      status: input.status,
      coworkerId: input.coworkerId,
    });
  });

const resetRunsAndEnable = protectedProcedure
  .input(z.object({ coworkerId: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf, workspaceId } = await requireAccessibleCoworkerInActiveWorkspace(
      context,
      input.coworkerId,
    );
    const result = await resetCoworkerRunsAndEnable({
      coworkerId: wf.id,
      resetByUserId: context.user.id,
      workspaceId,
    });
    try {
      await reconcileCoworkerScheduleJob(wf.id);
    } catch (error) {
      console.error(`[coworker] failed to sync scheduler after reset (${wf.id})`, error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Coworker reset but failed to sync schedule job",
      });
    }
    return result;
  });

export const coworkerRunProcedures = {
  getRun,
  getRunImpersonationTarget,
  listRuns,
  listWorkspaceRuns,
  resetRunsAndEnable,
};
