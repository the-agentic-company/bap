import type { IntegrationType } from "@/lib/integration-icons";

type ZeroRunLike = {
  readonly id: string;
  readonly coworkerId: string;
  readonly status: string;
  readonly generationId?: string | null;
  readonly conversationId?: string | null;
  readonly startedAt: number | string | Date;
  readonly finishedAt?: number | string | Date | null;
};

type ZeroTagLike = {
  readonly id: string;
  readonly name: string;
  readonly color?: string | null;
  readonly assignments?: readonly ZeroTagAssignmentLike[];
};

type ZeroTagAssignmentLike = {
  readonly id: string;
  readonly coworkerId: string;
  readonly tagId: string;
  readonly createdAt: number | string | Date;
  readonly tag?: ZeroTagLike | null;
};

type ZeroCoworkerLike = {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly username?: string | null;
  readonly folderId?: string | null;
  readonly status: "on" | "off";
  readonly triggerType: string;
  readonly model: string;
  readonly authSource?: "user" | "shared" | null;
  readonly requiresUserInput: boolean;
  readonly userInputPrompt?: string | null;
  readonly autoApprove: boolean;
  readonly allowedIntegrations?: readonly IntegrationType[] | null;
  readonly allowedCustomIntegrations?: readonly string[] | null;
  readonly allowedWorkspaceMcpServerIds?: readonly string[] | null;
  readonly allowedSkillSlugs?: readonly string[] | null;
  readonly schedule?: unknown;
  readonly toolAccessMode?: "all" | "selected" | null;
  readonly isPinned: boolean;
  readonly sharedAt?: number | string | Date | null;
  readonly updatedAt: number | string | Date;
  readonly runs?: readonly ZeroRunLike[];
  readonly tagAssignments?: readonly ZeroTagAssignmentLike[];
};

type ZeroFolderLike = {
  readonly id: string;
  readonly workspaceId: string;
  readonly parentId?: string | null;
  readonly name: string;
  readonly position: number;
  readonly createdAt: number | string | Date;
  readonly updatedAt: number | string | Date;
};

function asDate(value: number | string | Date): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function dateOrNull(value?: number | string | Date | null): Date | null {
  return value == null ? null : asDate(value);
}

export function mapZeroCoworkerRun(run: ZeroRunLike) {
  return {
    id: run.id,
    coworkerId: run.coworkerId,
    status: run.status,
    generationId: run.generationId ?? null,
    conversationId: run.conversationId ?? null,
    startedAt: asDate(run.startedAt),
    finishedAt: dateOrNull(run.finishedAt),
    errorMessage: null,
    source: "manual" as const,
  };
}

export function mapZeroCoworkerList(coworkers: readonly ZeroCoworkerLike[]) {
  return coworkers
    .map((coworker) => {
      const recentRuns = (coworker.runs ?? [])
        .toSorted(
          (left, right) => asDate(right.startedAt).getTime() - asDate(left.startedAt).getTime(),
        )
        .slice(0, 20)
        .map(mapZeroCoworkerRun);
      const lastRun: (typeof recentRuns)[number] | undefined = recentRuns[0];
      const tags = (coworker.tagAssignments ?? [])
        .map((assignment) => assignment.tag)
        .filter((tag): tag is ZeroTagLike => Boolean(tag))
        .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color ?? null }))
        .toSorted((left, right) => left.name.localeCompare(right.name));

      return {
        id: coworker.id,
        name: coworker.name,
        description: coworker.description ?? null,
        username: coworker.username ?? null,
        folderId: coworker.folderId ?? null,
        status: coworker.status,
        autoApprove: coworker.autoApprove,
        model: coworker.model,
        authSource: coworker.authSource ?? null,
        triggerType: coworker.triggerType,
        integrations: [],
        toolAccessMode: coworker.toolAccessMode ?? "all",
        allowedIntegrations: [...(coworker.allowedIntegrations ?? [])],
        allowedCustomIntegrations: [...(coworker.allowedCustomIntegrations ?? [])],
        allowedWorkspaceMcpServerIds: [...(coworker.allowedWorkspaceMcpServerIds ?? [])],
        allowedSkillSlugs: [...(coworker.allowedSkillSlugs ?? [])],
        schedule: coworker.schedule ?? null,
        requiresUserInput: coworker.requiresUserInput,
        userInputPrompt: coworker.userInputPrompt ?? null,
        isPinned: coworker.isPinned,
        sharedAt: dateOrNull(coworker.sharedAt),
        updatedAt: asDate(coworker.updatedAt),
        lastRunStatus: lastRun?.status ?? null,
        lastRunAt: lastRun?.startedAt ?? null,
        tags,
        recentRuns,
      };
    })
    .toSorted((left, right) => {
      if (left.isPinned !== right.isPinned) {
        return left.isPinned ? -1 : 1;
      }
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });
}

export function mapZeroCoworkerFolders(folders: readonly ZeroFolderLike[]) {
  return folders.map((folder) => ({
    id: folder.id,
    workspaceId: folder.workspaceId,
    parentId: folder.parentId ?? null,
    name: folder.name,
    position: folder.position,
    createdAt: asDate(folder.createdAt),
    updatedAt: asDate(folder.updatedAt),
  }));
}

export function mapZeroCoworkerTags(tags: readonly ZeroTagLike[]) {
  return tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color ?? null,
    coworkerCount: tag.assignments?.length ?? 0,
  }));
}

export function mapZeroCoworkerTagAssignments(assignments: readonly ZeroTagAssignmentLike[]) {
  return assignments.map((assignment) => ({
    id: assignment.id,
    coworkerId: assignment.coworkerId,
    tagId: assignment.tagId,
    createdAt: asDate(assignment.createdAt),
  }));
}
