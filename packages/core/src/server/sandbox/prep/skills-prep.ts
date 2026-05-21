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
          console.error(`[SkillsPrep] Failed to write document ${doc.path ?? doc.filename}:`, error);
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
