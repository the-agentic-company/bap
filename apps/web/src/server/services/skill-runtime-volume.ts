import {
  appendRuntimeVolumeSkillSlug,
  buildOwnedSkillsRuntimeVolumePrefix,
  buildSharedSkillsRuntimeVolumePrefix,
  reconcileRuntimeVolumeProjection,
} from "@bap/core/server/services/runtime-volume-service";

export function buildOwnedSkillRuntimeVolumePrefix(input: {
  workspaceId: string;
  userId: string;
  skillName: string;
}): string {
  return appendRuntimeVolumeSkillSlug(
    buildOwnedSkillsRuntimeVolumePrefix({
      workspaceId: input.workspaceId,
      userId: input.userId,
    }),
    input.skillName,
  );
}

export function buildSharedSkillRuntimeVolumePrefix(input: {
  workspaceId: string;
  skillName: string;
}): string {
  return appendRuntimeVolumeSkillSlug(
    buildSharedSkillsRuntimeVolumePrefix({ workspaceId: input.workspaceId }),
    input.skillName,
  );
}

export function buildReadableSkillRuntimeVolumePrefix(input: {
  workspaceId: string;
  currentUserId: string;
  skill: {
    name: string;
    userId: string;
    visibility: "private" | "public";
  };
}): string {
  if (input.skill.userId === input.currentUserId) {
    return buildOwnedSkillRuntimeVolumePrefix({
      workspaceId: input.workspaceId,
      userId: input.currentUserId,
      skillName: input.skill.name,
    });
  }

  return buildSharedSkillRuntimeVolumePrefix({
    workspaceId: input.workspaceId,
    skillName: input.skill.name,
  });
}

export async function refreshOwnedSkillsRuntimeVolumeProjection(input: {
  workspaceId: string;
  userId: string;
}): Promise<void> {
  await reconcileRuntimeVolumeProjection({
    workspaceId: input.workspaceId,
    kind: "owned_skills",
    ownerUserId: input.userId,
    storagePrefix: buildOwnedSkillsRuntimeVolumePrefix({
      workspaceId: input.workspaceId,
      userId: input.userId,
    }),
    mountPath: "/runtime/skills",
    readOnly: false,
    generationId: null,
  });
}

export async function refreshSharedSkillsRuntimeVolumeProjection(input: {
  workspaceId: string;
}): Promise<void> {
  await reconcileRuntimeVolumeProjection({
    workspaceId: input.workspaceId,
    kind: "shared_skills",
    storagePrefix: buildSharedSkillsRuntimeVolumePrefix({ workspaceId: input.workspaceId }),
    mountPath: "/runtime/shared-skills",
    readOnly: true,
    generationId: null,
  });
}
