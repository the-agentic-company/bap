import { describe, expect, it } from "vitest";
import { schema } from "./schema";

describe("Zero schema allowlist", () => {
  it("does not include secret-bearing runtime tables", () => {
    expect(Object.keys(schema.tables)).not.toContain("generation");
    expect(Object.keys(schema.tables)).not.toContain("coworkerDocument");
    expect(Object.keys(schema.tables)).not.toContain("sandboxFile");
    expect(Object.keys(schema.tables)).not.toContain("integrationToken");
  });

  it("limits coworker run rows to list-safe columns", () => {
    const columns = Object.keys(schema.tables.coworkerRun.columns);

    expect(columns).toEqual([
      "id",
      "coworkerId",
      "ownerId",
      "workspaceId",
      "status",
      "generationId",
      "conversationId",
      "startedAt",
      "finishedAt",
      "syntheticKind",
    ]);
    expect(columns).not.toContain("triggerPayload");
    expect(columns).not.toContain("debugInfo");
    expect(columns).not.toContain("errorMessage");
  });

  it("keeps workspace membership as permission context only", () => {
    expect(Object.keys(schema.tables.workspaceMember.columns)).toEqual([
      "id",
      "workspaceId",
      "userId",
      "role",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("relates workspace-owned product tables to workspace membership for read rules", () => {
    for (const tableName of [
      "conversation",
      "coworker",
      "coworkerRun",
      "coworkerFolder",
      "coworkerTag",
    ] as const) {
      expect(schema.relationships[tableName].workspaceMembers).toEqual([
        expect.objectContaining({
          cardinality: "many",
          destField: ["workspaceId"],
          destSchema: "workspaceMember",
          sourceField: ["workspaceId"],
        }),
      ]);
    }
  });
});
