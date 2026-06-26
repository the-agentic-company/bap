import type { IntegrationType } from "@/lib/integration-icons";
import type { CoworkerSchedule } from "@/orpc/hooks/coworkers";

type ZeroRunLike = {
  readonly id: string;
  readonly coworkerId: string;
  readonly status: string;
  readonly generationId?: string | null;
  readonly conversationId?: string | null;
  readonly startedAt: number | string | Date;
  readonly finishedAt?: number | string | Date | null;
};

type ZeroCoworkerLike = {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly username?: string | null;
  readonly folderId?: string | null;
  readonly status: "on" | "off";
  readonly disabledReason?: "run_backlog_limit" | null;
  readonly disabledAt?: number | string | Date | null;
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
  readonly schedule?: CoworkerSchedule | null;
  readonly toolAccessMode?: "all" | "selected" | null;
  readonly isPinned: boolean;
  readonly sharedAt?: number | string | Date | null;
  readonly updatedAt: number | string | Date;
  readonly runs?: readonly ZeroRunLike[];
};

type ZeroFolderLike = {
  readonly id: string;
  readonly workspaceId: string;
  readonly ownerId?: string | null;
  readonly parentId?: string | null;
  readonly name: string;
  readonly visibility: "private" | "workspace";
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

      return {
        id: coworker.id,
        name: coworker.name,
        description: coworker.description ?? null,
        username: coworker.username ?? null,
        folderId: coworker.folderId ?? null,
        status: coworker.status,
        disabledReason: coworker.disabledReason ?? null,
        disabledAt: dateOrNull(coworker.disabledAt),
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
    ownerId: folder.ownerId ?? null,
    parentId: folder.parentId ?? null,
    name: folder.name,
    visibility: folder.visibility,
    position: folder.position,
    createdAt: asDate(folder.createdAt),
    updatedAt: asDate(folder.updatedAt),
  }));
}
