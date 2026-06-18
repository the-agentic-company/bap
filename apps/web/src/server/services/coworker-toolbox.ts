import {
  normalizeCoworkerAllowedSkillSlugs,
  normalizeCoworkerToolAccessMode,
  type CoworkerToolAccessMode,
} from "@bap/core/lib/coworker-tool-policy";
import { workspaceMcpServer } from "@bap/db/schema";
import { and, eq, inArray } from "drizzle-orm";

type WorkspaceMcpLookupDatabase = {
  query: {
    workspaceMcpServer: {
      findMany: (args: unknown) => Promise<
        Array<{
          id: string;
          namespace: string;
          createdAt: Date;
        }>
      >;
    };
  };
};

export async function resolveSelectedWorkspaceMcpServerIds(input: {
  database: WorkspaceMcpLookupDatabase;
  workspaceId: string;
  toolAccessMode: CoworkerToolAccessMode;
  allowedIntegrations: string[];
  allowedWorkspaceMcpServerIds?: string[];
}): Promise<string[]> {
  const explicitWorkspaceMcpServerIds = input.allowedWorkspaceMcpServerIds ?? [];
  if (input.toolAccessMode !== "selected" || explicitWorkspaceMcpServerIds.length > 0) {
    return explicitWorkspaceMcpServerIds;
  }

  const allowedNamespaces = Array.from(new Set(input.allowedIntegrations));
  if (allowedNamespaces.length === 0) {
    return [];
  }

  const sources = await input.database.query.workspaceMcpServer.findMany({
    where: and(
      eq(workspaceMcpServer.workspaceId, input.workspaceId),
      eq(workspaceMcpServer.enabled, true),
      inArray(workspaceMcpServer.namespace, allowedNamespaces),
    ),
    columns: {
      id: true,
      namespace: true,
      createdAt: true,
    },
  });

  return sources
    .toSorted(
      (left, right) =>
        left.namespace.localeCompare(right.namespace) ||
        left.createdAt.getTime() - right.createdAt.getTime(),
    )
    .map((source) => source.id);
}

export function getResolvedCoworkerToolPolicy(wf: {
  toolAccessMode: CoworkerToolAccessMode | null;
  allowedIntegrations: string[];
  allowedSkillSlugs: string[] | null;
}) {
  return {
    toolAccessMode: normalizeCoworkerToolAccessMode(wf.toolAccessMode, wf.allowedIntegrations),
    allowedSkillSlugs: normalizeCoworkerAllowedSkillSlugs(wf.allowedSkillSlugs),
  };
}
