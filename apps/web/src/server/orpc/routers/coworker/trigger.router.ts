import { remoteIntegrationSourceSchema } from "@bap/core/server/integrations/remote-integrations";
import { generationLifecyclePolicy } from "@bap/core/server/services/lifecycle-policy";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireOwnedCoworkerInActiveWorkspace } from "./access";
import { triggerCoworkerFromWeb } from "@/server/services/coworker-trigger";

const trigger = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      payload: z.unknown().optional(),
      fileAttachments: z
        .array(
          z.object({
            fileAssetId: z.string().min(1),
            name: z.string().optional(),
            mimeType: z.string().optional(),
            sizeBytes: z.number().int().nonnegative().optional(),
          }),
        )
        .optional(),
      trustedUserInput: z.string().max(100000).optional(),
      remoteIntegrationSource: remoteIntegrationSourceSchema
        .pick({
          targetEnv: true,
          remoteUserId: true,
        })
        .optional(),
      debugRunDeadlineMs: z
        .number()
        .int()
        .min(1_000)
        .max(generationLifecyclePolicy.runDeadlineMs)
        .optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireOwnedCoworkerInActiveWorkspace(context, input.id);
    return triggerCoworkerFromWeb({
      context: context as Parameters<typeof triggerCoworkerFromWeb>[0]["context"],
      coworkerId: input.id,
      payload: input.payload,
      trustedUserInput: input.trustedUserInput,
      fileAttachments: input.fileAttachments,
      debugRunDeadlineMs: input.debugRunDeadlineMs,
      remoteIntegrationSource: input.remoteIntegrationSource,
    });
  });

export const coworkerTriggerProcedures = {
  trigger,
};
