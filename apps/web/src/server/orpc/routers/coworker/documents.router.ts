import { coworkerDocument } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../middleware";
import { requireOwnedCoworkerInActiveWorkspace } from "./access";
import {
  deleteCoworkerDocument,
  updateCoworkerDocument,
  uploadCoworkerDocument,
} from "@/server/services/coworker-document";

const uploadDocument = protectedProcedure
  .input(
    z.object({
      coworkerId: z.string(),
      filename: z.string().min(1).max(256),
      mimeType: z.string().min(1),
      content: z.string().min(1),
      description: z.string().max(1024).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    await requireOwnedCoworkerInActiveWorkspace(context, input.coworkerId);
    return uploadCoworkerDocument({
      database: context.db as typeof import("@bap/db/client").db,
      userId: context.user.id,
      coworkerId: input.coworkerId,
      filename: input.filename,
      mimeType: input.mimeType,
      contentBase64: input.content,
      description: input.description,
    });
  });

const deleteDocument = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const existingDocument = await context.db.query.coworkerDocument.findFirst({
      where: eq(coworkerDocument.id, input.id),
      columns: { coworkerId: true },
    });

    if (!existingDocument) {
      throw new ORPCError("NOT_FOUND", { message: "Document not found" });
    }

    await requireOwnedCoworkerInActiveWorkspace(context, existingDocument.coworkerId);
    return deleteCoworkerDocument({
      database: context.db as typeof import("@bap/db/client").db,
      userId: context.user.id,
      documentId: input.id,
    });
  });

const updateDocument = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      filename: z.string().min(1).max(256).optional(),
      mimeType: z.string().min(1).optional(),
      content: z.string().min(1).optional(),
      description: z.string().max(1024).nullish(),
    }),
  )
  .handler(async ({ input, context }) => {
    const existingDocument = await context.db.query.coworkerDocument.findFirst({
      where: eq(coworkerDocument.id, input.id),
      columns: { coworkerId: true },
    });

    if (!existingDocument) {
      throw new ORPCError("NOT_FOUND", { message: "Document not found" });
    }

    await requireOwnedCoworkerInActiveWorkspace(context, existingDocument.coworkerId);
    return updateCoworkerDocument({
      database: context.db as typeof import("@bap/db/client").db,
      userId: context.user.id,
      documentId: input.id,
      filename: input.filename,
      mimeType: input.mimeType,
      contentBase64: input.content,
      description: input.description,
    });
  });

const getDocumentUrl = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const existingDocument = await context.db.query.coworkerDocument.findFirst({
      where: eq(coworkerDocument.id, input.id),
      columns: {
        coworkerId: true,
        filename: true,
        mimeType: true,
        storageKey: true,
      },
    });

    if (!existingDocument) {
      throw new ORPCError("NOT_FOUND", { message: "Document not found" });
    }

    await requireOwnedCoworkerInActiveWorkspace(context, existingDocument.coworkerId);
    return {
      url: `/api/coworkers/documents/${encodeURIComponent(input.id)}/download`,
      filename: existingDocument.filename,
      mimeType: existingDocument.mimeType,
    };
  });

export const coworkerDocumentProcedures = {
  uploadDocument,
  updateDocument,
  getDocumentUrl,
  deleteDocument,
};
