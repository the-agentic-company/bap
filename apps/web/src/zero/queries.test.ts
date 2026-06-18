import { describe, expect, it } from "vitest";
import { zeroQueries, type ZeroQueryContext } from "./queries";

type WhereCondition = {
  readonly type: string;
  readonly op?: string;
  readonly conditions?: readonly WhereCondition[];
  readonly left?: {
    readonly name?: string;
  };
  readonly right?: {
    readonly value?: unknown;
  };
};

type QueryWithAst = {
  readonly ast: {
    readonly where?: {
      readonly conditions?: readonly WhereCondition[];
    };
    readonly related?: readonly QueryRelation[];
  };
};

type QueryRelation = {
  readonly subquery: {
    readonly table: string;
    readonly related?: readonly QueryRelation[];
  };
};

const queryContext = {
  userId: "user-1",
  workspaceId: "workspace-1",
} satisfies ZeroQueryContext;

function whereConditions(query: QueryWithAst) {
  return query.ast.where?.conditions ?? [];
}

function hasSimpleCondition(
  conditions: readonly WhereCondition[],
  column: string,
  op: string,
  value: unknown,
) {
  return conditions.some(
    (condition) =>
      condition.type === "simple" &&
      condition.left?.name === column &&
      condition.op === op &&
      condition.right?.value === value,
  );
}

function hasNestedSimpleCondition(
  conditions: readonly WhereCondition[],
  column: string,
  op: string,
  value: unknown,
) {
  return conditions.some((condition) =>
    condition.conditions
      ? hasSimpleCondition(condition.conditions, column, op, value)
      : hasSimpleCondition([condition], column, op, value),
  );
}

function hasRelatedTable(relations: readonly QueryRelation[] | undefined, table: string) {
  return (relations ?? []).some((relation) => relation.subquery.table === table);
}

describe("Zero queries", () => {
  it("keeps recent conversations scoped to visible chats", () => {
    const request = zeroQueries.conversations.recent({ limit: 10 });
    const conditions = whereConditions(
      request.query.fn({ args: request.args, ctx: queryContext }) as unknown as QueryWithAst,
    );

    expect(hasSimpleCondition(conditions, "userId", "=", queryContext.userId)).toBe(true);
    expect(hasSimpleCondition(conditions, "workspaceId", "=", queryContext.workspaceId)).toBe(true);
    expect(hasSimpleCondition(conditions, "type", "=", "chat")).toBe(true);
    expect(hasSimpleCondition(conditions, "archivedAt", "IS", null)).toBe(true);
    expect(hasSimpleCondition(conditions, "syntheticKind", "IS", null)).toBe(true);
  });

  it("loads coworker and build conversations by id", () => {
    const request = zeroQueries.conversations.byId({ id: "conversation-1" });
    const query = request.query.fn({
      args: request.args,
      ctx: queryContext,
    }) as unknown as QueryWithAst;
    const conditions = whereConditions(query);
    const messageRelation = query.ast.related?.find(
      (relation) => relation.subquery.table === "message",
    );

    expect(hasSimpleCondition(conditions, "id", "=", "conversation-1")).toBe(true);
    expect(hasSimpleCondition(conditions, "userId", "=", queryContext.userId)).toBe(true);
    expect(hasSimpleCondition(conditions, "workspaceId", "=", queryContext.workspaceId)).toBe(true);
    expect(hasSimpleCondition(conditions, "syntheticKind", "IS", null)).toBe(true);
    expect(hasSimpleCondition(conditions, "type", "=", "chat")).toBe(false);
    expect(hasSimpleCondition(conditions, "archivedAt", "IS", null)).toBe(false);
    expect(hasRelatedTable(messageRelation?.subquery.related, "sandboxFile")).toBe(true);
  });

  it("keeps coworker inventory scoped to the active workspace", () => {
    const request = zeroQueries.coworkerInventory.coworkers();
    const query = request.query.fn({
      args: request.args,
      ctx: queryContext,
    }) as unknown as QueryWithAst;
    const conditions = whereConditions(query);

    expect(hasSimpleCondition(conditions, "ownerId", "=", queryContext.userId)).toBe(true);
    expect(hasSimpleCondition(conditions, "workspaceId", "=", queryContext.workspaceId)).toBe(true);
  });

  it("keeps coworker folders scoped to owned or workspace-visible folders", () => {
    const request = zeroQueries.coworkerInventory.folders();
    const query = request.query.fn({
      args: request.args,
      ctx: queryContext,
    }) as unknown as QueryWithAst;
    const conditions = whereConditions(query);

    expect(hasSimpleCondition(conditions, "workspaceId", "=", queryContext.workspaceId)).toBe(true);
    expect(hasNestedSimpleCondition(conditions, "ownerId", "=", queryContext.userId)).toBe(true);
    expect(hasNestedSimpleCondition(conditions, "visibility", "=", "workspace")).toBe(true);
  });
});
