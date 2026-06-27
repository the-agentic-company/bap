import { migrateLegacyRuntimeVolumeDataForWorkspace } from "../packages/core/src/server/services/runtime-volume-service";
import { closePool } from "../packages/db/src/client";

const workspaceId = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!workspaceId) {
  console.error(
    "Usage: bun --env-file=.env scripts/migrate-runtime-volumes.ts <workspace-id> [--dry-run]",
  );
  process.exit(1);
}

try {
  const result = await migrateLegacyRuntimeVolumeDataForWorkspace({ workspaceId, dryRun });
  console.info(dryRun ? "Runtime Volume migration dry run completed" : "Runtime Volume migration completed", {
    workspaceId,
    ...result,
  });
} finally {
  await closePool();
}
