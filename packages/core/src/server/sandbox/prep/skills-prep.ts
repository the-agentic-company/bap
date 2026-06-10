import fs from "node:fs/promises";
import path from "node:path";
import { SANDBOX_COMMON_ROOT } from "@cmdclaw/sandbox/paths";
import type { SandboxHandle } from "../core/types";
import { resolvePreferredCommunitySkillsForUser } from "../../services/integration-skill-service";
import { listAccessibleEnabledSkillsForUser } from "../../services/workspace-skill-service";
import { downloadFromS3 } from "../../storage/s3-client";

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

export async function writeSandboxCommonLibToSandbox(sandbox: SandboxHandle): Promise<string[]> {
  const sourceRoot = path.join(SANDBOX_COMMON_ROOT, "lib");
  const files = await listCommonLibFiles(sourceRoot);
  if (files.length === 0) {
    return [];
  }

  const entries = await Promise.all(
    files.map(async (filePath) => ({
      path: path.relative(sourceRoot, filePath),
      content: await fs.readFile(filePath, "utf8"),
    })),
  );
  const payload = Buffer.from(JSON.stringify(entries), "utf8").toString("base64");
  const command = [
    "python3 - <<'PY'",
    "import base64, json",
    "from pathlib import Path",
    `entries = json.loads(base64.b64decode(${JSON.stringify(payload)}).decode())`,
    "for root in ('/app/.claude/lib', '/app/.agents/lib'):",
    "  root_path = Path(root)",
    "  root_path.mkdir(parents=True, exist_ok=True)",
    "  for entry in entries:",
    "    target = root_path / entry['path']",
    "    target.parent.mkdir(parents=True, exist_ok=True)",
    "    target.write_text(entry['content'], encoding='utf8')",
    "PY",
  ].join("\n");

  const result = await sandbox.exec(command, { timeoutMs: 15_000 });
  if (result.exitCode !== 0) {
    throw new Error(
      `Sandbox common lib sync failed (exit=${result.exitCode}): ${result.stderr || result.stdout || "unknown error"}`,
    );
  }

  return entries.map((entry) => entry.path).sort();
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
  let agentsContent = "# Custom Skills\n\n";

  await filteredSkills.reduce<Promise<void>>(async (prev, s) => {
    await prev;
    const skillDir = `/app/.opencode/skills/${s.name}`;
    await legacySandbox.commands.run(`mkdir -p "${skillDir}"`);

    agentsContent += `## ${s.displayName}\n\n`;
    agentsContent += `${s.description}\n\n`;
    agentsContent += `Files available in: /app/.opencode/skills/${s.name}/\n\n`;

    await Promise.all(
      s.files.map(async (file) => {
        const filePath = `${skillDir}/${file.path}`;
        const lastSlash = filePath.lastIndexOf("/");
        const parentDir = filePath.substring(0, lastSlash);
        if (parentDir !== skillDir) {
          await legacySandbox.commands.run(`mkdir -p "${parentDir}"`);
        }
        await legacySandbox.files.write(filePath, file.content);
      }),
    );

    await Promise.all(
      s.documents.map(async (doc) => {
        try {
          const buffer = await downloadFromS3(doc.storageKey);
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

  await legacySandbox.files.write("/app/.opencode/AGENTS.md", agentsContent);

  return writtenSkills;
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

export function getSkillsSystemPrompt(skillNames: string[]): string {
  if (skillNames.length === 0) {
    return "";
  }

  return `
# Custom Skills

You have access to custom skills in /app/.opencode/skills/. Each skill directory contains:
- A SKILL.md file with instructions
- Any associated documents (PDFs, images, etc.) at the same level

Available skills:
${skillNames.map((name) => `- ${name}`).join("\n")}

Read the SKILL.md file in each skill directory when relevant to the user's request.
`;
}

export function getIntegrationSkillsSystemPrompt(skillSlugs: string[]): string {
  if (skillSlugs.length === 0) {
    return "";
  }

  return `
# Community Integration Skills

Use community integration skills for these slugs (preferred over official skill variants):
${skillSlugs.map((slug) => `- ${slug}`).join("\n")}

Community files are available in:
/app/.opencode/integration-skills/<slug>/

When a slug is listed above, prioritize that community skill's SKILL.md and resources for that integration.
`;
}
