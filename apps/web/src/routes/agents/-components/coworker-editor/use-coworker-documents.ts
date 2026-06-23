import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  useDeleteCoworkerDocument,
  useGetCoworkerDocumentUrl,
  useUploadCoworkerDocument,
} from "@/orpc/hooks/coworkers";
import type { CoworkerDocumentRecord, UploadAttachment } from "./types";
import {
  buildCoworkerDocumentBuilderMessage,
  buildCoworkerDocumentRemovalBuilderMessage,
} from "./coworker-editor-utils";

type BuilderChatActions = {
  sendMessage: (input: {
    content: string;
    attachments?: UploadAttachment[];
  }) => Promise<
    | { status: "missing-conversation" }
    | { status: "sent"; conversationId: string }
    | { status: "queued"; conversationId: string }
  >;
};

type UseCoworkerDocumentsInput = {
  coworkerId?: string;
  builderChat: BuilderChatActions;
};

export function useCoworkerDocuments({ coworkerId, builderChat }: UseCoworkerDocumentsInput) {
  const uploadCoworkerDocument = useUploadCoworkerDocument();
  const deleteCoworkerDocument = useDeleteCoworkerDocument();
  const getCoworkerDocumentUrl = useGetCoworkerDocumentUrl();
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [deletingDocumentIds, setDeletingDocumentIds] = useState<string[]>([]);
  const [downloadingDocumentIds, setDownloadingDocumentIds] = useState<string[]>([]);

  const uploadDocuments = useCallback(
    async (files: FileList | File[]) => {
      if (!coworkerId) {
        return;
      }

      const nextFiles = Array.from(files).filter((file) => file.size > 0);
      if (nextFiles.length === 0) {
        return;
      }

      setIsUploadingDocuments(true);
      try {
        const uploadedDocuments = await Promise.all(
          nextFiles.map((file) =>
            uploadCoworkerDocument.mutateAsync({
              coworkerId,
              file,
            }),
          ),
        );
        const attachments: UploadAttachment[] = uploadedDocuments.map((document) => ({
          fileAssetId: document.fileAssetId,
          name: document.filename,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
        }));

        const builderPrompt = buildCoworkerDocumentBuilderMessage(
          uploadedDocuments.map((document) => document.filename),
        );
        const sendResult = await builderChat.sendMessage({
          content: builderPrompt,
          attachments,
        });

        if (sendResult.status === "missing-conversation") {
          toast.success(
            uploadedDocuments.length === 1
              ? `Uploaded ${uploadedDocuments[0]?.filename ?? "document"}.`
              : `Uploaded ${uploadedDocuments.length} documents.`,
          );
          return;
        }

        toast.success(
          sendResult.status === "sent"
            ? `Uploaded ${uploadedDocuments.length} document${uploadedDocuments.length === 1 ? "" : "s"} and sent them to the builder chat.`
            : `Uploaded ${uploadedDocuments.length} document${uploadedDocuments.length === 1 ? "" : "s"} and queued a builder update.`,
        );
      } catch (error) {
        console.error("Failed to upload coworker documents:", error);
        toast.error(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to upload documents.",
        );
      } finally {
        setIsUploadingDocuments(false);
      }
    },
    [builderChat, coworkerId, uploadCoworkerDocument],
  );

  const deleteDocument = useCallback(
    async (document: CoworkerDocumentRecord) => {
      setDeletingDocumentIds((current) =>
        current.includes(document.id) ? current : [...current, document.id],
      );

      try {
        await deleteCoworkerDocument.mutateAsync({ id: document.id });

        const sendResult = await builderChat.sendMessage({
          content: buildCoworkerDocumentRemovalBuilderMessage([document.filename]),
        });

        if (sendResult.status === "missing-conversation") {
          toast.success(`Removed ${document.filename}.`);
          return;
        }

        toast.success(
          sendResult.status === "sent"
            ? `Removed ${document.filename} and updated the builder chat.`
            : `Removed ${document.filename} and queued a builder update.`,
        );
      } catch (error) {
        console.error("Failed to delete coworker document:", error);
        toast.error(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to delete document.",
        );
      } finally {
        setDeletingDocumentIds((current) => current.filter((id) => id !== document.id));
      }
    },
    [builderChat, deleteCoworkerDocument],
  );

  const downloadDocument = useCallback(
    async (document: CoworkerDocumentRecord) => {
      setDownloadingDocumentIds((current) =>
        current.includes(document.id) ? current : [...current, document.id],
      );

      try {
        const { url, filename } = await getCoworkerDocumentUrl.mutateAsync({ id: document.id });
        const link = window.document.createElement("a");
        link.href = url;
        link.download = filename;
        link.target = "_blank";
        window.document.body.appendChild(link);
        link.click();
        window.document.body.removeChild(link);
      } catch (error) {
        console.error("Failed to download coworker document:", error);
        toast.error(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to download document.",
        );
      } finally {
        setDownloadingDocumentIds((current) => current.filter((id) => id !== document.id));
      }
    },
    [getCoworkerDocumentUrl],
  );

  return {
    isUploadingDocuments,
    deletingDocumentIds,
    downloadingDocumentIds,
    uploadDocuments,
    deleteDocument,
    downloadDocument,
  };
}
