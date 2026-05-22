import {
  getValidConnectedAccountTokensForUser,
  getValidTokensForUser,
} from "@cmdclaw/core/server/integrations/token-refresh";
import type { IntegrationType } from "@cmdclaw/core/server/oauth/config";
import { db } from "@cmdclaw/db/client";
import {
  conversation,
  conversationRuntime,
  generation,
  generationInterrupt,
  integration,
  integrationToken,
  message,
  user,
  type ContentPart,
} from "@cmdclaw/db/schema";
import { Daytona } from "@daytonaio/sdk";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/env";

type SandboxProvider = "e2b" | "daytona" | "docker";

type CleanupGenerationRow = {
  id: string;
  conversationId: string;
  sandboxId: string | null;
  sandboxProvider: string | null;
  runtimeId: string | null;
};

type CleanupRuntimeRow = {
  id: string;
  conversationId: string;
  sandboxId: string | null;
  sandboxProvider: string | null;
  sessionId: string | null;
  status: string;
  activeGenerationId: string | null;
};

const sandboxProviders = ["e2b", "daytona", "docker"] as const;
const DAYTONA_DELETE_WAIT_TIMEOUT_MS = Number(
  process.env.E2E_DAYTONA_DELETE_WAIT_TIMEOUT_MS ?? "15000",
);
const DAYTONA_DELETE_POLL_INTERVAL_MS = 500;

const tokenBackupSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().nullable(),
  tokenType: z.string().nullable(),
  expiresAt: z.string().nullable(),
  idToken: z.string().nullable(),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("integration-token:get"),
    email: z.email(),
    integrationType: z.string().min(1),
    accountLabel: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal("integration-tokens:remove"),
    email: z.email(),
    integrationType: z.string().min(1),
  }),
  z.object({
    action: z.literal("integration-tokens:restore-if-empty"),
    email: z.email(),
    integrationType: z.string().min(1),
    tokens: z.array(tokenBackupSchema),
  }),
  z.object({
    action: z.literal("integration:provider-account-id"),
    email: z.email(),
    integrationType: z.string().min(1),
  }),
  z.object({
    action: z.literal("sandbox:rows"),
    generationIds: z.array(z.string()).optional(),
    conversationIds: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("sandbox:cleanup"),
    generationIds: z.array(z.string()).optional(),
    conversationIds: z.array(z.string()).optional(),
    expectedProvider: z.enum(sandboxProviders),
  }),
  z.object({
    action: z.literal("generation:get-state"),
    generationId: z.string().min(1),
  }),
  z.object({
    action: z.literal("generation:find-by-prompt"),
    promptToken: z.string().min(1),
  }),
  z.object({
    action: z.literal("generation:get-runtime-fields"),
    generationId: z.string().min(1),
  }),
  z.object({
    action: z.literal("interrupt:latest-pending"),
    generationId: z.string().min(1),
    expectedKind: z.enum(["plugin_write", "auth"]),
  }),
  z.object({
    action: z.literal("conversation:latest-assistant-message"),
    conversationId: z.string().min(1),
  }),
  z.object({
    action: z.literal("user:exists"),
    email: z.email(),
  }),
]);

function isAuthorized(request: Request): boolean {
  const expected = env.CMDCLAW_SERVER_SECRET ? `Bearer ${env.CMDCLAW_SERVER_SECRET}` : "";
  return Boolean(expected) && request.headers.get("authorization") === expected;
}

function uniqueNonEmpty(values: Iterable<string> | undefined): string[] {
  return Array.from(new Set(Array.from(values ?? []).filter((value) => value.trim().length > 0)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.email, email),
    columns: { id: true },
  });

  return dbUser ?? null;
}

async function findIntegration(args: {
  email: string;
  integrationType: string;
}): Promise<{ id: string; providerAccountId: string | null } | null> {
  const dbUser = await findUserByEmail(args.email);
  if (!dbUser) {
    return null;
  }

  return (
    (await db.query.integration.findFirst({
      where: and(
        eq(integration.userId, dbUser.id),
        eq(integration.type, args.integrationType as IntegrationType),
      ),
      columns: { id: true, providerAccountId: true },
    })) ?? null
  );
}

async function loadCleanupRows(args: {
  generationIds?: Iterable<string>;
  conversationIds?: Iterable<string>;
}): Promise<{ generationRows: CleanupGenerationRow[]; runtimeRows: CleanupRuntimeRow[] }> {
  const generationIds = uniqueNonEmpty(args.generationIds);
  const conversationIds = uniqueNonEmpty(args.conversationIds);

  if (generationIds.length === 0 && conversationIds.length === 0) {
    return {
      generationRows: [],
      runtimeRows: [],
    };
  }

  const generationWhere =
    generationIds.length > 0 && conversationIds.length > 0
      ? or(
          inArray(generation.id, generationIds),
          inArray(generation.conversationId, conversationIds),
        )
      : generationIds.length > 0
        ? inArray(generation.id, generationIds)
        : inArray(generation.conversationId, conversationIds);

  const [generationRows, runtimeRows] = await Promise.all([
    db.query.generation.findMany({
      where: generationWhere,
      columns: {
        id: true,
        conversationId: true,
        sandboxId: true,
        sandboxProvider: true,
        runtimeId: true,
      },
    }),
    conversationIds.length > 0
      ? db.query.conversationRuntime.findMany({
          where: inArray(conversationRuntime.conversationId, conversationIds),
          columns: {
            id: true,
            conversationId: true,
            sandboxId: true,
            sandboxProvider: true,
            sessionId: true,
            status: true,
            activeGenerationId: true,
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    generationRows,
    runtimeRows,
  };
}

function getDaytonaConfig(): {
  apiKey?: string;
  apiUrl?: string;
  target?: string;
} {
  return {
    ...(process.env.DAYTONA_API_KEY ? { apiKey: process.env.DAYTONA_API_KEY } : {}),
    ...((process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL)
      ? { apiUrl: process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL }
      : {}),
    ...(process.env.DAYTONA_TARGET ? { target: process.env.DAYTONA_TARGET } : {}),
  };
}

async function waitForDaytonaSandboxDeletion(
  daytona: Daytona,
  sandboxId: string,
  timeoutMs = DAYTONA_DELETE_WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<void> => {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Daytona sandbox ${sandboxId} to stop.`);
    }

    try {
      const sandbox = await daytona.get(sandboxId);
      if ((sandbox.state ?? "").toLowerCase() !== "started") {
        return;
      }
    } catch {
      return;
    }

    await sleep(DAYTONA_DELETE_POLL_INTERVAL_MS);
    return poll();
  };

  return poll();
}

function isRetryableDaytonaDeleteError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const statusCode =
    "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : null;
  const message = error instanceof Error ? error.message : String(error);

  return statusCode === 409 || /state change in progress/i.test(message);
}

async function deleteDaytonaSandboxById(daytona: Daytona, sandboxId: string): Promise<void> {
  const deadline = Date.now() + DAYTONA_DELETE_WAIT_TIMEOUT_MS;

  const attemptDelete = async (): Promise<void> => {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out deleting Daytona sandbox ${sandboxId} while it was changing state.`,
      );
    }

    try {
      const sandbox = await daytona.get(sandboxId);
      await sandbox.delete?.();
      await waitForDaytonaSandboxDeletion(
        daytona,
        sandboxId,
        Math.max(1_000, deadline - Date.now()),
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found/i.test(message)) {
        return;
      }
      if (!isRetryableDaytonaDeleteError(error)) {
        throw error;
      }
      await sleep(DAYTONA_DELETE_POLL_INTERVAL_MS);
    }
    return attemptDelete();
  };

  return attemptDelete();
}

async function clearConversationRuntimeBindings(runtimeIds: string[]): Promise<void> {
  if (runtimeIds.length === 0) {
    return;
  }

  await db
    .update(conversationRuntime)
    .set({
      status: "dead",
      sandboxId: null,
      sessionId: null,
      activeGenerationId: null,
    })
    .where(inArray(conversationRuntime.id, runtimeIds));
}

async function cleanupDaytonaRows(args: {
  generationRows: CleanupGenerationRow[];
  runtimeRows: CleanupRuntimeRow[];
  expectedProvider: SandboxProvider;
}): Promise<void> {
  const sandboxIds = Array.from(
    new Set([
      ...args.runtimeRows.filter((row) => row.sandboxId).map((row) => row.sandboxId as string),
      ...args.generationRows.filter((row) => row.sandboxId).map((row) => row.sandboxId as string),
    ]),
  );
  const runtimeIds = Array.from(new Set(args.runtimeRows.map((row) => row.id)));
  const providerMismatches = [
    ...args.runtimeRows
      .filter(
        (row) =>
          row.sandboxId && row.sandboxProvider && row.sandboxProvider !== args.expectedProvider,
      )
      .map(
        (row) =>
          `runtime=${row.id} conversation=${row.conversationId} provider=${row.sandboxProvider} sandboxId=${row.sandboxId}`,
      ),
    ...args.generationRows
      .filter(
        (row) =>
          row.sandboxId && row.sandboxProvider && row.sandboxProvider !== args.expectedProvider,
      )
      .map(
        (row) =>
          `generation=${row.id} conversation=${row.conversationId} provider=${row.sandboxProvider} sandboxId=${row.sandboxId}`,
      ),
  ];

  if (providerMismatches.length > 0) {
    throw new Error(
      `CLI live cleanup provider mismatch. Expected ${args.expectedProvider}.\n${providerMismatches.join("\n")}`,
    );
  }

  if (sandboxIds.length === 0 && runtimeIds.length === 0) {
    return;
  }

  const daytona = new Daytona(getDaytonaConfig());
  for (const sandboxId of sandboxIds) {
    // eslint-disable-next-line no-await-in-loop -- cleanup must remain bounded and debuggable
    await deleteDaytonaSandboxById(daytona, sandboxId);
  }

  await clearConversationRuntimeBindings(runtimeIds);
}

async function handleAction(payload: z.infer<typeof requestSchema>): Promise<unknown> {
  switch (payload.action) {
    case "integration-token:get": {
      const dbUser = await findUserByEmail(payload.email);
      if (!dbUser) {
        return { token: null };
      }
      if (payload.accountLabel) {
        const tokens = await getValidConnectedAccountTokensForUser(dbUser.id, [
          payload.integrationType as IntegrationType,
        ]);
        const requestedLabel = payload.accountLabel.trim().toLowerCase();
        const match = tokens.find((token) => token.accountLabel?.toLowerCase() === requestedLabel);
        return { token: match?.accessToken ?? null };
      }
      const tokens = await getValidTokensForUser(dbUser.id);
      return { token: tokens.get(payload.integrationType as IntegrationType) ?? null };
    }
    case "integration-tokens:remove": {
      const dbIntegration = await findIntegration(payload);
      if (!dbIntegration) {
        return { tokens: [] };
      }
      const tokens = await db.query.integrationToken.findMany({
        where: eq(integrationToken.integrationId, dbIntegration.id),
        columns: {
          accessToken: true,
          refreshToken: true,
          tokenType: true,
          expiresAt: true,
          idToken: true,
        },
      });
      if (tokens.length > 0) {
        await db
          .delete(integrationToken)
          .where(eq(integrationToken.integrationId, dbIntegration.id));
      }
      return {
        tokens: tokens.map((token) => ({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt?.toISOString() ?? null,
          idToken: token.idToken,
        })),
      };
    }
    case "integration-tokens:restore-if-empty": {
      const dbIntegration = await findIntegration(payload);
      if (!dbIntegration || payload.tokens.length === 0) {
        return { restored: false };
      }
      const currentTokens = await db.query.integrationToken.findMany({
        where: eq(integrationToken.integrationId, dbIntegration.id),
        columns: { id: true },
      });
      if (currentTokens.length > 0) {
        return { restored: false };
      }
      await db.insert(integrationToken).values(
        payload.tokens.map((token) => ({
          integrationId: dbIntegration.id,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt ? new Date(token.expiresAt) : null,
          idToken: token.idToken,
        })),
      );
      return { restored: true };
    }
    case "integration:provider-account-id": {
      const dbIntegration = await findIntegration(payload);
      return { providerAccountId: dbIntegration?.providerAccountId ?? null };
    }
    case "sandbox:rows": {
      const rows = await loadCleanupRows(payload);
      return { rows: rows.generationRows };
    }
    case "sandbox:cleanup": {
      if (payload.expectedProvider === "daytona") {
        const rows = await loadCleanupRows(payload);
        await cleanupDaytonaRows({ ...rows, expectedProvider: payload.expectedProvider });
        const refreshedRows = await loadCleanupRows(payload);
        const startedRuntimes = refreshedRows.runtimeRows.filter(
          (row) =>
            row.sandboxProvider === payload.expectedProvider &&
            row.sandboxId &&
            row.status === "active",
        );
        if (startedRuntimes.length > 0) {
          const details = startedRuntimes
            .map(
              (row) =>
                `runtime=${row.id} conversation=${row.conversationId} sandboxId=${row.sandboxId}`,
            )
            .join("\n");
          throw new Error(`CLI live test leaked active Daytona runtime(s):\n${details}`);
        }
      }
      return { ok: true };
    }
    case "generation:get-state": {
      const record = await db.query.generation.findFirst({
        where: eq(generation.id, payload.generationId),
        columns: {
          id: true,
          status: true,
          completionReason: true,
          sandboxId: true,
          suspendedAt: true,
          remainingRunMs: true,
          executionPolicy: true,
          startedAt: true,
          deadlineAt: true,
        },
      });
      return { record };
    }
    case "generation:find-by-prompt": {
      const promptMessage = await db.query.message.findFirst({
        where: and(eq(message.role, "user"), like(message.content, `%${payload.promptToken}%`)),
        columns: {
          conversationId: true,
        },
        orderBy: (fields) => [desc(fields.createdAt)],
      });
      if (!promptMessage?.conversationId) {
        return { target: null };
      }

      const active = await db.query.conversation.findFirst({
        where: eq(conversation.id, promptMessage.conversationId),
        columns: {
          id: true,
          currentGenerationId: true,
          generationStatus: true,
        },
      });
      if (
        active?.currentGenerationId &&
        ["generating", "awaiting_approval", "awaiting_auth", "paused"].includes(
          active.generationStatus,
        )
      ) {
        return {
          target: {
            conversationId: active.id,
            generationId: active.currentGenerationId,
          },
        };
      }
      return { target: null };
    }
    case "generation:get-runtime-fields": {
      const record = await db.query.generation.findFirst({
        where: eq(generation.id, payload.generationId),
        columns: {
          remainingRunMs: true,
          executionPolicy: true,
        },
      });
      return { record };
    }
    case "interrupt:latest-pending": {
      const interrupt = await db.query.generationInterrupt.findFirst({
        where: and(
          eq(generationInterrupt.generationId, payload.generationId),
          eq(generationInterrupt.kind, payload.expectedKind),
          eq(generationInterrupt.status, "pending"),
        ),
        columns: {
          id: true,
          status: true,
          kind: true,
        },
        orderBy: (fields) => [desc(fields.requestedAt)],
      });
      return { interrupt: interrupt ?? null };
    }
    case "conversation:latest-assistant-message": {
      const assistantMessages = await db
        .select({
          content: message.content,
          contentParts: message.contentParts,
        })
        .from(message)
        .innerJoin(conversation, eq(message.conversationId, conversation.id))
        .where(and(eq(conversation.id, payload.conversationId), eq(message.role, "assistant")))
        .orderBy(desc(message.createdAt))
        .limit(1);
      return {
        message:
          (assistantMessages[0] as
            | { content: string; contentParts: ContentPart[] | null }
            | undefined) ?? null,
      };
    }
    case "user:exists": {
      const dbUser = await findUserByEmail(payload.email);
      return { exists: Boolean(dbUser) };
    }
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    return Response.json(await handleAction(parsed.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
