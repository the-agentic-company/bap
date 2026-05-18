import { createHash } from "node:crypto";
import { db } from "@cmdclaw/db/client";
import {
  conversation,
  coworkerRun,
  failureAlertGroup,
  failureAlertOccurrence,
  generation,
  user,
  type FailureAlertKind,
} from "@cmdclaw/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { env } from "../../env";
import { buildQueueJobId, FAILURE_ALERT_LINEAR_SYNC_JOB_NAME, getQueue } from "../queues";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const DEFAULT_LINEAR_LABELS = ["slo", "reliability", "auto-created"];
const COMMENT_MILESTONES = new Set([2, 3, 5, 10, 25, 50, 100]);
const MAX_RECENT_OCCURRENCES = 20;

type FailureAlertSyncFetch = typeof fetch;

type FailureAlertSource = {
  generationId: string;
  conversationId: string;
  conversationTitle: string | null;
  conversationType: FailureAlertKind;
  userId: string | null;
  userEmail: string | null;
  errorMessage: string | null;
  completionReason: string | null;
  debugInfo: Record<string, unknown> | null;
  model: string | null;
  runtimeHarness: string | null;
  sandboxProvider: string | null;
  startedAt: Date;
  failedAt: Date;
  coworkerRunId: string | null;
};

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

export type CaptureGenerationFailureAlertResult = {
  groupId: string;
  occurrenceId: string;
  createdGroup: boolean;
};

export function normalizeFailureAlertError(message: string): string {
  return message
    .replaceAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<timestamp>")
    .replaceAll(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "<uuid>",
    )
    .replaceAll(
      /\b(gen|conv|msg|run|sess|session|thread|trace|span|req|request|sandbox|runtime)[-_][A-Za-z0-9_-]{6,}\b/g,
      "$1-<id>",
    )
    .replaceAll(/\b[A-Za-z0-9_-]{20,}\b/g, "<id>")
    .replaceAll(/\/tmp\/[^\s:)"']+/g, "/tmp/<path>")
    .replaceAll(/\/var\/folders\/[^\s:)"']+/g, "/var/folders/<path>")
    .replaceAll(/:\d{2,5}\b/g, ":<port>")
    .replaceAll(/\b\d{10,}\b/g, "<number>")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

export function buildFailureAlertSignature(input: {
  environment: string;
  kind: FailureAlertKind;
  journey: string;
  completionReason: string | null;
  normalizedError: string;
  model: string | null;
  runtimeHarness: string | null;
  sandboxProvider: string | null;
}): { signature: string; signatureHash: string } {
  const parts = [
    input.environment,
    input.kind,
    input.journey,
    input.completionReason ?? "unknown_reason",
    input.normalizedError,
    input.model ?? "unknown_model",
    input.runtimeHarness ?? "unknown_runtime",
    input.sandboxProvider ?? "unknown_sandbox",
  ];
  const signature = parts.join("\n");
  return {
    signature,
    signatureHash: createHash("sha256").update(signature).digest("hex"),
  };
}

export async function captureGenerationFailureAlert(input: {
  generationId: string;
}): Promise<CaptureGenerationFailureAlertResult | null> {
  const source = await loadFailureAlertSource(input.generationId);
  if (!source) {
    return null;
  }

  const environment = resolveFailureAlertEnvironment();
  const rawError = source.errorMessage?.trim() || "Unknown generation failure";
  const normalizedError = normalizeFailureAlertError(rawError);
  const journey = source.conversationType;
  const { signatureHash } = buildFailureAlertSignature({
    environment,
    kind: source.conversationType,
    journey,
    completionReason: source.completionReason,
    normalizedError,
    model: source.model,
    runtimeHarness: source.runtimeHarness,
    sandboxProvider: source.sandboxProvider,
  });
  const title = buildFailureAlertTitle(source.conversationType, normalizedError);

  const result = await db.transaction(async (tx) => {
    const [existingGroup] = await tx
      .select({ id: failureAlertGroup.id, occurrenceCount: failureAlertGroup.occurrenceCount })
      .from(failureAlertGroup)
      .where(eq(failureAlertGroup.signatureHash, signatureHash))
      .limit(1);

    const [group] = await tx
      .insert(failureAlertGroup)
      .values({
        signatureHash,
        environment,
        kind: source.conversationType,
        journey,
        completionReason: source.completionReason,
        normalizedError,
        title,
        model: source.model,
        runtimeHarness: source.runtimeHarness,
        sandboxProvider: source.sandboxProvider,
        firstSeenAt: source.failedAt,
        lastSeenAt: source.failedAt,
      })
      .onConflictDoUpdate({
        target: failureAlertGroup.signatureHash,
        set: {
          title,
          lastSeenAt: source.failedAt,
          updatedAt: new Date(),
        },
      })
      .returning({ id: failureAlertGroup.id });

    const [occurrence] = await tx
      .insert(failureAlertOccurrence)
      .values({
        groupId: group.id,
        generationId: source.generationId,
        conversationId: source.conversationId,
        coworkerRunId: source.coworkerRunId,
        userId: source.userId,
        userEmail: source.userEmail,
        rawError,
        normalizedError,
        completionReason: source.completionReason,
        traceId: extractTraceId(source.debugInfo),
        model: source.model,
        runtimeHarness: source.runtimeHarness,
        sandboxProvider: source.sandboxProvider,
        startedAt: source.startedAt,
        failedAt: source.failedAt,
      })
      .onConflictDoNothing({ target: failureAlertOccurrence.generationId })
      .returning({ id: failureAlertOccurrence.id });

    if (!occurrence) {
      const [existingOccurrence] = await tx
        .select({ id: failureAlertOccurrence.id })
        .from(failureAlertOccurrence)
        .where(eq(failureAlertOccurrence.generationId, source.generationId))
        .limit(1);

      return existingOccurrence
        ? {
            groupId: group.id,
            occurrenceId: existingOccurrence.id,
            createdGroup: !existingGroup,
            insertedOccurrence: false,
          }
        : null;
    }

    await tx
      .update(failureAlertGroup)
      .set({
        occurrenceCount: sql`${failureAlertGroup.occurrenceCount} + 1`,
        lastSeenAt: source.failedAt,
        updatedAt: new Date(),
      })
      .where(eq(failureAlertGroup.id, group.id));

    return {
      groupId: group.id,
      occurrenceId: occurrence.id,
      createdGroup: !existingGroup,
      insertedOccurrence: true,
    };
  });

  if (!result) {
    return null;
  }

  await enqueueFailureAlertLinearSync(result.groupId, result.occurrenceId);

  return {
    groupId: result.groupId,
    occurrenceId: result.occurrenceId,
    createdGroup: result.createdGroup,
  };
}

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

async function loadFailureAlertSource(generationId: string): Promise<FailureAlertSource | null> {
  const [row] = await db
    .select({
      generationId: generation.id,
      generationStatus: generation.status,
      conversationId: generation.conversationId,
      conversationTitle: conversation.title,
      conversationType: conversation.type,
      userId: conversation.userId,
      userEmail: user.email,
      errorMessage: generation.errorMessage,
      completionReason: generation.completionReason,
      debugInfo: generation.debugInfo,
      model: conversation.model,
      runtimeHarness: generation.runtimeHarness,
      conversationRuntimeHarness: conversation.lastRuntimeHarness,
      sandboxProvider: generation.sandboxProvider,
      conversationSandboxProvider: conversation.lastSandboxProvider,
      startedAt: generation.startedAt,
      completedAt: generation.completedAt,
      coworkerRunId: coworkerRun.id,
    })
    .from(generation)
    .innerJoin(conversation, eq(conversation.id, generation.conversationId))
    .leftJoin(user, eq(user.id, conversation.userId))
    .leftJoin(coworkerRun, eq(coworkerRun.generationId, generation.id))
    .where(eq(generation.id, generationId))
    .limit(1);

  if (!row || row.generationStatus !== "error") {
    return null;
  }

  if (row.conversationType !== "chat" && row.conversationType !== "coworker") {
    return null;
  }

  return {
    generationId: row.generationId,
    conversationId: row.conversationId,
    conversationTitle: row.conversationTitle,
    conversationType: row.conversationType,
    userId: row.userId,
    userEmail: row.userEmail,
    errorMessage: row.errorMessage,
    completionReason: row.completionReason,
    debugInfo: (row.debugInfo ?? null) as Record<string, unknown> | null,
    model: row.model,
    runtimeHarness: row.runtimeHarness ?? row.conversationRuntimeHarness,
    sandboxProvider: row.sandboxProvider ?? row.conversationSandboxProvider,
    startedAt: row.startedAt,
    failedAt: row.completedAt ?? new Date(),
    coworkerRunId: row.coworkerRunId,
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

async function enqueueFailureAlertLinearSync(groupId: string, occurrenceId: string): Promise<void> {
  await getQueue().add(
    FAILURE_ALERT_LINEAR_SYNC_JOB_NAME,
    { groupId },
    {
      jobId: buildQueueJobId([FAILURE_ALERT_LINEAR_SYNC_JOB_NAME, groupId, occurrenceId]),
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  );
}

function resolveFailureAlertEnvironment(): string {
  return (
    process.env.LINEAR_FAILURE_ALERT_ENV?.trim() ||
    process.env.CMDCLAW_ALERT_ENV?.trim() ||
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

function buildFailureAlertTitle(kind: FailureAlertKind, normalizedError: string): string {
  const prefix = kind === "coworker" ? "Coworker failure" : "Chat failure";
  const suffix =
    normalizedError.length > 90 ? `${normalizedError.slice(0, 87)}...` : normalizedError;
  return `${prefix}: ${suffix}`;
}

function extractTraceId(debugInfo: Record<string, unknown> | null): string | null {
  if (!debugInfo) {
    return null;
  }
  const direct = debugInfo.traceId ?? debugInfo.trace_id;
  return typeof direct === "string" && direct.length > 0 ? direct : null;
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
  const baseUrl = env.APP_URL ?? env.NEXT_PUBLIC_APP_URL;
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
