/**
 * Database-backed resolution of which sandbox to act on.
 *
 * In attach mode `resolveAttachTarget` turns one of the attach selectors
 * (--sandbox-id, --conversation-id, --run-id, --builder-coworker-id) into a
 * fully-described `ExistingSandboxTarget` by walking the conversation runtime,
 * coworker run, and coworker builder tables. In create mode
 * `getCreateUserContext` and `resolveCreateWorkspace` load the integration
 * tokens and workspace the new sandbox is bootstrapped with. All `@bap/db`
 * access for the helper lives behind this small interface.
 */

import { db } from "@bap/db/client";
import * as schema from "@bap/db/schema";
import { and, eq } from "drizzle-orm";

import type { ParsedArgs } from "./cli-args";

type IntegrationType = "google_gmail" | "slack" | "notion" | "github" | "airtable";

export type SandboxSource =
  | "new"
  | "sandbox_id"
  | "conversation_id"
  | "run_id"
  | "builder_coworker_id";

export type ExistingSandboxTarget = {
  sandboxId: string;
  conversationId: string | null;
  sessionId: string | null;
  runtimeId: string | null;
  sandboxProvider: string | null;
  model: string | null;
  source: SandboxSource;
  sourceId: string;
  workspaceId?: string | null;
  workspaceSlug?: string | null;
  workspaceName?: string | null;
};

export type CreateWorkspaceTarget = {
  id: string;
  slug: string | null;
  name: string;
};

export type CreateUserContext = {
  id: string;
  integrationEnvs: Record<string, string>;
};

const ENV_VAR_MAP: Record<IntegrationType, string> = {
  google_gmail: "GMAIL_ACCESS_TOKEN",
  slack: "SLACK_ACCESS_TOKEN",
  notion: "NOTION_ACCESS_TOKEN",
  github: "GITHUB_ACCESS_TOKEN",
  airtable: "AIRTABLE_ACCESS_TOKEN",
};

export async function getCreateUserContext(userEmail: string): Promise<CreateUserContext> {
  const [foundUser] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, userEmail))
    .limit(1);

  if (!foundUser) {
    throw new Error(`User not found: ${userEmail}`);
  }

  const results = await db
    .select({
      type: schema.integration.type,
      accessToken: schema.integrationToken.accessToken,
    })
    .from(schema.integration)
    .innerJoin(
      schema.integrationToken,
      eq(schema.integration.id, schema.integrationToken.integrationId),
    )
    .where(and(eq(schema.integration.userId, foundUser.id), eq(schema.integration.enabled, true)));

  const envVars: Record<string, string> = {};
  for (const row of results) {
    const envVar = ENV_VAR_MAP[row.type as IntegrationType];
    if (envVar) {
      envVars[envVar] = row.accessToken;
    }
  }

  return {
    id: foundUser.id,
    integrationEnvs: envVars,
  };
}

export async function resolveCreateWorkspace(workspaceSlug: string): Promise<CreateWorkspaceTarget> {
  const normalizedWorkspaceSlug = workspaceSlug.trim();

  if (!normalizedWorkspaceSlug) {
    throw new Error(
      "Workspace slug is required for create mode. Pass --workspace-slug <slug> or set DEFAULT_CREATE_WORKSPACE_SLUG in scripts/daytona-sandbox/cli-args.ts.",
    );
  }

  const workspace = await db.query.workspace.findFirst({
    where: eq(schema.workspace.slug, normalizedWorkspaceSlug),
    columns: {
      id: true,
      slug: true,
      name: true,
    },
  });

  if (!workspace) {
    throw new Error(`Workspace not found for slug: ${normalizedWorkspaceSlug}`);
  }

  if (!workspace.slug) {
    throw new Error(`Workspace ${workspace.id} (${workspace.name}) does not have a slug.`);
  }

  return workspace;
}

async function getRuntimeTargetByConversationId(
  conversationId: string,
): Promise<ExistingSandboxTarget | null> {
  const runtime = await db.query.conversationRuntime.findFirst({
    where: eq(schema.conversationRuntime.conversationId, conversationId),
    columns: {
      id: true,
      sandboxId: true,
      sessionId: true,
      sandboxProvider: true,
    },
  });

  if (!runtime?.sandboxId) {
    return null;
  }

  const convo = await db.query.conversation.findFirst({
    where: eq(schema.conversation.id, conversationId),
    columns: {
      model: true,
    },
  });

  return {
    sandboxId: runtime.sandboxId,
    conversationId,
    sessionId: runtime.sessionId,
    runtimeId: runtime.id,
    sandboxProvider: runtime.sandboxProvider,
    model: convo?.model ?? null,
    source: "conversation_id",
    sourceId: conversationId,
  };
}

async function getRuntimeTargetBySandboxId(
  sandboxId: string,
): Promise<ExistingSandboxTarget | null> {
  const runtime = await db.query.conversationRuntime.findFirst({
    where: eq(schema.conversationRuntime.sandboxId, sandboxId),
    columns: {
      id: true,
      conversationId: true,
      sandboxId: true,
      sessionId: true,
      sandboxProvider: true,
    },
  });

  if (!runtime?.sandboxId) {
    return null;
  }

  const convo = await db.query.conversation.findFirst({
    where: eq(schema.conversation.id, runtime.conversationId),
    columns: {
      model: true,
    },
  });

  return {
    sandboxId: runtime.sandboxId,
    conversationId: runtime.conversationId,
    sessionId: runtime.sessionId,
    runtimeId: runtime.id,
    sandboxProvider: runtime.sandboxProvider,
    model: convo?.model ?? null,
    source: "sandbox_id",
    sourceId: sandboxId,
  };
}

export async function resolveAttachTarget(args: ParsedArgs): Promise<ExistingSandboxTarget> {
  if (args.sandboxId) {
    if (!process.env.DATABASE_URL) {
      return {
        sandboxId: args.sandboxId,
        conversationId: null,
        sessionId: null,
        runtimeId: null,
        sandboxProvider: "daytona",
        model: null,
        source: "sandbox_id",
        sourceId: args.sandboxId,
      };
    }

    return (
      (await getRuntimeTargetBySandboxId(args.sandboxId)) ?? {
        sandboxId: args.sandboxId,
        conversationId: null,
        sessionId: null,
        runtimeId: null,
        sandboxProvider: "daytona",
        model: null,
        source: "sandbox_id",
        sourceId: args.sandboxId,
      }
    );
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL environment variable required when resolving sandbox by conversation, run, or builder.",
    );
  }

  if (args.conversationId) {
    const target = await getRuntimeTargetByConversationId(args.conversationId);
    if (!target) {
      throw new Error(`No active sandbox runtime found for conversation ${args.conversationId}.`);
    }
    return target;
  }

  if (args.runId) {
    const run = await db.query.coworkerRun.findFirst({
      where: eq(schema.coworkerRun.id, args.runId),
      columns: {
        generationId: true,
      },
    });

    if (!run?.generationId) {
      throw new Error(`Coworker run ${args.runId} does not have a generation to attach to.`);
    }

    const generation = await db.query.generation.findFirst({
      where: eq(schema.generation.id, run.generationId),
      columns: {
        conversationId: true,
      },
    });

    if (!generation?.conversationId) {
      throw new Error(`Coworker run ${args.runId} has no linked conversation.`);
    }

    const target = await getRuntimeTargetByConversationId(generation.conversationId);
    if (!target) {
      throw new Error(`No active sandbox runtime found for coworker run ${args.runId}.`);
    }

    return {
      ...target,
      source: "run_id",
      sourceId: args.runId,
    };
  }

  if (args.builderCoworkerId) {
    const coworker = await db.query.coworker.findFirst({
      where: eq(schema.coworker.id, args.builderCoworkerId),
      columns: {
        builderConversationId: true,
      },
    });

    if (!coworker?.builderConversationId) {
      throw new Error(
        `Coworker ${args.builderCoworkerId} does not have a builder conversation to attach to.`,
      );
    }

    const target = await getRuntimeTargetByConversationId(coworker.builderConversationId);
    if (!target) {
      throw new Error(
        `No active sandbox runtime found for builder coworker ${args.builderCoworkerId}.`,
      );
    }

    return {
      ...target,
      source: "builder_coworker_id",
      sourceId: args.builderCoworkerId,
    };
  }

  throw new Error("No attach target provided.");
}

export function assertDaytonaTarget(target: ExistingSandboxTarget): void {
  if (target.sandboxProvider && target.sandboxProvider !== "daytona") {
    throw new Error(
      `Sandbox ${target.sandboxId} is using provider "${target.sandboxProvider}", not "daytona".`,
    );
  }
}
