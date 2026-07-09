import { describe, expect, it } from "vitest";
import corePackageJson from "../../../../packages/core/package.json";
import sandboxPackageJson from "../../package.json";
import { BUN_VERSION, OPENCODE_PLUGIN_VERSION, OPENCODE_VERSION } from "./versions";

type PackageJson = {
  dependencies?: Record<string, string>;
};

function dependencyVersion(pkg: PackageJson, dependencyName: string): string {
  const spec = pkg.dependencies?.[dependencyName]?.trim();
  if (!spec) {
    throw new Error(`Missing dependency ${dependencyName}`);
  }

  const match = spec.match(/^[~^]?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/);
  if (!match) {
    throw new Error(`Expected ${dependencyName} to use an exact, ^, or ~ semver spec; got ${spec}`);
  }

  return match[1]!;
}

describe("OpenCode sandbox versions", () => {
  it("keeps the image pins and package dependencies aligned", () => {
    expect(OPENCODE_PLUGIN_VERSION).toBe(OPENCODE_VERSION);
    expect(dependencyVersion(sandboxPackageJson, "@opencode-ai/plugin")).toBe(
      OPENCODE_PLUGIN_VERSION,
    );
    expect(dependencyVersion(sandboxPackageJson, "@opencode-ai/sdk")).toBe(OPENCODE_VERSION);
    expect(dependencyVersion(corePackageJson, "@opencode-ai/sdk")).toBe(OPENCODE_VERSION);
    expect(BUN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
