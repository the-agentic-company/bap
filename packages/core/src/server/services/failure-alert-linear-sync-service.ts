import { db } from "@cmdclaw/db/client";
import {
  failureAlertGroup,
  failureAlertOccurrence,
} from "@cmdclaw/db/schema";
import { desc, eq } from "drizzle-orm";
import { env } from "../../env";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const DEFAULT_LINEAR_LABELS = ["slo", "reliability", "auto-created"];
const COMMENT_MILESTONES = new Set([2, 3, 5, 10, 25, 50, 100]);
const MAX_RECENT_OCCURRENCES = 20;

type FailureAlertSyncFetch = typeof fetch;

type LinearConfig = {
  apiKey: string;
  teamKey?: string;
  projectId?: string;
  projectName?: string;
  assigneeId?: string;
  assigneeEmail?: string;
  labels: string[];
};

type LinearIssue = {
  id: string;
  identifier: string;
  url: string;
};

type LinearGraphQlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

export async function syncFailureAlertGroupToLinear(
  input: { groupId: string },
  options: { fetchImpl?: FailureAlertSyncFetch } = {},
): Promise<{ action: "skipped" | "created" | "updated"; issueIdentifier?: string }> {
  const config = getLinearConfig();
  if (!config) {
    console.warn("[failure-alert] Linear sync skipped because LINEAR_API_KEY is not configured");
    return { action: "skipped" };
  }

  const group = await loadFailureAlertGroup(input.groupId);
  if (!group) {
    return { action: "skipped" };
  }

  const occurrences = await loadRecentOccurrences(input.groupId);
  const linear = new LinearClient(config.apiKey, options.fetchImpl ?? fetch);
  const teamId = await linear.resolveTeamId(config);
  if (!teamId) {
    console.warn("[failure-alert] Linear sync skipped because no Linear team could be resolved");
    return { action: "skipped" };
  }

  const labelIds = await linear.resolveLabelIds(
    teamId,
    Array.from(new Set([group.environment, ...config.labels])),
  );
  const projectId = await linear.resolveProjectId(teamId, config);
  const assigneeId = await linear.resolveAssigneeId(config);
  const description = buildLinearIssueDescription(group, occurrences);

  if (!group.linearIssueId) {
    const shouldCommentOnCreate = shouldCommentForOccurrenceCount(
      group.occurrenceCount,
      group.lastCommentedOccurrenceCount,
    );
    const issue = await linear.createIssue({
      teamId,
      title: group.title,
      description,
      labelIds,
      projectId,
      assigneeId,
    });
    if (shouldCommentOnCreate) {
      await linear.createComment(issue.id, buildLinearMilestoneComment(group, occurrences));
    }
    await db
      .update(failureAlertGroup)
      .set({
        linearIssueId: issue.id,
        linearIssueIdentifier: issue.identifier,
        linearIssueUrl: issue.url,
        linearLastSyncedAt: new Date(),
        lastCommentedOccurrenceCount: shouldCommentOnCreate
          ? group.occurrenceCount
          : group.lastCommentedOccurrenceCount,
        updatedAt: new Date(),
      })
      .where(eq(failureAlertGroup.id, group.id));
    return { action: "created", issueIdentifier: issue.identifier };
  }

  const shouldComment = shouldCommentForOccurrenceCount(
    group.occurrenceCount,
    group.lastCommentedOccurrenceCount,
  );
  await linear.updateIssue(group.linearIssueId, {
    title: group.title,
    description,
    labelIds,
    projectId,
    assigneeId,
  });
  if (shouldComment) {
    await linear.createComment(
      group.linearIssueId,
      buildLinearMilestoneComment(group, occurrences),
    );
  }
  await db
    .update(failureAlertGroup)
    .set({
      linearLastSyncedAt: new Date(),
      lastCommentedOccurrenceCount: shouldComment
        ? group.occurrenceCount
        : group.lastCommentedOccurrenceCount,
      updatedAt: new Date(),
    })
    .where(eq(failureAlertGroup.id, group.id));

  return {
    action: "updated",
    issueIdentifier: group.linearIssueIdentifier ?? undefined,
  };
}

async function loadFailureAlertGroup(groupId: string) {
  const [group] = await db
    .select()
    .from(failureAlertGroup)
    .where(eq(failureAlertGroup.id, groupId))
    .limit(1);
  return group ?? null;
}

async function loadRecentOccurrences(groupId: string) {
  return await db
    .select()
    .from(failureAlertOccurrence)
    .where(eq(failureAlertOccurrence.groupId, groupId))
    .orderBy(desc(failureAlertOccurrence.failedAt))
    .limit(MAX_RECENT_OCCURRENCES);
}

function resolveFailureAlertEnvironment(): string {
  return (
    process.env.LINEAR_FAILURE_ALERT_ENV?.trim() ||
    process.env.APP_ALERT_ENV?.trim() ||
    process.env.APP_ALERT_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "development"
  );
}

function getLinearConfig(): LinearConfig | null {
  const apiKey = env.LINEAR_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const environment = resolveFailureAlertEnvironment();
  const configuredLabels = (env.LINEAR_FAILURE_ALERT_LABELS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  const labels = Array.from(new Set([...DEFAULT_LINEAR_LABELS, ...configuredLabels, environment]));

  return {
    apiKey,
    teamKey: env.LINEAR_TEAM_KEY?.trim(),
    projectId: env.LINEAR_PROJECT_ID?.trim(),
    projectName: env.LINEAR_PROJECT_NAME?.trim(),
    assigneeId: env.LINEAR_ASSIGNEE_ID?.trim(),
    assigneeEmail: env.LINEAR_ASSIGNEE_EMAIL?.trim(),
    labels,
  };
}

function shouldCommentForOccurrenceCount(count: number, lastCommentedCount: number): boolean {
  if (count <= lastCommentedCount) {
    return false;
  }
  return COMMENT_MILESTONES.has(count) || (count > 100 && count % 100 === 0);
}

function buildLinearIssueDescription(
  group: Awaited<ReturnType<typeof loadFailureAlertGroup>>,
  occurrences: Awaited<ReturnType<typeof loadRecentOccurrences>>,
): string {
  if (!group) {
    return "";
  }
  const lines = [
    "## Failure cluster",
    "",
    `**Environment:** ${group.environment}`,
    `**Kind:** ${group.kind}`,
    `**Journey:** ${group.journey}`,
    `**Occurrences:** ${group.occurrenceCount}`,
    `**First seen:** ${group.firstSeenAt.toISOString()}`,
    `**Last seen:** ${group.lastSeenAt.toISOString()}`,
    `**Completion reason:** ${group.completionReason ?? "unknown"}`,
    `**Model:** ${group.model ?? "unknown"}`,
    `**Runtime:** ${group.runtimeHarness ?? "unknown"}`,
    `**Sandbox:** ${group.sandboxProvider ?? "unknown"}`,
    "",
    "## Normalized error",
    "",
    group.normalizedError,
    "",
    "## Recent failing cases",
    "",
    "| Failed at | Conversation | Generation | User | Trace |",
    "| --- | --- | --- | --- | --- |",
    ...occurrences
      .map((occurrence) =>
        [
          occurrence.failedAt.toISOString(),
          buildConversationLink(occurrence.conversationId),
          occurrence.generationId,
          occurrence.userEmail ?? occurrence.userId ?? "unknown",
          occurrence.traceId ?? "unknown",
        ]
          .map(escapeMarkdownTableCell)
          .join(" | "),
      )
      .map((row) => `| ${row} |`),
  ];

  return lines.join("\n");
}

function buildLinearMilestoneComment(
  group: Awaited<ReturnType<typeof loadFailureAlertGroup>>,
  occurrences: Awaited<ReturnType<typeof loadRecentOccurrences>>,
): string {
  const latest = occurrences[0];
  return [
    `This failure cluster has reached ${group?.occurrenceCount ?? 0} matching occurrence(s).`,
    "",
    latest
      ? `Latest case: ${buildConversationLink(latest.conversationId)} generation \`${latest.generationId}\` for ${latest.userEmail ?? latest.userId ?? "unknown"} at ${latest.failedAt.toISOString()}.`
      : "No recent occurrence details were available.",
  ].join("\n");
}

function buildConversationLink(conversationId: string): string {
  const baseUrl = env.APP_URL ?? env.VITE_APP_URL;
  if (!baseUrl) {
    return conversationId;
  }
  return `${baseUrl.replace(/\/$/, "")}/chat/${conversationId}`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

class LinearClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FailureAlertSyncFetch,
  ) {}

  async resolveTeamId(config: LinearConfig): Promise<string | undefined> {
    if (!config.teamKey) {
      return undefined;
    }
    const result = await this.graphql<{
      teams: { nodes: Array<{ id: string; key: string; name: string }> };
    }>(
      `query Teams {
        teams(first: 100) {
          nodes { id key name }
        }
      }`,
      {},
    );
    return result.teams.nodes.find(
      (team) => team.key === config.teamKey || team.name === config.teamKey,
    )?.id;
  }

  async resolveProjectId(teamId: string, config: LinearConfig): Promise<string | undefined> {
    if (config.projectId) {
      return config.projectId;
    }
    if (!config.projectName) {
      return undefined;
    }
    const result = await this.graphql<{
      team: { projects: { nodes: Array<{ id: string; name: string }> } } | null;
    }>(
      `query TeamProjects($teamId: String!) {
        team(id: $teamId) {
          projects(first: 100) { nodes { id name } }
        }
      }`,
      { teamId },
    );
    return result.team?.projects.nodes.find((project) => project.name === config.projectName)?.id;
  }

  async resolveAssigneeId(config: LinearConfig): Promise<string | undefined> {
    if (config.assigneeId) {
      return config.assigneeId;
    }
    if (!config.assigneeEmail) {
      return undefined;
    }
    const result = await this.graphql<{
      users: { nodes: Array<{ id: string; email: string }> };
    }>(
      `query Users {
        users(first: 100) { nodes { id email } }
      }`,
      {},
    );
    return result.users.nodes.find((linearUser) => linearUser.email === config.assigneeEmail)?.id;
  }

  async resolveLabelIds(teamId: string, labels: string[]): Promise<string[]> {
    const result = await this.graphql<{
      team: { labels: { nodes: Array<{ id: string; name: string }> } } | null;
    }>(
      `query TeamLabels($teamId: String!) {
        team(id: $teamId) {
          labels(first: 100) { nodes { id name } }
        }
      }`,
      { teamId },
    );
    const existingLabels = new Map(
      (result.team?.labels.nodes ?? []).map((label) => [label.name.toLowerCase(), label.id]),
    );
    const labelIds: string[] = [];
    for (const label of labels) {
      const existing = existingLabels.get(label.toLowerCase());
      if (existing) {
        labelIds.push(existing);
        continue;
      }
      const created = await this.createIssueLabel(teamId, label);
      labelIds.push(created.id);
      existingLabels.set(label.toLowerCase(), created.id);
    }
    return labelIds;
  }

  async createIssue(input: {
    teamId: string;
    title: string;
    description: string;
    labelIds: string[];
    projectId?: string;
    assigneeId?: string;
  }): Promise<LinearIssue> {
    const issueInput = compactObject({
      teamId: input.teamId,
      title: input.title,
      description: input.description,
      labelIds: input.labelIds,
      projectId: input.projectId,
      assigneeId: input.assigneeId,
    });
    const result = await this.graphql<{
      issueCreate: { success: boolean; issue: LinearIssue };
    }>(
      `mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url }
        }
      }`,
      { input: issueInput },
    );
    if (!result.issueCreate.success) {
      throw new Error("Linear issueCreate returned success=false");
    }
    return result.issueCreate.issue;
  }

  async updateIssue(
    issueId: string,
    input: {
      title: string;
      description: string;
      labelIds: string[];
      projectId?: string;
      assigneeId?: string;
    },
  ): Promise<void> {
    const issueInput = compactObject({
      title: input.title,
      description: input.description,
      labelIds: input.labelIds,
      projectId: input.projectId,
      assigneeId: input.assigneeId,
    });
    const result = await this.graphql<{
      issueUpdate: { success: boolean };
    }>(
      `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id: issueId, input: issueInput },
    );
    if (!result.issueUpdate.success) {
      throw new Error("Linear issueUpdate returned success=false");
    }
  }

  async createComment(issueId: string, body: string): Promise<void> {
    const result = await this.graphql<{
      commentCreate: { success: boolean };
    }>(
      `mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) { success }
      }`,
      { input: { issueId, body } },
    );
    if (!result.commentCreate.success) {
      throw new Error("Linear commentCreate returned success=false");
    }
  }

  private async createIssueLabel(teamId: string, name: string): Promise<{ id: string }> {
    const result = await this.graphql<{
      issueLabelCreate: { success: boolean; issueLabel: { id: string } };
    }>(
      `mutation IssueLabelCreate($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) {
          success
          issueLabel { id }
        }
      }`,
      { input: { teamId, name } },
    );
    if (!result.issueLabelCreate.success) {
      throw new Error(`Linear issueLabelCreate returned success=false for ${name}`);
    }
    return result.issueLabelCreate.issueLabel;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        authorization: this.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Linear GraphQL request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as LinearGraphQlResponse<T>;
    if (payload.errors?.length) {
      throw new Error(
        `Linear GraphQL error: ${payload.errors.map((error) => error.message ?? "unknown").join("; ")}`,
      );
    }
    if (!payload.data) {
      throw new Error("Linear GraphQL response did not include data");
    }
    return payload.data;
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null),
  ) as T;
}
