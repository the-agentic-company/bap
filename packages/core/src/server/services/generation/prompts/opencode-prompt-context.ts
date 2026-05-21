import { db } from "@cmdclaw/db/client";
import { user } from "@cmdclaw/db/schema";
import { eq } from "drizzle-orm";
import { buildMemorySystemPrompt } from "../../../sandbox/prep/memory-prep";
import {
  composeOpencodePromptSpec,
  type OpencodePromptCompositionInput,
  type ResolvedPromptSpec,
} from "../../../prompts/opencode-runtime-prompt";
import type { GenerationContext } from "../types";

export type OpencodePromptContext = Pick<
  GenerationContext,
  | "userId"
  | "coworkerRunId"
  | "coworkerPrompt"
  | "coworkerPromptDo"
  | "coworkerPromptDont"
  | "triggerPayload"
  | "builderCoworkerContext"
  | "selectedPlatformSkillSlugs"
>;

export type SharedOpencodePromptContext = {
  cliInstructions?: string | null;
  executorInstructions?: string | null;
  skillsInstructions?: string | null;
  integrationSkillsInstructions?: string | null;
  memoryInstructions?: string | null;
  userTimezone?: string | null;
};

export function buildOpencodePromptSpecInputForContext(
  ctx: OpencodePromptContext,
  shared: SharedOpencodePromptContext,
): OpencodePromptCompositionInput {
  const base = {
    ...shared,
    selectedPlatformSkillSlugs: ctx.selectedPlatformSkillSlugs,
  };
  if (ctx.coworkerRunId) {
    return {
      kind: "coworker_runner",
      ...base,
      coworkerPrompt: ctx.coworkerPrompt,
      coworkerPromptDo: ctx.coworkerPromptDo,
      coworkerPromptDont: ctx.coworkerPromptDont,
      triggerPayload: ctx.triggerPayload,
    };
  }
  if (ctx.builderCoworkerContext) {
    return {
      kind: "coworker_builder",
      ...base,
      builderCoworkerContext: ctx.builderCoworkerContext,
    };
  }
  return {
    kind: "chat",
    ...base,
  };
}

export async function composeContinuationPromptSpec(
  ctx: OpencodePromptContext,
): Promise<ResolvedPromptSpec> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.id, ctx.userId),
    columns: { timezone: true },
  });
  return composeOpencodePromptSpec(
    buildOpencodePromptSpecInputForContext(ctx, {
      cliInstructions: "",
      executorInstructions: null,
      skillsInstructions: "",
      integrationSkillsInstructions: "",
      memoryInstructions: buildMemorySystemPrompt(),
      userTimezone: dbUser?.timezone ?? null,
    }),
  );
}
