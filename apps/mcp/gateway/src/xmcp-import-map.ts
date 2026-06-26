import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

async function collectTypeScriptFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(absolutePath);
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        return [];
      }
      return [absolutePath];
    }),
  );

  return files.flat().sort((left, right) => left.localeCompare(right));
}

function toImportMapSection(baseDir: string, files: string[]): string {
  if (files.length === 0) {
    return "";
  }

  return files
    .map((absolutePath) => {
      const relativePath = path
        .relative(baseDir, absolutePath)
        .split(path.sep)
        .join(path.posix.sep);
      return `"${relativePath}": () => import("../${relativePath}"),`;
    })
    .join("\n");
}

export async function refreshXmcpImportMap(childRoot: string) {
  const rootDir = childRoot;
  const srcDir = path.join(rootDir, "src");
  const toolsDir = path.join(srcDir, "tools");
  const promptsDir = path.join(srcDir, "prompts");
  const resourcesDir = path.join(srcDir, "resources");
  const xmcpDir = path.join(childRoot, ".xmcp");
  const importMapPath = path.join(xmcpDir, "import-map.js");

  const [toolFiles, promptFiles, resourceFiles] = await Promise.all([
    collectTypeScriptFiles(toolsDir).catch(() => []),
    collectTypeScriptFiles(promptsDir).catch(() => []),
    collectTypeScriptFiles(resourcesDir).catch(() => []),
  ]);

  const contents = `
export const tools = {
${toImportMapSection(rootDir, toolFiles)}
};

export const prompts = {
${toImportMapSection(rootDir, promptFiles)}
};

export const resources = {
${toImportMapSection(rootDir, resourceFiles)}
};

export const clientBundles = {

};

export const middleware = () => import("../src/middleware.ts");
`.trimStart();

  await mkdir(xmcpDir, { recursive: true });
  await writeFile(importMapPath, contents, "utf8");
}
