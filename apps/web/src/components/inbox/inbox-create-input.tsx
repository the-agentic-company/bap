// oxlint-disable jsx-a11y/control-has-associated-label

import { T, useGT } from "gt-react";
import { Loader2, Paperclip, Plus, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { AttachmentData } from "@/components/prompt-bar";
import { Button } from "@/components/ui/button";
import { uploadFileAsset } from "@/orpc/hooks/file-assets";

type CoworkerOption = {
  id: string;
  name: string;
};

type Props = {
  coworkers: CoworkerOption[];
  onSubmit: (input: {
    coworkerId: string;
    message: string;
    attachments: AttachmentData[];
  }) => Promise<void> | void;
  isSubmitting?: boolean;
};

type AttachmentUploadState = {
  localId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "ready" | "failed";
  progress: number;
  fileAssetId?: string;
  error?: string;
};

const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const MAX_FILES = 10;

function createLocalAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isReadyAttachment(
  attachment: AttachmentUploadState,
): attachment is AttachmentUploadState & {
  fileAssetId: string;
} {
  return attachment.status === "ready" && typeof attachment.fileAssetId === "string";
}

function toSubmitAttachment(
  attachment: AttachmentUploadState & { fileAssetId: string },
): AttachmentData {
  return {
    fileAssetId: attachment.fileAssetId,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
}

export function InboxCreateInput({ coworkers, onSubmit, isSubmitting }: Props) {
  const t = useGT();

  const [message, setMessage] = useState("");
  const [selectedCoworkerId, setSelectedCoworkerId] = useState(coworkers[0]?.id ?? "");
  const [attachments, setAttachments] = useState<AttachmentUploadState[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readyAttachments = attachments.filter(isReadyAttachment).map(toSubmitAttachment);
  const hasUnreadyAttachments = attachments.some((attachment) => attachment.status !== "ready");

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!selectedCoworkerId || !trimmed || hasUnreadyAttachments) {
      return;
    }

    await onSubmit({
      coworkerId: selectedCoworkerId,
      message: trimmed,
      attachments: readyAttachments,
    });
    setMessage("");
    setAttachments([]);
  }, [hasUnreadyAttachments, message, onSubmit, readyAttachments, selectedCoworkerId]);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handleMessageChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(event.target.value);
  }, []);
  const handleCoworkerChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCoworkerId(event.target.value);
  }, []);
  const handleSubmitClick = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const handleFilesChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length === 0) {
        return;
      }

      const slotsRemaining = Math.max(0, MAX_FILES - attachments.length);
      const selectedFiles = files.slice(0, slotsRemaining);
      const nextAttachments = selectedFiles.map((file): AttachmentUploadState => {
        const mimeType = file.type || "application/octet-stream";
        return {
          localId: createLocalAttachmentId(),
          name: file.name,
          mimeType,
          sizeBytes: file.size,
          status: file.size > MAX_FILE_SIZE ? "failed" : "uploading",
          progress: 0,
          error: file.size > MAX_FILE_SIZE ? t("File is over 1 GB") : undefined,
        };
      });

      setAttachments((current) => [...current, ...nextAttachments]);
      nextAttachments.forEach((attachment, index) => {
        if (attachment.status === "failed") {
          return;
        }
        const file = selectedFiles[index];
        void uploadFileAsset(file, {
          onProgress: ({ percent }) => {
            setAttachments((current) =>
              current.map((item) =>
                item.localId === attachment.localId ? { ...item, progress: percent } : item,
              ),
            );
          },
        })
          .then((result) => {
            setAttachments((current) =>
              current.map((item) =>
                item.localId === attachment.localId
                  ? {
                      ...item,
                      status: "ready",
                      progress: 100,
                      fileAssetId: result.id,
                      name: result.filename,
                      mimeType: result.mimeType,
                      sizeBytes: result.sizeBytes,
                    }
                  : item,
              ),
            );
          })
          .catch((error) => {
            setAttachments((current) =>
              current.map((item) =>
                item.localId === attachment.localId
                  ? {
                      ...item,
                      status: "failed",
                      error: error instanceof Error ? error.message : t("Upload failed"),
                    }
                  : item,
              ),
            );
          });
      });
      event.target.value = "";
    },
    [attachments.length, t],
  );

  const handleRemoveAttachment = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const targetId = event.currentTarget.dataset.attachmentId;
    if (!targetId) {
      return;
    }
    setAttachments((current) => current.filter((attachment) => attachment.localId !== targetId));
  }, []);

  const handleKeyDown = useCallback(
    async (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        await handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="space-y-3 px-5 py-3.5">
      <div className="flex items-center gap-3">
        <Plus className="text-muted-foreground/40 h-4 w-4 shrink-0" />
        <input
          type="text"
          value={message}
          onChange={handleMessageChange}
          onKeyDown={handleKeyDown}
          placeholder={t("Trigger a coworker manually...")}
          className="text-foreground placeholder:text-muted-foreground/40 h-7 flex-1 bg-transparent text-sm outline-none"
          disabled={isSubmitting || coworkers.length === 0}
        />
        <select
          value={selectedCoworkerId}
          onChange={handleCoworkerChange}
          disabled={isSubmitting || coworkers.length === 0}
          className="bg-background text-foreground border-border/50 h-8 rounded-md border px-2.5 text-[12px] outline-none"
        >
          {coworkers.length === 0 ? (
            <option value="">
              <T>No active coworkers</T>
            </option>
          ) : null}
          {coworkers.map((coworker) => (
            <option key={coworker.id} value={coworker.id}>
              {coworker.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={handleAttachClick}
          disabled={isSubmitting || coworkers.length === 0 || attachments.length >= MAX_FILES}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8"
          onClick={handleSubmitClick}
          disabled={
            isSubmitting ||
            coworkers.length === 0 ||
            !message.trim() ||
            !selectedCoworkerId ||
            hasUnreadyAttachments
          }
        >
          <T>Run</T>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFilesChange}
        />
      </div>

      {attachments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.localId}
              className="bg-secondary text-secondary-foreground flex items-center gap-2 rounded-md px-2 py-1 text-[11px]"
            >
              {attachment.status === "uploading" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Paperclip className="h-3 w-3" />
              )}
              <span className="max-w-[200px] truncate">
                {attachment.name}
                {attachment.status === "uploading" ? ` ${attachment.progress}%` : ""}
              </span>
              {attachment.status === "failed" ? (
                <span className="max-w-[160px] truncate text-destructive">
                  {attachment.error ?? t("Upload failed")}
                </span>
              ) : null}
              <button
                type="button"
                data-attachment-id={attachment.localId}
                onClick={handleRemoveAttachment}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
