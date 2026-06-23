import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyPromptAssetsToNitroServer } from "../../scripts/lib/prompt-assets";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bap-prompt-assets-"));
  tempDirs.push(dir);
  return dir;
}

describe("copyPromptAssetsToNitroServer", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("copies prompt assets into the Nitro SSR assets directory", () => {
    const sourceDir = makeTempDir();
    const serverSsrDir = makeTempDir();
    const sourceRuntimeDir = path.join(sourceDir, "opencode-runtime");
    const targetRuntimeDir = path.join(serverSsrDir, "assets", "opencode-runtime");

    mkdirSync(sourceRuntimeDir, { recursive: true });
    mkdirSync(targetRuntimeDir, { recursive: true });
    writeFileSync(path.join(sourceRuntimeDir, "coworker-instructions-section.md"), "current");
    writeFileSync(path.join(targetRuntimeDir, "stale.md"), "stale");

    const copied = copyPromptAssetsToNitroServer({ sourceDir, serverSsrDir });

    expect(copied).toEqual([targetRuntimeDir]);
    expect(
      readFileSync(path.join(targetRuntimeDir, "coworker-instructions-section.md"), "utf8"),
    ).toBe("current");
    expect(existsSync(path.join(targetRuntimeDir, "stale.md"))).toBe(false);
  });
});
