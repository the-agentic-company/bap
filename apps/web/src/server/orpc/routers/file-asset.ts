import {
  completeUploadSession,
  createUploadSession,
  FileAssetError,
} from "@bap/core/server/services/file-asset-service";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { requireActiveWorkspaceAccess } from "../workspace-access";

function toOrpcFileAssetError(error: unknown): never {
  if (error instanceof FileAssetError) {
    const code =
      error.code === "file_asset_not_found" || error.code === "upload_session_not_found"
        ? "NOT_FOUND"
        : "BAD_REQUEST";
    throw new ORPCError(code, { message: error.message, data: { fileAssetCode: error.code } });
  }
  throw error;
}

const createUpload = protectedProcedure
  .input(
    z.object({
      filename: z.string().min(1).max(256),
      mimeType: z.string().min(1),
      sizeBytes: z.number().int().positive(),
    }),
  )
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    try {
      return await createUploadSession({
        database: context.db as typeof import("@bap/db/client").db,
        userId: context.user.id,
        workspaceId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      });
    } catch (error) {
      toOrpcFileAssetError(error);
    }
  });

const completeUpload = protectedProcedure
  .input(z.object({ uploadSessionId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const {
      workspace: { id: workspaceId },
    } = await requireActiveWorkspaceAccess(context.user.id, context.workspaceId);

    try {
      const file = await completeUploadSession({
        database: context.db as typeof import("@bap/db/client").db,
        userId: context.user.id,
        workspaceId,
        uploadSessionId: input.uploadSessionId,
      });
      return {
        id: file.id,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        status: "ready" as const,
      };
    } catch (error) {
      toOrpcFileAssetError(error);
    }
  });

export const fileAssetRouter = {
  createUpload,
  completeUpload,
};
