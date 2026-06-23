import { buildCoworkerEditApplyEnvelope } from "@bap/core/lib/coworker-runtime-cli";
import { normalizeCoworkerUsername } from "@bap/core/server/services/coworker-metadata";
import {
  applyCoworkerEdit,
  type CoworkerEditApplyResult,
  coworkerBuilderEditSchema,
  resolveCoworkerBuilderContextByConversation,
} from "@bap/core/server/services/coworker-builder-service";
import { triggerCoworkerRun } from "@bap/core/server/services/coworker-service";
import { createFileAssetFromBuffer } from "@bap/core/server/services/file-asset-service";
import { db } from "@bap/db/client";
import { coworker, user } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { authorizeRuntimeTurn } from "@/server/internal/runtime-auth";
import { uploadCoworkerDocument } from "@/server/services/coworker-document";

const documentUploadRequestSchema = z.object({
  runtimeId: z.string().min(1),
  turnSeq: z.number().int().positive(),
  coworkerId: z.string().min(1),
  filename: z.string().min(1).max(256),
  mimeType: z.string().min(1),
  content: z.string().min(1),
  description: z.string().max(1024).optional(),
});

const editRequestSchema = z.object({
  runtimeId: z.string().min(1),
  turnSeq: z.number().int().positive(),
  coworkerId: z.string().min(1),
  baseUpdatedAt: z.string().datetime({ offset: true }),
  changes: coworkerBuilderEditSchema,
});

const invokeAttachmentSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1),
  dataUrl: z.string().min(1),
});

const invokeRequestSchema = z.object({
  runtimeId: z.string().min(1),
  turnSeq: z.number().int().positive(),
  username: z.string().min(1),
  message: z.string().min(1),
  attachments: z.array(invokeAttachmentSchema).max(5).optional(),
});

const listRequestSchema = z.object({
  runtimeId: z.string().min(1),
  turnSeq: z.number().int().positive(),
});

function formatValidationDetails(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path =
      issue.path.length > 0
        ? issue.path
            .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
            .join(".")
            .replace(/\.\[/g, "[")
        : "request";

    return `${path}: ${issue.message}`;
  });
}

/** POST /api/internal/coworkers/runtime/documents/upload */
export async function handleCoworkerDocumentUpload(request: Request): Promise<Response> {
  try {
    const parsed = documentUploadRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const authorized = await authorizeRuntimeTurn({
      runtimeId: parsed.data.runtimeId,
      turnSeq: parsed.data.turnSeq,
      authorizationHeader: request.headers.get("authorization"),
    });
    if (!authorized.ok) {
      if (authorized.reason === "stale_turn") {
        return Response.json({ error: "stale_turn" }, { status: 409 });
      }
      return Response.json({ error: "invalid_callback_token" }, { status: 401 });
    }

    const document = await uploadCoworkerDocument({
      database: db,
      userId: authorized.userId,
      coworkerId: parsed.data.coworkerId,
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      contentBase64: parsed.data.content,
      description: parsed.data.description,
    });

    return Response.json({ document });
  } catch (error) {
    if (error instanceof ORPCError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "BAD_REQUEST" ? 400 : 500;
      return Response.json({ error: error.message }, { status });
    }

    console.error("[Internal] coworker runtime upload document error:", error);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

/** POST /api/internal/coworkers/runtime/edit */
export async function handleCoworkerEdit(request: Request): Promise<Response> {
  try {
    const parsed = editRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: "invalid_request",
          details: formatValidationDetails(parsed.error),
        },
        { status: 400 },
      );
    }

    const authorized = await authorizeRuntimeTurn({
      runtimeId: parsed.data.runtimeId,
      turnSeq: parsed.data.turnSeq,
      authorizationHeader: request.headers.get("authorization"),
    });
    if (!authorized.ok) {
      if (authorized.reason === "stale_turn") {
        return Response.json({ error: "stale_turn" }, { status: 409 });
      }
      return Response.json({ error: "invalid_callback_token" }, { status: 401 });
    }

    const builderContext = await resolveCoworkerBuilderContextByConversation({
      database: db,
      userId: authorized.userId,
      conversationId: authorized.conversationId,
    });
    if (!builderContext || builderContext.coworkerId !== parsed.data.coworkerId) {
      return Response.json({ error: "coworker_builder_context_not_found" }, { status: 404 });
    }

    const dbUser = await db.query.user.findFirst({
      where: eq(user.id, authorized.userId),
      columns: { role: true },
    });

    const result: CoworkerEditApplyResult = await applyCoworkerEdit({
      database: db,
      userId: authorized.userId,
      userRole: dbUser?.role ?? null,
      coworkerId: parsed.data.coworkerId,
      baseUpdatedAt: parsed.data.baseUpdatedAt,
      changes: parsed.data.changes,
    });

    return Response.json({
      edit: buildCoworkerEditApplyEnvelope({
        coworkerId: parsed.data.coworkerId,
        result,
      }),
    });
  } catch (error) {
    console.error("[Internal] coworker runtime edit error:", error);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

/** POST /api/internal/coworkers/runtime/invoke */
export async function handleCoworkerInvoke(request: Request): Promise<Response> {
  try {
    const parsed = invokeRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const authorized = await authorizeRuntimeTurn({
      runtimeId: parsed.data.runtimeId,
      turnSeq: parsed.data.turnSeq,
      authorizationHeader: request.headers.get("authorization"),
    });
    if (!authorized.ok) {
      if (authorized.reason === "stale_turn") {
        return Response.json({ error: "stale_turn" }, { status: 409 });
      }
      return Response.json({ error: "invalid_callback_token" }, { status: 401 });
    }

    const normalizedUsername = normalizeCoworkerUsername(parsed.data.username);
    if (!normalizedUsername) {
      return Response.json({ error: "invalid_username" }, { status: 400 });
    }

    const targetCoworker = await db.query.coworker.findFirst({
      where: and(
        eq(coworker.ownerId, authorized.userId),
        eq(coworker.username, normalizedUsername),
      ),
      columns: {
        id: true,
        name: true,
        username: true,
        workspaceId: true,
      },
    });

    if (!targetCoworker?.username) {
      const available = await db.query.coworker.findMany({
        where: and(eq(coworker.ownerId, authorized.userId), isNotNull(coworker.username)),
        columns: {
          username: true,
        },
      });

      return Response.json(
        {
          error: "coworker_not_found",
          username: normalizedUsername,
          availableUsernames: available
            .map((entry) => entry.username)
            .filter((entry): entry is string => typeof entry === "string"),
        },
        { status: 404 },
      );
    }
    if (!targetCoworker.workspaceId) {
      return Response.json({ error: "coworker_workspace_not_found" }, { status: 400 });
    }

    const attachments = await Promise.all(
      (parsed.data.attachments ?? []).map(async (attachment) => {
        const base64Data = attachment.dataUrl.split(",")[1] || "";
        const asset = await createFileAssetFromBuffer({
          database: db,
          userId: authorized.userId,
          workspaceId: targetCoworker.workspaceId!,
          filename: attachment.name,
          mimeType: attachment.mimeType,
          content: Buffer.from(base64Data, "base64"),
        });
        return {
          fileAssetId: asset.id,
          name: asset.filename,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
        };
      }),
    );
    const result = await triggerCoworkerRun({
      coworkerId: targetCoworker.id,
      startKind: "user_intent",
      userId: authorized.userId,
      triggerPayload: {
        source: "chat_mention",
        parentGenerationId: authorized.generationId,
        parentConversationId: authorized.conversationId,
        mention: `@${targetCoworker.username}`,
        message: parsed.data.message.trim(),
        attachmentNames: attachments.map((attachment) => attachment.name),
      },
      fileAttachments: attachments,
    });

    return Response.json({
      invocation: {
        kind: "coworker_invocation",
        coworkerId: targetCoworker.id,
        username: targetCoworker.username,
        name: targetCoworker.name,
        runId: result.runId,
        conversationId: result.conversationId,
        generationId: result.generationId,
        status: result.generationId ? "running" : "needs_user_input",
        attachmentNames: attachments.map((attachment) => attachment.name),
        message: parsed.data.message.trim(),
      },
    });
  } catch (error) {
    console.error("[Internal] coworker runtime invoke error:", error);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

/** POST /api/internal/coworkers/runtime/list */
export async function handleCoworkerList(request: Request): Promise<Response> {
  try {
    const parsed = listRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const authorized = await authorizeRuntimeTurn({
      runtimeId: parsed.data.runtimeId,
      turnSeq: parsed.data.turnSeq,
      authorizationHeader: request.headers.get("authorization"),
    });
    if (!authorized.ok) {
      if (authorized.reason === "stale_turn") {
        return Response.json({ error: "stale_turn" }, { status: 409 });
      }
      return Response.json({ error: "invalid_callback_token" }, { status: 401 });
    }

    const coworkers = await db.query.coworker.findMany({
      where: and(eq(coworker.ownerId, authorized.userId), isNotNull(coworker.username)),
      orderBy: (row) => [desc(row.updatedAt)],
      columns: {
        id: true,
        name: true,
        username: true,
        description: true,
        triggerType: true,
      },
    });

    return Response.json({
      coworkers: coworkers
        .filter(
          (item): item is typeof item & { username: string } => typeof item.username === "string",
        )
        .map((item) => ({
          id: item.id,
          name: item.name,
          username: item.username,
          description: item.description,
          triggerType: item.triggerType,
        })),
    });
  } catch (error) {
    console.error("[Internal] coworker runtime list error:", error);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
