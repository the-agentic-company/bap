import type { BapApiClient } from "@bap/client";
import { saveSkill, type SkillSaveValues } from "./skill-save";

export async function handleSkillAdd(params: {
  client: BapApiClient;
  files: Array<{ path: string; mimeType?: string; contentBase64: string }>;
}) {
  const created = await params.client.skill.import({ mode: "folder", files: params.files });
  return { status: "completed" as const, skill: created };
}

export async function handleSkillRead(params: {
  client: BapApiClient;
  query: { type: "list" } | { type: "get"; id: string };
}) {
  if (params.query.type === "get") {
    return {
      status: "completed" as const,
      skill: await params.client.skill.get({ id: params.query.id }),
    };
  }
  return { status: "completed" as const, skills: await params.client.skill.list() };
}

export async function handleSkillSave(params: {
  client: BapApiClient;
  id?: string;
  values: SkillSaveValues;
}) {
  const skill = await saveSkill(params.client, params.id, params.values);
  return { status: "completed" as const, skill };
}

export async function handleSkillDelete(params: { client: BapApiClient; id: string }) {
  await params.client.skill.delete({ id: params.id });
  return { status: "completed" as const, id: params.id, deleted: true };
}
