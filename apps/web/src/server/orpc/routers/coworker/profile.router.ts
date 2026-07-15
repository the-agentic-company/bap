import { z } from "zod";
import {
  DEFAULT_COWORKER_INTEGRATIONS,
  defaultModelReferenceSchema,
  integrationTypeSchema,
  providerAuthSourceSchema,
  scheduleSchema,
  toolAccessModeSchema,
  triggerTypeSchema,
  userInputPromptSchema,
} from "./schemas";
import { protectedProcedure } from "../../middleware";
import { requireActiveWorkspaceAccess } from "../../workspace-access";
import {
  requireAccessibleCoworkerInActiveWorkspace,
  requireOwnedCoworkerInActiveWorkspace,
} from "./access";
import {
  createCoworkerProfile,
  deleteCoworkerProfile,
  setCoworkerStatus,
  updateCoworkerProfile,
} from "@/server/services/coworker-profile";

const create = protectedProcedure
  .input(
    z.object({
      name: z.string().max(128).optional(),
      description: z.string().max(280).nullish(),
      username: z.string().max(128).nullish(),
      triggerType: triggerTypeSchema,
      prompt: z.string().max(20000),
      model: defaultModelReferenceSchema,
      authSource: providerAuthSourceSchema.nullish(),
      autoApprove: z.boolean().optional(),
      toolAccessMode: toolAccessModeSchema.default("all"),
      allowedIntegrations: z.array(integrationTypeSchema).default(DEFAULT_COWORKER_INTEGRATIONS),
      allowedCustomIntegrations: z.array(z.string()).default([]),
      allowedWorkspaceMcpServerIds: z.array(z.string()).default([]),
      allowedSkillSlugs: z.array(z.string()).default([]),
      folderId: z.string().nullable().optional(),
      schedule: scheduleSchema.nullish(),
      requiresUserInput: z.boolean().optional(),
      userInputPrompt: userInputPromptSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);
    return createCoworkerProfile({
      context,
      workspaceId,
      payload: input,
    });
  });

const update = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      name: z.string().max(128).optional(),
      description: z.string().max(280).nullish(),
      username: z.string().max(128).nullish(),
      status: z.enum(["on", "off"]).optional(),
      triggerType: triggerTypeSchema.optional(),
      prompt: z.string().max(20000).optional(),
      model: defaultModelReferenceSchema.removeDefault().optional(),
      authSource: providerAuthSourceSchema.nullish(),
      autoApprove: z.boolean().optional(),
      isPinned: z.boolean().optional(),
      toolAccessMode: toolAccessModeSchema.optional(),
      allowedIntegrations: z.array(integrationTypeSchema).optional(),
      allowedCustomIntegrations: z.array(z.string()).optional(),
      allowedWorkspaceMcpServerIds: z.array(z.string()).optional(),
      allowedSkillSlugs: z.array(z.string()).optional(),
      schedule: scheduleSchema.nullish(),
      requiresUserInput: z.boolean().optional(),
      userInputPrompt: userInputPromptSchema,
    }),
  )
  .handler(async ({ input, context }) => {
    const { coworker: existing, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );

    return updateCoworkerProfile({
      context,
      workspaceId,
      existing,
      payload: input,
    });
  });

const del = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: existing, workspaceId } = await requireOwnedCoworkerInActiveWorkspace(
      context,
      input.id,
    );

    return deleteCoworkerProfile({
      context,
      workspaceId,
      existing,
      coworkerId: input.id,
    });
  });

const setStatus = protectedProcedure
  .input(z.object({ id: z.string(), status: z.enum(["on", "off"]) }))
  .handler(async ({ input, context }) => {
    const { coworker: existing, workspaceId } = await requireAccessibleCoworkerInActiveWorkspace(
      context,
      input.id,
    );

    return setCoworkerStatus({
      context,
      workspaceId,
      existing,
      status: input.status,
    });
  });

export const coworkerProfileProcedures = {
  create,
  update,
  setStatus,
  delete: del,
};
