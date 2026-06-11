import { defineQueriesWithType, defineQueryWithType } from "@rocicorp/zero";
import { z } from "zod";
import { schema, zql } from "./schema";

export type ZeroQueryContext = {
  userId: string;
};

const RECENT_CONVERSATION_LIMIT = 100;
const COWORKER_LIMIT = 500;
const COWORKER_RUN_LIMIT = 200;
const COWORKER_RUNS_PER_COWORKER_LIMIT = 20;

const defineQuery = defineQueryWithType<typeof schema, ZeroQueryContext>();
const defineQueries = defineQueriesWithType<typeof schema>();

const conversationListInput = z
  .object({
    limit: z.number().int().positive().max(RECENT_CONVERSATION_LIMIT).optional(),
  })
  .optional();

const conversationByIdInput = z.object({
  id: z.string().min(1),
});

const coworkerRunsInput = z.object({
  coworkerId: z.string().min(1),
  limit: z.number().int().positive().max(COWORKER_RUN_LIMIT).optional(),
});

function accessibleConversations(ctx: ZeroQueryContext) {
  return zql.conversation
    .where("userId", ctx.userId)
    .whereExists("workspaceMembers", (members) => members.where("userId", ctx.userId))
    .where("type", "chat")
    .where("archivedAt", "IS", null)
    .where("syntheticKind", "IS", null);
}

function accessibleCoworkers(ctx: ZeroQueryContext) {
  return zql.coworker
    .where("ownerId", ctx.userId)
    .whereExists("workspaceMembers", (members) => members.where("userId", ctx.userId));
}

export const zeroQueries = defineQueries({
  conversations: {
    recent: defineQuery(conversationListInput, ({ args, ctx }) =>
      accessibleConversations(ctx)
        .related("messages", (messages) =>
          messages.where("role", "IN", ["user", "assistant"]).orderBy("createdAt", "asc"),
        )
        .orderBy("isPinned", "desc")
        .orderBy("updatedAt", "desc")
        .orderBy("id", "desc")
        .limit(args?.limit ?? 50),
    ),
    byId: defineQuery(conversationByIdInput, ({ args, ctx }) =>
      accessibleConversations(ctx)
        .where("id", args.id)
        .related("messages", (messages) =>
          messages.where("role", "IN", ["user", "assistant"]).orderBy("createdAt", "asc"),
        )
        .one(),
    ),
  },
  coworkerInventory: {
    coworkers: defineQuery(({ ctx }) =>
      accessibleCoworkers(ctx)
        .related("runs", (runs) =>
          runs
            .where("ownerId", ctx.userId)
            .whereExists("workspaceMembers", (members) => members.where("userId", ctx.userId))
            .where("syntheticKind", "IS", null)
            .orderBy("startedAt", "desc")
            .limit(COWORKER_RUNS_PER_COWORKER_LIMIT),
        )
        .related("tagAssignments", (assignments) => assignments.related("tag"))
        .orderBy("isPinned", "desc")
        .orderBy("updatedAt", "desc")
        .limit(COWORKER_LIMIT),
    ),
    runsByCoworker: defineQuery(coworkerRunsInput, ({ args, ctx }) =>
      zql.coworkerRun
        .where("coworkerId", args.coworkerId)
        .where("ownerId", ctx.userId)
        .whereExists("workspaceMembers", (members) => members.where("userId", ctx.userId))
        .where("syntheticKind", "IS", null)
        .orderBy("startedAt", "desc")
        .limit(args.limit ?? COWORKER_RUNS_PER_COWORKER_LIMIT),
    ),
    folders: defineQuery(({ ctx }) =>
      zql.coworkerFolder
        .whereExists("workspaceMembers", (members) => members.where("userId", ctx.userId))
        .orderBy("parentId", "asc")
        .orderBy("position", "asc")
        .orderBy("name", "asc"),
    ),
    tags: defineQuery(({ ctx }) =>
      zql.coworkerTag
        .whereExists("workspaceMembers", (members) => members.where("userId", ctx.userId))
        .related("assignments")
        .orderBy("name", "asc"),
    ),
    tagAssignments: defineQuery(({ ctx }) =>
      zql.coworkerTagAssignment
        .whereExists("coworker", (coworker) =>
          coworker
            .where("ownerId", ctx.userId)
            .whereExists("workspaceMembers", (members) => members.where("userId", ctx.userId)),
        )
        .orderBy("createdAt", "asc"),
    ),
  },
});
