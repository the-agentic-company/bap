import { decideCoworkerAccess } from "./coworker-access-policy";
import {
  findCoworkerRevisionConflicts,
  listChangedCoworkerFields,
  mergeCoworkerConfigurationPatch,
} from "./coworker-revision-policy";

export type CoworkerChangeOrigin = "direct" | "builder_chat" | "runtime" | "restore" | "migration";

export type CoworkerConfigurationSnapshot = {
  name: string;
  description: string | null;
  username: string | null;
  status: "on" | "off";
  triggerType: string;
  prompt: string;
  model: string;
  authSource: string | null;
  requiresUserInput: boolean;
  userInputPrompt: string | null;
  autoApprove: boolean;
  toolAccessMode: "all" | "selected";
  allowedIntegrations: string[];
  allowedCustomIntegrations: string[];
  allowedWorkspaceMcpServerIds: string[];
  allowedSkillSlugs: string[];
  schedule: unknown;
  visibility: "private" | "workspace";
};

export type CoworkerConfigurationPatch = Partial<CoworkerConfigurationSnapshot>;

export type CanonicalCoworkerRecord = {
  id: string;
  visibility: "private" | "workspace";
  createdByUserId: string | null;
  configurationRevision: number;
  configuration: CoworkerConfigurationSnapshot;
};

export type CoworkerRevisionRecord = {
  coworkerId: string;
  revision: number;
  baseRevision: number;
  actorUserId: string | null;
  actorNameSnapshot: string | null;
  actorAvatarSnapshot: string | null;
  origin: CoworkerChangeOrigin;
  changedFields: string[];
  changes: Record<string, { before: unknown; after: unknown }>;
  snapshot: CoworkerConfigurationSnapshot;
  createdAt: Date;
};

export type CoworkerChangeRepository = {
  getCoworker(coworkerId: string): Promise<CanonicalCoworkerRecord | null>;
  listRevisionsAfter(coworkerId: string, revision: number): Promise<CoworkerRevisionRecord[]>;
  commit(input: {
    coworkerId: string;
    expectedRevision: number;
    configuration: CoworkerConfigurationSnapshot;
    revision: CoworkerRevisionRecord;
  }): Promise<boolean>;
};

export type CoworkerChangeResult =
  | { kind: "applied"; coworker: CanonicalCoworkerRecord; revision: CoworkerRevisionRecord }
  | { kind: "unchanged"; coworker: CanonicalCoworkerRecord }
  | { kind: "not_found" }
  | { kind: "forbidden"; reason: string }
  | {
      kind: "conflict";
      currentRevision: number;
      conflictingFields: string[];
      currentValues: Record<string, unknown>;
      latestActors: Record<
        string,
        { userId: string | null; name: string | null; avatar: string | null }
      >;
    };

function buildChangeMap(
  current: CoworkerConfigurationSnapshot,
  next: CoworkerConfigurationSnapshot,
  changedFields: readonly string[],
): Record<string, { before: unknown; after: unknown }> {
  return Object.fromEntries(
    changedFields.map((field) => [
      field,
      {
        before: current[field as keyof CoworkerConfigurationSnapshot],
        after: next[field as keyof CoworkerConfigurationSnapshot],
      },
    ]),
  );
}

function buildConflict(input: {
  current: CanonicalCoworkerRecord;
  conflicts: string[];
  revisions: CoworkerRevisionRecord[];
}): Extract<CoworkerChangeResult, { kind: "conflict" }> {
  const latestActors = Object.fromEntries(
    input.conflicts.map((field) => {
      const latest = input.revisions.findLast((revision) =>
        revision.changedFields.includes(field),
      );
      return [
        field,
        {
          userId: latest?.actorUserId ?? null,
          name: latest?.actorNameSnapshot ?? null,
          avatar: latest?.actorAvatarSnapshot ?? null,
        },
      ];
    }),
  );

  return {
    kind: "conflict",
    currentRevision: input.current.configurationRevision,
    conflictingFields: input.conflicts,
    currentValues: Object.fromEntries(
      input.conflicts.map((field) => [
        field,
        input.current.configuration[field as keyof CoworkerConfigurationSnapshot],
      ]),
    ),
    latestActors,
  };
}

export async function applyCanonicalCoworkerChange(input: {
  repository: CoworkerChangeRepository;
  coworkerId: string;
  actor: {
    userId: string;
    name: string | null;
    avatar: string | null;
    workspaceRole: string | null;
    isActiveWorkspaceMember: boolean;
  };
  origin: CoworkerChangeOrigin;
  expectedRevision: number;
  changes: CoworkerConfigurationPatch;
}): Promise<CoworkerChangeResult> {
  const current = await input.repository.getCoworker(input.coworkerId);
  if (!current) {
    return { kind: "not_found" };
  }

  const action =
    input.changes.visibility !== undefined && input.changes.visibility !== current.visibility
      ? "change_visibility"
      : input.origin === "restore"
        ? "restore_revision"
        : "edit";
  const access = decideCoworkerAccess({
    action,
    actorUserId: input.actor.userId,
    workspaceRole: input.actor.workspaceRole,
    isActiveWorkspaceMember: input.actor.isActiveWorkspaceMember,
    visibility: current.visibility,
    createdByUserId: current.createdByUserId,
  });
  if (!access.allowed) {
    return { kind: "forbidden", reason: access.reason };
  }

  const patchFields = Object.keys(input.changes);
  const interveningRevisions =
    input.expectedRevision < current.configurationRevision
      ? await input.repository.listRevisionsAfter(input.coworkerId, input.expectedRevision)
      : [];
  const conflicts = findCoworkerRevisionConflicts({
    patchFields,
    interveningRevisions,
  });
  if (conflicts.length > 0) {
    return buildConflict({ current, conflicts, revisions: interveningRevisions });
  }

  const nextConfiguration = mergeCoworkerConfigurationPatch(
    current.configuration,
    input.changes,
  );
  const changedFields = listChangedCoworkerFields(current.configuration, nextConfiguration);
  if (changedFields.length === 0) {
    return { kind: "unchanged", coworker: current };
  }

  const revision: CoworkerRevisionRecord = {
    coworkerId: current.id,
    revision: current.configurationRevision + 1,
    baseRevision: input.expectedRevision,
    actorUserId: input.actor.userId,
    actorNameSnapshot: input.actor.name,
    actorAvatarSnapshot: input.actor.avatar,
    origin: input.origin,
    changedFields,
    changes: buildChangeMap(current.configuration, nextConfiguration, changedFields),
    snapshot: nextConfiguration,
    createdAt: new Date(),
  };
  const committed = await input.repository.commit({
    coworkerId: current.id,
    expectedRevision: current.configurationRevision,
    configuration: nextConfiguration,
    revision,
  });
  if (!committed) {
    const latest = await input.repository.getCoworker(input.coworkerId);
    if (!latest) {
      return { kind: "not_found" };
    }
    const latestRevisions = await input.repository.listRevisionsAfter(
      input.coworkerId,
      input.expectedRevision,
    );
    const raceConflicts = findCoworkerRevisionConflicts({
      patchFields,
      interveningRevisions: latestRevisions,
    });
    return buildConflict({
      current: latest,
      conflicts: raceConflicts.length > 0 ? raceConflicts : patchFields,
      revisions: latestRevisions,
    });
  }

  return {
    kind: "applied",
    coworker: {
      ...current,
      visibility: nextConfiguration.visibility,
      configurationRevision: revision.revision,
      configuration: nextConfiguration,
    },
    revision,
  };
}
