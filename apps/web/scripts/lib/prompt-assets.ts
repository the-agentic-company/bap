import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

export function copyPromptAssetsToNitroServer(input: {
  sourceDir: string;
  serverSsrDir: string;
}): string[] {
  const targetAssetsDir = path.join(input.serverSsrDir, "assets");
  mkdirSync(targetAssetsDir, { recursive: true });

  const copiedPaths: string[] = [];
  for (const entry of readdirSync(input.sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(input.sourceDir, entry.name);
    const targetPath = path.join(targetAssetsDir, entry.name);

    rmSync(targetPath, { recursive: true, force: true });
    cpSync(sourcePath, targetPath, { recursive: true });
    copiedPaths.push(targetPath);
  }

  return copiedPaths;
}
