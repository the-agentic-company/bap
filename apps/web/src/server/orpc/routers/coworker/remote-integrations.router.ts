import {
  listConfiguredRemoteIntegrationTargets,
  remoteIntegrationTargetEnvSchema,
  searchRemoteIntegrationUsers,
} from "@bap/core/server/integrations/remote-integrations";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireAdminUser } from "./access";

const listRemoteIntegrationTargets = protectedProcedure.handler(async ({ context }) => {
  await requireAdminUser(context);
  return {
    targets: listConfiguredRemoteIntegrationTargets(),
  };
});

const searchRemoteIntegrationUsersProcedure = protectedProcedure
  .input(
    z.object({
      targetEnv: remoteIntegrationTargetEnvSchema,
      query: z.string().default(""),
      limit: z.number().int().min(1).max(25).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireAdminUser(context);

    return {
      users: await searchRemoteIntegrationUsers({
        targetEnv: input.targetEnv,
        query: input.query,
        limit: input.limit,
      }),
    };
  });

export const coworkerRemoteIntegrationProcedures = {
  listRemoteIntegrationTargets,
  searchRemoteIntegrationUsers: searchRemoteIntegrationUsersProcedure,
};
