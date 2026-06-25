import { createServerFn } from "@tanstack/react-start";
import type { CoworkerSchedule } from "@/orpc/hooks/coworkers";
import type { CoworkerFolderItem, CoworkerItem } from "../-components/coworkers-page";

export type InitialCoworkerInventoryLoaderData = {
  coworkers: CoworkerItem[];
  folders: CoworkerFolderItem[];
  sharedCount: number;
  totalCount: number;
};

export const EMPTY_INITIAL_COWORKER_INVENTORY_DATA: InitialCoworkerInventoryLoaderData = {
  coworkers: [],
  folders: [],
  sharedCount: 0,
  totalCount: 0,
};

function serializeDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  return typeof value === "string" || typeof value === "number" ? new Date(value) : null;
}

function serializeInitialCoworker(row: Record<string, unknown>): CoworkerItem {
  const allowedIntegrations = Array.isArray(row.allowedIntegrations) ? row.allowedIntegrations : [];
  const allowedCustomIntegrations = Array.isArray(row.allowedCustomIntegrations)
    ? row.allowedCustomIntegrations
    : [];
  const allowedWorkspaceMcpServerIds = Array.isArray(row.allowedWorkspaceMcpServerIds)
    ? row.allowedWorkspaceMcpServerIds
    : [];
  const allowedSkillSlugs = Array.isArray(row.allowedSkillSlugs) ? row.allowedSkillSlugs : [];
  const recentRuns = Array.isArray(row.recentRuns) ? row.recentRuns : [];

  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    username: typeof row.username === "string" ? row.username : null,
    description: typeof row.description === "string" ? row.description : null,
    folderId: typeof row.folderId === "string" ? row.folderId : null,
    status: row.status === "off" ? "off" : "on",
    disabledReason: row.disabledReason === "run_backlog_limit" ? "run_backlog_limit" : null,
    disabledAt: serializeDate(row.disabledAt),
    autoApprove: row.autoApprove === true,
    model: typeof row.model === "string" ? row.model : "",
    authSource: row.authSource === "user" || row.authSource === "shared" ? row.authSource : null,
    triggerType: typeof row.triggerType === "string" ? row.triggerType : "manual",
    integrations: [],
    toolAccessMode: row.toolAccessMode === "selected" ? "selected" : "all",
    allowedIntegrations: allowedIntegrations as CoworkerItem["allowedIntegrations"],
    allowedCustomIntegrations:
      allowedCustomIntegrations as CoworkerItem["allowedCustomIntegrations"],
    allowedWorkspaceMcpServerIds:
      allowedWorkspaceMcpServerIds as CoworkerItem["allowedWorkspaceMcpServerIds"],
    allowedSkillSlugs: allowedSkillSlugs.filter((slug): slug is string => typeof slug === "string"),
    schedule: (row.schedule as CoworkerSchedule | null | undefined) ?? null,
    requiresUserInput: row.requiresUserInput === true,
    userInputPrompt: typeof row.userInputPrompt === "string" ? row.userInputPrompt : null,
    recentRuns: recentRuns.flatMap((run) => {
      if (!run || typeof run !== "object") {
        return [];
      }
      const runRecord = run as Record<string, unknown>;
      return [
        {
          id: String(runRecord.id),
          coworkerId:
            typeof runRecord.coworkerId === "string" ? runRecord.coworkerId : String(row.id),
          status: typeof runRecord.status === "string" ? runRecord.status : "unknown",
          generationId: typeof runRecord.generationId === "string" ? runRecord.generationId : null,
          conversationId:
            typeof runRecord.conversationId === "string" ? runRecord.conversationId : null,
          startedAt: serializeDate(runRecord.startedAt) ?? new Date(0),
          finishedAt: serializeDate(runRecord.finishedAt),
          errorMessage: null,
          source: "manual" as const,
        },
      ];
    }),
    isPinned: row.isPinned === true,
    sharedAt: serializeDate(row.sharedAt),
    updatedAt: serializeDate(row.updatedAt) ?? new Date(0),
    lastRunStatus: typeof row.lastRunStatus === "string" ? row.lastRunStatus : "",
    lastRunAt: serializeDate(row.lastRunAt) ?? new Date(0),
  };
}

function serializeInitialFolder(row: Record<string, unknown>): CoworkerFolderItem {
  return {
    id: String(row.id),
    workspaceId: typeof row.workspaceId === "string" ? row.workspaceId : "",
    ownerId: typeof row.ownerId === "string" ? row.ownerId : null,
    parentId: typeof row.parentId === "string" ? row.parentId : null,
    name: typeof row.name === "string" ? row.name : "",
    visibility: row.visibility === "workspace" ? "workspace" : "private",
    position: typeof row.position === "number" ? row.position : 0,
    createdAt: serializeDate(row.createdAt) ?? new Date(0),
    updatedAt: serializeDate(row.updatedAt) ?? new Date(0),
  };
}

export const loadInitialCoworkerInventory = createServerFn({ method: "GET" }).handler(async () => {
  const [
    { getRequest },
    { getRequestSession },
    { resolveSessionPrincipalWorkspaceId },
    { queryInitialCoworkerInventory },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/server/session-auth"),
    import("@/server/session-principal-workspace"),
    import("@/server/initial-coworker-inventory"),
  ]);
  const request = getRequest();
  const sessionData = await getRequestSession(request.headers);
  const userId = sessionData?.user?.id;

  if (!userId) {
    return EMPTY_INITIAL_COWORKER_INVENTORY_DATA;
  }

  const workspaceId = await resolveSessionPrincipalWorkspaceId(userId);
  const result = await queryInitialCoworkerInventory({
    userId,
    workspaceId,
  });

  return {
    coworkers: result.coworkers.map((row) =>
      serializeInitialCoworker(row as Record<string, unknown>),
    ),
    folders: result.folders.map((row) => serializeInitialFolder(row as Record<string, unknown>)),
    sharedCount: result.sharedCount,
    totalCount: result.totalCount,
  };
});
