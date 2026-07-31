import fs from "node:fs/promises";
import path from "node:path";
import { SANDBOX_COMMON_ROOT } from "@bap/sandbox/paths";
import { buildCustomSkillsAgentsFile } from "@bap/prompts";
import { build } from "esbuild";
import type { SandboxHandle } from "../core/types";
import { resolvePreferredCommunitySkillsForUser } from "../../services/integration-skill-service";
import { listAccessibleEnabledSkillsForUser } from "../../services/workspace-skill-service";
import { downloadFromS3 } from "../../storage/s3-client";
export {
  buildIntegrationSkillsSystemPrompt as getIntegrationSkillsSystemPrompt,
  buildSkillsSystemPrompt as getSkillsSystemPrompt,
} from "@bap/prompts";

function toLegacySandbox(sandbox: SandboxHandle) {
  const legacyProvider = sandbox.provider === "daytona" ? "daytona" : "e2b";

  return {
    provider: legacyProvider,
    sandboxId: sandbox.sandboxId,
    commands: {
      run: async (command: string, opts?: { timeoutMs?: number; envs?: Record<string, string> }) =>
        sandbox.exec(command, {
          timeoutMs: opts?.timeoutMs,
          env: opts?.envs,
        }),
    },
    files: {
      write: async (path: string, content: string | ArrayBuffer) =>
        sandbox.writeFile(path, content),
      read: async (path: string) => sandbox.readFile(path),
    },
  };
}

async function listCommonLibFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listCommonLibFiles(fullPath);
      }
      if (!entry.isFile() || entry.name.endsWith(".test.ts")) {
        return [];
      }
      return [fullPath];
    }),
  );

  return files.flat();
}

const MANAGED_INTEGRATION_ENTRYPOINTS = [
  "airtable/src/airtable.ts",
  "dynamics/src/dynamics.ts",
  "github/src/github.ts",
  "google-calendar/src/google-calendar.ts",
  "google-docs/src/google-docs.ts",
  "google-drive/src/google-drive.ts",
  "google-gmail/src/google-gmail.ts",
  "google-sheets/src/google-sheets.ts",
  "hubspot/src/hubspot.ts",
  "linkedin/src/linkedin.ts",
  "notion/src/notion.ts",
  "outlook-calendar/src/outlook-calendar.ts",
  "outlook-mail/src/outlook-mail.ts",
  "salesforce/src/salesforce.ts",
  "slack/src/slack.ts",
] as const;

export async function writeSandboxCommonLibToSandbox(sandbox: SandboxHandle): Promise<string[]> {
  const sourceRoot = path.join(SANDBOX_COMMON_ROOT, "lib");
  const integrationPermissionsPlugin = path.join(
    SANDBOX_COMMON_ROOT,
    "plugins",
    "integration-permissions.ts",
  );
  const integrationPolicyGate = path.join(SANDBOX_COMMON_ROOT, "cli", "integration-policy-gate.ts");
  const files = await listCommonLibFiles(sourceRoot);
  if (files.length === 0) {
    return [];
  }

  const [entries, skillEntries, pluginBuild, gateBuild, setupScript] = await Promise.all([
    Promise.all(
      files.map(async (filePath) => ({
        path: path.relative(sourceRoot, filePath),
        content: await fs.readFile(filePath, "utf8"),
      })),
    ),
    Promise.all(
      MANAGED_INTEGRATION_ENTRYPOINTS.map(async (entryPath) => ({
        path: entryPath,
        content: await fs.readFile(path.join(SANDBOX_COMMON_ROOT, "skills", entryPath), "utf8"),
      })),
    ),
    build({
      entryPoints: [integrationPermissionsPlugin],
      bundle: true,
      platform: "node",
      format: "esm",
      minify: false,
      write: false,
    }),
    build({
      entryPoints: [integrationPolicyGate],
      bundle: true,
      platform: "node",
      format: "esm",
      minify: false,
      write: false,
    }),
    fs.readFile(path.join(SANDBOX_COMMON_ROOT, "setup.sh"), "utf8"),
  ]);
  const bundledPlugin = pluginBuild.outputFiles[0]?.text;
  if (!bundledPlugin) {
    throw new Error("Integration permissions plugin bundle produced no output.");
  }
  const bundledGate = gateBuild.outputFiles[0]?.text;
  if (!bundledGate) {
    throw new Error("Integration policy CLI gate bundle produced no output.");
  }
  const payload = Buffer.from(JSON.stringify(entries), "utf8").toString("base64");
  const skillPayload = Buffer.from(JSON.stringify(skillEntries), "utf8").toString("base64");
  const command = [
    "python3 - <<'PY'",
    "import base64, json",
    "from pathlib import Path",
    `entries = json.loads(base64.b64decode(${JSON.stringify(payload)}).decode())`,
    `skill_entries = json.loads(base64.b64decode(${JSON.stringify(skillPayload)}).decode())`,
    "for root in ('/app/.claude/lib', '/app/.agents/lib'):",
    "  root_path = Path(root)",
    "  root_path.mkdir(parents=True, exist_ok=True)",
    "  for entry in entries:",
    "    target = root_path / entry['path']",
    "    target.parent.mkdir(parents=True, exist_ok=True)",
    "    target.write_text(entry['content'], encoding='utf8')",
    "for root in ('/app/.claude/skills', '/app/.agents/skills'):",
    "  root_path = Path(root)",
    "  for entry in skill_entries:",
    "    target = root_path / entry['path']",
    "    target.parent.mkdir(parents=True, exist_ok=True)",
    "    target.write_text(entry['content'], encoding='utf8')",
    "plugin = Path('/app/.opencode/plugins/integration-permissions.js')",
    "plugin.parent.mkdir(parents=True, exist_ok=True)",
    `plugin.write_text(${JSON.stringify(bundledPlugin)}, encoding='utf8')`,
    "Path('/app/.opencode/plugins/integration-permissions.ts').unlink(missing_ok=True)",
    "gate = Path('/app/.opencode/lib/integration-policy-gate.js')",
    `gate.write_text(${JSON.stringify(bundledGate)}, encoding='utf8')`,
    "setup = Path('/app/setup.sh')",
    `setup.write_text(${JSON.stringify(setupScript)}, encoding='utf8')`,
    "setup.chmod(0o755)",
    "PY",
    "bash /app/setup.sh",
  ].join("\n");

  const result = await sandbox.exec(command, { timeoutMs: 15_000 });
  if (result.exitCode !== 0) {
    throw new Error(
      `Sandbox common lib sync failed (exit=${result.exitCode}): ${result.stderr || result.stdout || "unknown error"}`,
    );
  }

  return [
    ...entries.map((entry) => entry.path),
    ...skillEntries.map((entry) => `../skills/${entry.path}`),
    "integration-policy-gate.js",
    "../plugins/integration-permissions.js",
  ].sort();
}

export async function writeSkillsToSandbox(
  sandbox: SandboxHandle,
  userId: string,
  allowedSkillNames?: string[],
): Promise<string[]> {
  const legacySandbox = toLegacySandbox(sandbox);
  const filteredSkills = await listAccessibleEnabledSkillsForUser(userId, allowedSkillNames);

  if (filteredSkills.length === 0) {
    return [];
  }

  await legacySandbox.commands.run("mkdir -p /app/.opencode/skills");

  const writtenSkills: string[] = [];

  await filteredSkills.reduce<Promise<void>>(async (prev, s) => {
    await prev;
    const skillDir = `/app/.opencode/skills/${s.name}`;
    await legacySandbox.commands.run(`mkdir -p "${skillDir}"`);

    await Promise.all(
      s.files.map(async (file) => {
        const filePath = `${skillDir}/${file.path}`;
        const lastSlash = filePath.lastIndexOf("/");
        const parentDir = filePath.substring(0, lastSlash);
        if (parentDir !== skillDir) {
          await legacySandbox.commands.run(`mkdir -p "${parentDir}"`);
        }
        await legacySandbox.files.write(filePath, file.content ?? "");
      }),
    );

    await Promise.all(
      s.documents.map(async (doc) => {
        try {
          const buffer = await downloadFromS3(doc.fileAsset?.storageKey ?? doc.storageKey);
          const docPath = `${skillDir}/${doc.path ?? doc.filename}`;
          const lastSlash = docPath.lastIndexOf("/");
          const parentDir = docPath.substring(0, lastSlash);
          if (parentDir !== skillDir) {
            await legacySandbox.commands.run(`mkdir -p "${parentDir}"`);
          }
          const arrayBuffer = new Uint8Array(buffer).buffer;
          await legacySandbox.files.write(docPath, arrayBuffer);
        } catch (error) {
          console.error(
            `[SkillsPrep] Failed to write document ${doc.path ?? doc.filename}:`,
            error,
          );
        }
      }),
    );

    writtenSkills.push(s.name);
  }, Promise.resolve());

  await legacySandbox.files.write(
    "/app/.opencode/AGENTS.md",
    buildCustomSkillsAgentsFile(filteredSkills),
  );

  return writtenSkills;
}

export async function writeSkillsAgentsIndexToSandbox(
  sandbox: SandboxHandle,
  skills: Array<{ name: string; displayName?: string | null; description?: string | null }>,
): Promise<void> {
  let agentsContent = "# Custom Skills\n\n";

  for (const skill of skills.toSorted((a, b) => a.name.localeCompare(b.name))) {
    agentsContent += `## ${skill.displayName ?? skill.name}\n\n`;
    if (skill.description) {
      agentsContent += `${skill.description}\n\n`;
    }
    agentsContent += `Files available in: /app/.opencode/skills/${skill.name}/\n\n`;
  }

  await sandbox.writeFile("/app/.opencode/AGENTS.md", agentsContent);
}

export async function writeResolvedIntegrationSkillsToSandbox(
  sandbox: SandboxHandle,
  userId: string,
  allowedSlugs?: string[],
): Promise<string[]> {
  const legacySandbox = toLegacySandbox(sandbox);
  const resolved = await resolvePreferredCommunitySkillsForUser(userId, allowedSlugs);
  if (resolved.length === 0) {
    return [];
  }

  await legacySandbox.commands.run("mkdir -p /app/.opencode/integration-skills");
  const written: string[] = [];

  await Promise.all(
    resolved.map(async (entry) => {
      const skillDir = `/app/.opencode/integration-skills/${entry.slug}`;
      await legacySandbox.commands.run(`mkdir -p "${skillDir}"`);

      await Promise.all(
        entry.files.map(async (file) => {
          const filePath = `${skillDir}/${file.path}`;
          const lastSlash = filePath.lastIndexOf("/");
          const parentDir = filePath.substring(0, lastSlash);
          if (parentDir !== skillDir) {
            await legacySandbox.commands.run(`mkdir -p "${parentDir}"`);
          }
          await legacySandbox.files.write(filePath, file.content);
        }),
      );

      written.push(entry.slug);
    }),
  );

  return written;
}
