import {
  MANAGED_INTEGRATION_CATALOG,
  acceptsOperationRestrictions,
  resolveWorkspaceIntegrationPolicy,
  type ManagedIntegrationType,
  type WorkspaceIntegrationOperationRestriction,
  type WorkspaceIntegrationPolicyDecision,
  type WorkspaceIntegrationPolicyMode,
} from "@bap/integration-policy";
import { db } from "@bap/db/client";
import {
  galienWorkspaceAccess,
  modulrWorkspaceAccess,
  workspaceMcpServer,
  workspaceIntegrationOperationPolicy,
  workspaceIntegrationPolicy,
} from "@bap/db/schema";
import { and, eq } from "drizzle-orm";

export type WorkspaceIntegrationPolicySubject =
  | {
      kind: "integration";
      integrationType: ManagedIntegrationType;
    }
  | {
      kind: "workspace_mcp_server";
      workspaceMcpServerId: string;
    };

export type WorkspaceIntegrationPolicySnapshot = {
  mode: WorkspaceIntegrationPolicyMode;
  explicit: boolean;
  restrictions: Record<string, WorkspaceIntegrationOperationRestriction>;
};

export type WorkspaceIntegrationPolicyMutation = {
  workspaceId: string;
  subject: WorkspaceIntegrationPolicySubject;
  mode: WorkspaceIntegrationPolicyMode;
  restrictions?: Array<{
    operationKey: string;
    restriction: WorkspaceIntegrationOperationRestriction;
  }>;
  actorUserId: string;
};

export type WorkspaceIntegrationPolicyCatalog = {
  managedIntegrations: Array<{
    subject: Extract<WorkspaceIntegrationPolicySubject, { kind: "integration" }>;
    displayName: string;
    mode: WorkspaceIntegrationPolicyMode;
    explicit: boolean;
    operations: Array<{
      key: string;
      label: string;
      accessHint: "read" | "write";
      restriction: WorkspaceIntegrationOperationRestriction | null;
    }>;
  }>;
  workspaceMcpServers: Array<{
    subject: Extract<WorkspaceIntegrationPolicySubject, { kind: "workspace_mcp_server" }>;
    name: string;
    namespace: string;
    endpoint: string;
    mode: WorkspaceIntegrationPolicyMode;
    explicit: boolean;
    available: boolean;
    operations: Array<{
      key: string;
      label: string;
      description: string | null;
      available: boolean;
      firstSeenAt: Date;
      lastSeenAt: Date;
      restriction: WorkspaceIntegrationOperationRestriction | null;
    }>;
  }>;
};

type Database = typeof db;

export async function hasWorkspaceManagedMcpAccess(input: {
  database?: Database;
  workspaceId: string;
  internalKey: "galien" | "modulr";
  managedWorkspaceWideAccess: boolean;
}): Promise<boolean> {
  if (input.managedWorkspaceWideAccess) {
    return true;
  }

  const database = input.database ?? db;
  if (input.internalKey === "galien") {
    return Boolean(
      await database.query.galienWorkspaceAccess.findFirst({
        where: eq(galienWorkspaceAccess.workspaceId, input.workspaceId),
        columns: { id: true },
      }),
    );
  }

  return Boolean(
    await database.query.modulrWorkspaceAccess.findFirst({
      where: eq(modulrWorkspaceAccess.workspaceId, input.workspaceId),
      columns: { id: true },
    }),
  );
}

export function workspaceIntegrationPolicySubjectKey(
  subject: WorkspaceIntegrationPolicySubject,
): string {
  return subject.kind === "integration"
    ? `integration:${subject.integrationType}`
    : `workspace_mcp_server:${subject.workspaceMcpServerId}`;
}

export function normalizeWorkspaceIntegrationPolicyMutation(
  input: Pick<WorkspaceIntegrationPolicyMutation, "mode" | "restrictions">,
): Array<{
  operationKey: string;
  restriction: WorkspaceIntegrationOperationRestriction;
}> {
  const restrictions = input.restrictions ?? [];
  if (!acceptsOperationRestrictions(input.mode)) {
    if (restrictions.length > 0) {
      throw new Error("Operation restrictions are only valid in Personalized mode.");
    }
    return [];
  }

  const normalized = new Map<string, WorkspaceIntegrationOperationRestriction>();
  for (const entry of restrictions) {
    const operationKey = entry.operationKey.trim();
    if (!operationKey) {
      throw new Error("Operation key is required.");
    }
    if (normalized.has(operationKey)) {
      throw new Error(`Duplicate operation restriction: ${operationKey}`);
    }
    normalized.set(operationKey, entry.restriction);
  }

  return Array.from(normalized, ([operationKey, restriction]) => ({
    operationKey,
    restriction,
  })).toSorted((left, right) => left.operationKey.localeCompare(right.operationKey));
}

export async function getWorkspaceIntegrationPolicy(input: {
  database?: Database;
  workspaceId: string;
  subject: WorkspaceIntegrationPolicySubject;
}): Promise<WorkspaceIntegrationPolicySnapshot> {
  const database = input.database ?? db;
  const row = await database.query.workspaceIntegrationPolicy.findFirst({
    where: and(
      eq(workspaceIntegrationPolicy.workspaceId, input.workspaceId),
      eq(
        workspaceIntegrationPolicy.subjectKey,
        workspaceIntegrationPolicySubjectKey(input.subject),
      ),
    ),
    with: {
      operationPolicies: true,
    },
  });

  if (!row) {
    return {
      mode: "auto_approved",
      explicit: false,
      restrictions: {},
    };
  }

  return {
    mode: row.mode,
    explicit: true,
    restrictions: Object.fromEntries(
      row.operationPolicies.map((entry) => [entry.operationKey, entry.restriction]),
    ),
  };
}

export async function listWorkspaceIntegrationPolicyCatalog(input: {
  database?: Database;
  workspaceId: string;
}): Promise<WorkspaceIntegrationPolicyCatalog> {
  const database = input.database ?? db;
  const [policyRows, serverRows] = await Promise.all([
    database.query.workspaceIntegrationPolicy.findMany({
      where: eq(workspaceIntegrationPolicy.workspaceId, input.workspaceId),
      with: { operationPolicies: true },
    }),
    database.query.workspaceMcpServer.findMany({
      where: eq(workspaceMcpServer.workspaceId, input.workspaceId),
      with: { toolCatalog: true },
      orderBy: (server, { asc }) => [asc(server.name)],
    }),
  ]);

  const policyBySubjectKey = new Map(
    policyRows.map((row) => [
      row.subjectKey,
      {
        mode: row.mode,
        explicit: true,
        restrictions: new Map(
          row.operationPolicies.map((entry) => [entry.operationKey, entry.restriction]),
        ),
      },
    ]),
  );

  const managedIntegrations = MANAGED_INTEGRATION_CATALOG.map((descriptor) => {
    const subject = {
      kind: "integration" as const,
      integrationType: descriptor.integrationType,
    };
    const policy = policyBySubjectKey.get(workspaceIntegrationPolicySubjectKey(subject));
    return {
      subject,
      displayName: descriptor.displayName,
      mode: policy?.mode ?? ("auto_approved" as const),
      explicit: policy?.explicit ?? false,
      operations: descriptor.operations.map((operation) => ({
        key: operation.key,
        label: operation.label,
        accessHint: operation.accessHint,
        restriction: policy?.restrictions.get(operation.key) ?? null,
      })),
    };
  });

  const governedServerRows = serverRows.filter(
    (server) => server.internalKey !== "gmail" && server.internalKey !== "bap",
  );
  const visibleServerRows = (
    await Promise.all(
      governedServerRows.map(async (server) => {
        if (server.internalKey !== "galien" && server.internalKey !== "modulr") {
          return server;
        }
        return (await hasWorkspaceManagedMcpAccess({
          database,
          workspaceId: input.workspaceId,
          internalKey: server.internalKey,
          managedWorkspaceWideAccess: server.managedWorkspaceWideAccess,
        }))
          ? server
          : null;
      }),
    )
  ).filter((server): server is (typeof governedServerRows)[number] => Boolean(server));

  const workspaceMcpServers = visibleServerRows.map((server) => {
    const subject = {
      kind: "workspace_mcp_server" as const,
      workspaceMcpServerId: server.id,
    };
    const policy = policyBySubjectKey.get(workspaceIntegrationPolicySubjectKey(subject));
    return {
      subject,
      name: server.name,
      namespace: server.namespace,
      endpoint: server.endpoint,
      mode: policy?.mode ?? ("auto_approved" as const),
      explicit: policy?.explicit ?? false,
      available: server.enabled,
      operations: server.toolCatalog
        .map((tool) => ({
          key: tool.toolName,
          label: tool.title ?? tool.toolName,
          description: tool.description,
          available: tool.available,
          firstSeenAt: tool.firstSeenAt,
          lastSeenAt: tool.lastSeenAt,
          restriction: policy?.restrictions.get(tool.toolName) ?? null,
        }))
        .toSorted((left, right) => left.label.localeCompare(right.label)),
    };
  });

  return { managedIntegrations, workspaceMcpServers };
}

export async function resolveWorkspaceIntegrationOperationPolicy(input: {
  database?: Database;
  workspaceId: string;
  subject: WorkspaceIntegrationPolicySubject;
  operationKey: string;
  generationAutoApprove: boolean;
}): Promise<
  WorkspaceIntegrationPolicyDecision & {
    policyExplicit: boolean;
  }
> {
  const policy = await getWorkspaceIntegrationPolicy(input);
  return {
    ...resolveWorkspaceIntegrationPolicy({
      parentMode: policy.explicit ? policy.mode : null,
      operationRestriction: policy.restrictions[input.operationKey] ?? null,
      generationAutoApprove: input.generationAutoApprove,
    }),
    policyExplicit: policy.explicit,
  };
}

export async function replaceWorkspaceIntegrationPolicy(
  input: WorkspaceIntegrationPolicyMutation & { database?: Database },
): Promise<WorkspaceIntegrationPolicySnapshot> {
  const database = input.database ?? db;
  const restrictions = normalizeWorkspaceIntegrationPolicyMutation(input);
  const subjectKey = workspaceIntegrationPolicySubjectKey(input.subject);

  await database.transaction(async (tx) => {
    if (input.mode === "auto_approved" && restrictions.length === 0) {
      await tx
        .delete(workspaceIntegrationPolicy)
        .where(
          and(
            eq(workspaceIntegrationPolicy.workspaceId, input.workspaceId),
            eq(workspaceIntegrationPolicy.subjectKey, subjectKey),
          ),
        );
      return;
    }

    const [policy] = await tx
      .insert(workspaceIntegrationPolicy)
      .values({
        workspaceId: input.workspaceId,
        subjectKey,
        integrationType:
          input.subject.kind === "integration" ? input.subject.integrationType : null,
        workspaceMcpServerId:
          input.subject.kind === "workspace_mcp_server" ? input.subject.workspaceMcpServerId : null,
        mode: input.mode,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
      })
      .onConflictDoUpdate({
        target: [workspaceIntegrationPolicy.workspaceId, workspaceIntegrationPolicy.subjectKey],
        set: {
          mode: input.mode,
          updatedByUserId: input.actorUserId,
          updatedAt: new Date(),
        },
      })
      .returning({ id: workspaceIntegrationPolicy.id });

    if (!policy) {
      throw new Error("Workspace integration policy upsert returned no row.");
    }

    await tx
      .delete(workspaceIntegrationOperationPolicy)
      .where(eq(workspaceIntegrationOperationPolicy.workspaceIntegrationPolicyId, policy.id));

    if (restrictions.length > 0) {
      await tx.insert(workspaceIntegrationOperationPolicy).values(
        restrictions.map((entry) => ({
          workspaceIntegrationPolicyId: policy.id,
          operationKey: entry.operationKey,
          restriction: entry.restriction,
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId,
        })),
      );
    }
  });

  return await getWorkspaceIntegrationPolicy({
    database,
    workspaceId: input.workspaceId,
    subject: input.subject,
  });
}
