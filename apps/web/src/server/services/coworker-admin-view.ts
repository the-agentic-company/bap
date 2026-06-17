import { coworker } from "@bap/db/schema";
import { eq } from "drizzle-orm";

export async function listAdminWorkspaceCoworkers(input: {
  database: typeof import("@bap/db/client").db;
  workspaceId: string;
}) {
  const coworkers = await input.database.query.coworker.findMany({
    where: eq(coworker.workspaceId, input.workspaceId),
    with: {
      owner: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: (wf, { desc }) => [desc(wf.updatedAt)],
  });

  return coworkers.map((wf) => ({
    id: wf.id,
    name: wf.name,
    description: wf.description,
    status: wf.status,
    triggerType: wf.triggerType,
    sharedAt: wf.sharedAt,
    updatedAt: wf.updatedAt,
    owner: wf.owner,
  }));
}
