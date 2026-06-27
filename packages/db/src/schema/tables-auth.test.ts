import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { member } from "./tables-auth";

function columnName(column: unknown): string | undefined {
  return typeof column === "object" && column !== null && "name" in column
    ? String(column.name)
    : undefined;
}

describe("Better Auth member schema", () => {
  it("keeps one membership row per organization and user", () => {
    const config = getTableConfig(member);

    expect(
      config.indexes.map((index) => ({
        name: index.config.name,
        unique: index.config.unique,
        columns: index.config.columns.map(columnName),
      })),
    ).toContainEqual({
      name: "member_organization_user_uidx",
      unique: true,
      columns: ["organization_id", "user_id"],
    });
  });
});
