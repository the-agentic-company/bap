import process from "node:process";
import {
  backfillLegacyFileAssets,
  type FileAssetBackfillResult,
} from "@bap/core/server/services/file-asset-backfill";
import { closePool, db } from "@bap/db/client";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function printUsage(): void {
  console.log("Usage: bun run --cwd apps/web file-assets:backfill [--dry-run]");
}

function parseArgs(args: string[]): { dryRun: boolean } {
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    fail(`Unknown argument: ${arg}`);
  }

  return { dryRun };
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatFileAssetBackfillResult(result: FileAssetBackfillResult): string {
  const lines = [`File Asset legacy backfill ${result.dryRun ? "dry run" : "apply"}`];

  for (const table of result.tables) {
    lines.push(
      [
        table.table,
        `eligible=${formatNumber(table.eligibleRows)}`,
        `fileAssets=${formatNumber(table.insertedFileAssets)}`,
        `rows=${formatNumber(table.updatedRows)}`,
        `references=${formatNumber(table.insertedReferences)}`,
      ].join(" "),
    );
  }

  lines.push(
    [
      "total",
      `eligible=${formatNumber(result.totals.eligibleRows)}`,
      `fileAssets=${formatNumber(result.totals.insertedFileAssets)}`,
      `rows=${formatNumber(result.totals.updatedRows)}`,
      `references=${formatNumber(result.totals.insertedReferences)}`,
    ].join(" "),
  );

  if (result.dryRun) {
    lines.push("Dry run only. Re-run without --dry-run to write File Assets and references.");
  }

  return lines.join("\n");
}

async function run(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  try {
    const result = await backfillLegacyFileAssets({
      database: db,
      dryRun: flags.dryRun,
    });

    console.log(formatFileAssetBackfillResult(result));
  } finally {
    await closePool();
  }
}

if (import.meta.main) {
  void run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
