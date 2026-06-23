import { describe, expect, it, vi } from "vitest";
import { backfillLegacyFileAssets } from "./file-asset-backfill";

type CountRow = {
  eligible_rows: string | number;
  inserted_file_assets: string | number;
  updated_rows: string | number;
  inserted_references: string | number;
};

function createDatabase(rows: CountRow[]) {
  const execute = vi.fn();

  for (const row of rows) {
    execute.mockResolvedValueOnce({ rows: [row] });
  }

  return { execute };
}

function collectSqlText(node: unknown): string {
  if (typeof node === "string") {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => collectSqlText(item)).join(" ");
  }

  if (!node || typeof node !== "object") {
    return "";
  }

  const record = node as { value?: unknown; queryChunks?: unknown[] };
  return `${collectSqlText(record.value)} ${collectSqlText(record.queryChunks)}`.trim();
}

describe("file asset legacy backfill", () => {
  it("runs the apply statements for all legacy file-bearing tables and totals their results", async () => {
    const database = createDatabase([
      {
        eligible_rows: "2",
        inserted_file_assets: "2",
        updated_rows: "2",
        inserted_references: "2",
      },
      {
        eligible_rows: 1,
        inserted_file_assets: 1,
        updated_rows: 1,
        inserted_references: 1,
      },
      {
        eligible_rows: "3",
        inserted_file_assets: "2",
        updated_rows: "3",
        inserted_references: "3",
      },
      {
        eligible_rows: 0,
        inserted_file_assets: 0,
        updated_rows: 0,
        inserted_references: 0,
      },
    ]);

    const result = await backfillLegacyFileAssets({ database: database as never });

    expect(database.execute).toHaveBeenCalledTimes(4);
    for (const call of database.execute.mock.calls) {
      const statement = collectSqlText(call[0]);
      expect(statement).toContain("returning id, storage_key");
      expect(statement).toContain("asset_links");
      expect(statement).toContain("inner join asset_links as asset");
    }
    expect(result).toEqual({
      dryRun: false,
      tables: [
        {
          table: "message_attachment",
          eligibleRows: 2,
          insertedFileAssets: 2,
          updatedRows: 2,
          insertedReferences: 2,
        },
        {
          table: "coworker_document",
          eligibleRows: 1,
          insertedFileAssets: 1,
          updatedRows: 1,
          insertedReferences: 1,
        },
        {
          table: "skill_document",
          eligibleRows: 3,
          insertedFileAssets: 2,
          updatedRows: 3,
          insertedReferences: 3,
        },
        {
          table: "sandbox_file",
          eligibleRows: 0,
          insertedFileAssets: 0,
          updatedRows: 0,
          insertedReferences: 0,
        },
      ],
      totals: {
        eligibleRows: 6,
        insertedFileAssets: 5,
        updatedRows: 6,
        insertedReferences: 6,
      },
    });
  });

  it("supports dry runs without reporting writes", async () => {
    const database = createDatabase([
      {
        eligible_rows: "4",
        inserted_file_assets: 0,
        updated_rows: 0,
        inserted_references: 0,
      },
      {
        eligible_rows: "0",
        inserted_file_assets: 0,
        updated_rows: 0,
        inserted_references: 0,
      },
      {
        eligible_rows: "1",
        inserted_file_assets: 0,
        updated_rows: 0,
        inserted_references: 0,
      },
      {
        eligible_rows: "2",
        inserted_file_assets: 0,
        updated_rows: 0,
        inserted_references: 0,
      },
    ]);

    const result = await backfillLegacyFileAssets({
      database: database as never,
      dryRun: true,
    });

    expect(database.execute).toHaveBeenCalledTimes(4);
    expect(result.dryRun).toBe(true);
    expect(result.totals).toEqual({
      eligibleRows: 7,
      insertedFileAssets: 0,
      updatedRows: 0,
      insertedReferences: 0,
    });
  });
});
