import { describe, expect, it } from "vitest";
import {
  applyCanonicalCoworkerChange,
  type CanonicalCoworkerRecord,
  type CoworkerChangeRepository,
  type CoworkerRevisionRecord,
} from "./coworker-change-service";

function baseCoworker(overrides: Partial<CanonicalCoworkerRecord> = {}): CanonicalCoworkerRecord {
  return {
    id: "coworker-1",
    visibility: "workspace",
    createdByUserId: "creator-1",
    configurationRevision: 1,
    configuration: {
      name: "Research",
      description: "Find useful sources",
      username: "research",
      status: "on",
      triggerType: "manual",
      prompt: "Find sources",
      model: "anthropic/claude-sonnet-4-6",
      authSource: null,
      requiresUserInput: false,
      userInputPrompt: null,
      autoApprove: true,
      toolAccessMode: "all",
      allowedIntegrations: [],
      allowedCustomIntegrations: [],
      allowedWorkspaceMcpServerIds: [],
      allowedSkillSlugs: [],
      schedule: null,
      visibility: "workspace",
    },
    ...overrides,
  };
}

function createRepository(input: {
  coworker?: CanonicalCoworkerRecord;
  revisions?: CoworkerRevisionRecord[];
  commitSucceeds?: boolean;
}) {
  let current = input.coworker ?? baseCoworker();
  const revisions = [...(input.revisions ?? [])];
  const commits: Parameters<CoworkerChangeRepository["commit"]>[0][] = [];

  const repository: CoworkerChangeRepository = {
    async getCoworker(coworkerId) {
      return current.id === coworkerId ? current : null;
    },
    async listRevisionsAfter(coworkerId, revision) {
      return revisions.filter(
        (entry) => entry.coworkerId === coworkerId && entry.revision > revision,
      );
    },
    async commit(commit) {
      commits.push(commit);
      if (
        input.commitSucceeds === false ||
        current.configurationRevision !== commit.expectedRevision
      ) {
        return false;
      }
      current = {
        ...current,
        configurationRevision: commit.revision.revision,
        configuration: commit.configuration,
        visibility: commit.configuration.visibility,
      };
      revisions.push(commit.revision);
      return true;
    },
  };

  return {
    repository,
    commits,
    current: () => current,
  };
}

const memberActor = {
  userId: "member-1",
  name: "Member One",
  avatar: null,
  workspaceRole: "member",
  isActiveWorkspaceMember: true,
};

describe("coworker change service", () => {
  it("applies an attributed member edit to a workspace coworker", async () => {
    const { repository, commits, current } = createRepository({});

    const result = await applyCanonicalCoworkerChange({
      repository,
      coworkerId: "coworker-1",
      actor: memberActor,
      origin: "direct",
      expectedRevision: 1,
      changes: { prompt: "Find primary sources" },
    });

    expect(result.kind).toBe("applied");
    expect(current().configuration.prompt).toBe("Find primary sources");
    expect(commits[0]?.revision).toMatchObject({
      revision: 2,
      baseRevision: 1,
      actorUserId: "member-1",
      actorNameSnapshot: "Member One",
      origin: "direct",
      changedFields: ["prompt"],
    });
  });

  it("denies a non-creator edit to a private coworker", async () => {
    const { repository, commits } = createRepository({
      coworker: baseCoworker({ visibility: "private" }),
    });

    const result = await applyCanonicalCoworkerChange({
      repository,
      coworkerId: "coworker-1",
      actor: memberActor,
      origin: "direct",
      expectedRevision: 1,
      changes: { prompt: "Not allowed" },
    });

    expect(result).toEqual({ kind: "forbidden", reason: "private_coworker" });
    expect(commits).toHaveLength(0);
  });

  it("merges a stale edit when intervening revisions touched different fields", async () => {
    const coworker = baseCoworker({
      configurationRevision: 2,
      configuration: {
        ...baseCoworker().configuration,
        model: "openai/gpt-5.4",
      },
    });
    const { repository, current } = createRepository({
      coworker,
      revisions: [
        {
          coworkerId: coworker.id,
          revision: 2,
          baseRevision: 1,
          actorUserId: "member-2",
          actorNameSnapshot: "Member Two",
          actorAvatarSnapshot: null,
          origin: "direct",
          changedFields: ["model"],
          changes: {
            model: {
              before: "anthropic/claude-sonnet-4-6",
              after: "openai/gpt-5.4",
            },
          },
          snapshot: coworker.configuration,
          createdAt: new Date(),
        },
      ],
    });

    const result = await applyCanonicalCoworkerChange({
      repository,
      coworkerId: coworker.id,
      actor: memberActor,
      origin: "builder_chat",
      expectedRevision: 1,
      changes: { description: "Updated independently" },
    });

    expect(result.kind).toBe("applied");
    expect(current().configuration).toMatchObject({
      model: "openai/gpt-5.4",
      description: "Updated independently",
    });
  });

  it("returns a same-field conflict with the current value and latest actor", async () => {
    const coworker = baseCoworker({
      configurationRevision: 2,
      configuration: {
        ...baseCoworker().configuration,
        prompt: "Latest prompt",
      },
    });
    const { repository, commits } = createRepository({
      coworker,
      revisions: [
        {
          coworkerId: coworker.id,
          revision: 2,
          baseRevision: 1,
          actorUserId: "member-2",
          actorNameSnapshot: "Member Two",
          actorAvatarSnapshot: "avatar.png",
          origin: "direct",
          changedFields: ["prompt"],
          changes: { prompt: { before: "Find sources", after: "Latest prompt" } },
          snapshot: coworker.configuration,
          createdAt: new Date(),
        },
      ],
    });

    const result = await applyCanonicalCoworkerChange({
      repository,
      coworkerId: coworker.id,
      actor: memberActor,
      origin: "direct",
      expectedRevision: 1,
      changes: { prompt: "My stale prompt" },
    });

    expect(result).toEqual({
      kind: "conflict",
      currentRevision: 2,
      conflictingFields: ["prompt"],
      currentValues: { prompt: "Latest prompt" },
      latestActors: {
        prompt: {
          userId: "member-2",
          name: "Member Two",
          avatar: "avatar.png",
        },
      },
    });
    expect(commits).toHaveLength(0);
  });

  it("requires creator or admin authority for visibility changes", async () => {
    const { repository } = createRepository({});

    const result = await applyCanonicalCoworkerChange({
      repository,
      coworkerId: "coworker-1",
      actor: memberActor,
      origin: "direct",
      expectedRevision: 1,
      changes: { visibility: "private" },
    });

    expect(result).toEqual({
      kind: "forbidden",
      reason: "creator_or_workspace_admin_required",
    });
  });

  it("returns unchanged without creating a revision for an identical patch", async () => {
    const { repository, commits } = createRepository({});

    const result = await applyCanonicalCoworkerChange({
      repository,
      coworkerId: "coworker-1",
      actor: memberActor,
      origin: "direct",
      expectedRevision: 1,
      changes: { prompt: "Find sources" },
    });

    expect(result).toEqual({
      kind: "unchanged",
      coworker: baseCoworker(),
    });
    expect(commits).toHaveLength(0);
  });
});
