import {
  createCoworkerForwardingAlias,
  disableCoworkerForwardingAlias,
  getCoworkerForwardingAlias,
  rotateCoworkerForwardingAlias,
} from "@bap/core/server/services/coworker-email-forwarding";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireOwnedCoworkerInActiveWorkspace } from "./access";

const getForwardingAlias = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf } = await requireOwnedCoworkerInActiveWorkspace(context, input.id);

    return getCoworkerForwardingAlias({
      database: context.db as Parameters<typeof getCoworkerForwardingAlias>[0]["database"],
      coworker: wf,
    });
  });

const createForwardingAlias = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf } = await requireOwnedCoworkerInActiveWorkspace(context, input.id);

    return createCoworkerForwardingAlias({
      database: context.db as Parameters<typeof createCoworkerForwardingAlias>[0]["database"],
      coworker: wf,
    });
  });

const disableForwardingAlias = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf } = await requireOwnedCoworkerInActiveWorkspace(context, input.id);

    return disableCoworkerForwardingAlias({
      database: context.db as Parameters<typeof disableCoworkerForwardingAlias>[0]["database"],
      coworker: wf,
    });
  });

const rotateForwardingAlias = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const { coworker: wf } = await requireOwnedCoworkerInActiveWorkspace(context, input.id);

    return rotateCoworkerForwardingAlias({
      database: context.db as Parameters<typeof rotateCoworkerForwardingAlias>[0]["database"],
      coworker: wf,
    });
  });

export const coworkerForwardingAliasProcedures = {
  getForwardingAlias,
  createForwardingAlias,
  disableForwardingAlias,
  rotateForwardingAlias,
};
