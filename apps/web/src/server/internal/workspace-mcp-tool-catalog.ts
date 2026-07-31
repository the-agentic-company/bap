import { db } from "@bap/db/client";
import { workspaceMcpToolCatalog } from "@bap/db/schema";
import { and, eq, ne } from "drizzle-orm";

export type WorkspaceMcpToolDescriptor = {
  name?: string;
  title?: string;
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
};

type Database = typeof db;

export async function persistWorkspaceMcpToolCatalog(input: {
  database?: Database;
  workspaceMcpServerId: string;
  tools: WorkspaceMcpToolDescriptor[];
  markMissingUnavailable: boolean;
}): Promise<void> {
  const database = input.database ?? db;
  const seenAt = new Date();
  const validTools = input.tools.filter(
    (tool): tool is WorkspaceMcpToolDescriptor & { name: string } =>
      typeof tool.name === "string" && tool.name.trim().length > 0,
  );
  const seenNames = validTools.map((tool) => tool.name);

  await database.transaction(async (tx) => {
    if (input.markMissingUnavailable) {
      await tx
        .update(workspaceMcpToolCatalog)
        .set({ available: false, removedAt: seenAt })
        .where(
          seenNames.length > 0
            ? and(
                eq(workspaceMcpToolCatalog.workspaceMcpServerId, input.workspaceMcpServerId),
                ...seenNames.map((name) => ne(workspaceMcpToolCatalog.toolName, name)),
              )
            : eq(workspaceMcpToolCatalog.workspaceMcpServerId, input.workspaceMcpServerId),
        );
    }

    await Promise.all(
      validTools.map((tool) =>
        tx
          .insert(workspaceMcpToolCatalog)
          .values({
            workspaceMcpServerId: input.workspaceMcpServerId,
            toolName: tool.name,
            title: tool.title ?? null,
            description: tool.description ?? null,
            annotations: tool.annotations ?? null,
            inputSchema: tool.inputSchema ?? null,
            available: true,
            lastSeenAt: seenAt,
            removedAt: null,
          })
          .onConflictDoUpdate({
            target: [
              workspaceMcpToolCatalog.workspaceMcpServerId,
              workspaceMcpToolCatalog.toolName,
            ],
            set: {
              title: tool.title ?? null,
              description: tool.description ?? null,
              annotations: tool.annotations ?? null,
              inputSchema: tool.inputSchema ?? null,
              available: true,
              lastSeenAt: seenAt,
              removedAt: null,
            },
          }),
      ),
    );
  });
}
