import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import { coworker } from "@bap/db/schema";
import {
  type AgenticAuditCoworkerDefinition,
  getAgenticAuditCoworkerDefinitions,
} from "@bap/prompts";
import { and, eq } from "drizzle-orm";
import { createCoworkerProfile } from "@/server/services/coworker-profile";

export type AgenticAuditAgentKey = AgenticAuditCoworkerDefinition["key"];

type EnsureContext = {
  user: { id: string };
  db: typeof import("@bap/db/client").db;
};

export type AgenticAuditCoworker = {
  key: AgenticAuditAgentKey;
  id: string;
  name: string;
  username: string;
};

async function ensureCoworker(input: {
  context: EnsureContext;
  workspaceId: string;
  existing: Array<{ id: string; name: string | null; username: string | null }>;
  definition: AgenticAuditCoworkerDefinition;
}): Promise<AgenticAuditCoworker> {
  const match = input.existing.find((row) => row.name === input.definition.name);
  if (match?.username) {
    await input.context.db
      .update(coworker)
      .set({
        prompt: input.definition.prompt,
        description: input.definition.description,
        username: input.definition.username,
      })
      .where(and(eq(coworker.id, match.id), eq(coworker.ownerId, input.context.user.id)));
    return {
      key: input.definition.key,
      id: match.id,
      name: input.definition.name,
      username: input.definition.username,
    };
  }

  const created = await createCoworkerProfile({
    context: input.context,
    workspaceId: input.workspaceId,
    payload: {
      name: input.definition.name,
      description: input.definition.description,
      username: input.definition.username,
      triggerType: "manual",
      prompt: input.definition.prompt,
      model: DEFAULT_CONNECTED_CHATGPT_MODEL,
      autoApprove: true,
      toolAccessMode: "all",
      allowedIntegrations: [],
      allowedCustomIntegrations: [],
      allowedWorkspaceMcpServerIds: [],
      allowedSkillSlugs: [],
    },
  });

  return {
    key: input.definition.key,
    id: created.id,
    name: input.definition.name,
    username: created.username ?? input.definition.username,
  };
}

export async function ensureAgenticAuditCoworkers(input: {
  context: EnsureContext;
  workspaceId: string;
}): Promise<AgenticAuditCoworker[]> {
  const { context, workspaceId } = input;
  const existing = await context.db.query.coworker.findMany({
    where: and(eq(coworker.ownerId, context.user.id), eq(coworker.workspaceId, workspaceId)),
    columns: { id: true, name: true, username: true },
  });

  return Promise.all(
    getAgenticAuditCoworkerDefinitions().map((definition) =>
      ensureCoworker({ context, workspaceId, existing, definition }),
    ),
  );
}
