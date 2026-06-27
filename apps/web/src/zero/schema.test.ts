import { describe, expect, it } from "vitest";
import { schema } from "./schema";

describe("Zero schema allowlist", () => {
  it("does not include secret-bearing runtime tables", () => {
    expect(Object.keys(schema.tables)).not.toContain("generation");
    expect(Object.keys(schema.tables)).not.toContain("integrationToken");
    expect(Object.keys(schema.tables)).not.toContain("coworkerDocument");
  });

  it("limits sandbox files to display and download metadata", () => {
    const columns = Object.keys(schema.tables.sandboxFile.columns);

    expect(columns).toEqual([
      "id",
      "messageId",
      "conversationId",
      "path",
      "filename",
      "mimeType",
      "sizeBytes",
      "createdAt",
    ]);
    expect(columns).not.toContain("storageKey");
  });

  it("limits message attachments to display and download metadata", () => {
    const columns = Object.keys(schema.tables.messageAttachment.columns);

    expect(columns).toEqual([
      "id",
      "messageId",
      "fileAssetId",
      "filename",
      "mimeType",
      "sizeBytes",
      "createdAt",
    ]);
    expect(columns).not.toContain("storageKey");
  });

  it("limits coworker run rows to list-safe columns", () => {
    const columns = Object.keys(schema.tables.coworkerRun.columns);

    expect(columns).toEqual([
      "id",
      "coworkerId",
      "ownerId",
      "workspaceId",
      "status",
      "failureKind",
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
