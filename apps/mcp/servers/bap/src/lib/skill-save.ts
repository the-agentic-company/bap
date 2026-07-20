import type { BapApiClient } from "@bap/client";

export type SkillSaveValues = {
  files?: Array<{ path: string; mimeType?: string; contentBase64: string }>;
  displayName?: string;
  description?: string;
  icon?: string | null;
  enabled?: boolean;
  visibility?: "public" | "private";
};

function requireSkillCreationFiles(values: SkillSaveValues) {
  if (!values.files?.length) throw new Error("Skill creation requires files.");
  if (!values.files.some((file) => file.path === "SKILL.md")) {
    throw new Error("Skill creation requires a root SKILL.md file.");
  }
  return values.files;
}

async function updateSkillMetadata(client: BapApiClient, id: string, values: SkillSaveValues) {
  const { visibility: _visibility, files: _files, ...metadata } = values;
  if (Object.keys(metadata).length > 0) await client.skill.update({ id, ...metadata });
}

async function updateSkillVisibility(
  client: BapApiClient,
  id: string,
  visibility: SkillSaveValues["visibility"],
) {
  if (!visibility) return;
  if (visibility === "public") await client.skill.share({ id });
  else await client.skill.unshare({ id });
}

async function createSkill(client: BapApiClient, values: SkillSaveValues) {
  const created = await client.skill.import({
    mode: "folder",
    files: requireSkillCreationFiles(values),
  });
  await updateSkillMetadata(client, created.id, values);
  if (values.visibility === "public") await client.skill.share({ id: created.id });
  return client.skill.get({ id: created.id });
}

async function updateSkillFiles(
  client: BapApiClient,
  skillId: string,
  currentFiles: Array<{ id: string; path: string }>,
  files: NonNullable<SkillSaveValues["files"]>,
) {
  for (const file of files) {
    const existing = currentFiles.find((candidate) => candidate.path === file.path);
    if (existing) {
      await client.skill.updateFile({ id: existing.id, contentBase64: file.contentBase64 });
    } else {
      await client.skill.addFile({
        skillId,
        path: file.path,
        contentBase64: file.contentBase64,
      });
    }
  }
}

async function updateSkill(client: BapApiClient, id: string, values: SkillSaveValues) {
  const { files, visibility, ...metadata } = values;
  if (Object.keys(metadata).length === 0 && !visibility && !files?.length) {
    throw new Error("Skill update must include at least one field.");
  }
  const current = await client.skill.get({ id });
  if (files) await updateSkillFiles(client, id, current.files, files);
  await updateSkillMetadata(client, id, values);
  await updateSkillVisibility(client, id, visibility);
  return client.skill.get({ id });
}

export function saveSkill(client: BapApiClient, id: string | undefined, values: SkillSaveValues) {
  return id ? updateSkill(client, id, values) : createSkill(client, values);
}
