// oxlint-disable jsx-a11y/control-has-associated-label

import { useGT } from "gt-react";
import { Send, Square, Mic, Paperclip, X, Clock3, Loader2 } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { AppImage } from "@/components/chat/app-image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFileAsset } from "@/orpc/hooks/file-assets";
import { getChatDraftKey, useChatDraftStore } from "./chat-draft-store";

type AttachmentData = {
  fileAssetId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
};

type AttachmentUploadState = {
  localId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "ready" | "failed";
  progress: number;
  fileAssetId?: string;
  previewUrl?: string;
  error?: string;
};

const MAX_FILE_SIZE = 1024 * 1024 * 1024;
const MAX_FILES = 10;
const CHAT_INPUT_MAX_HEIGHT = 260;

type Props = {
  onSend: (content: string, attachments?: AttachmentData[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  isRecording?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  prefillRequest?: {
    id: string;
    text: string;
    mode?: "replace" | "append";
  } | null;
  conversationId?: string;
};

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
    previewUrl: attachment.previewUrl,
  };
}

function revokeAttachmentPreview(attachment: AttachmentUploadState): void {
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

export function ChatInput({
  onSend,
  onStop,
  disabled,
  isStreaming,
  isRecording,
  onStartRecording,
  onStopRecording,
  prefillRequest,
  conversationId,
}: Props) {
  const t = useGT();

  const draftKey = getChatDraftKey(conversationId);
  const readDraft = useChatDraftStore((state) => state.readDraft);
  const upsertDraft = useChatDraftStore((state) => state.upsertDraft);
  const isDraftStoreHydrated = useChatDraftStore((state) => state.hasHydrated);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentUploadState[]>([]);
  const attachmentsRef = useRef<AttachmentUploadState[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(
    () => () => {
      attachmentsRef.current.forEach(revokeAttachmentPreview);
    },
    [],
  );

  useEffect(() => {
    if (!isDraftStoreHydrated) {
      return;
    }
    const draft = readDraft(draftKey);
    setValue(draft?.text ?? "");
    setAttachments((current) => {
      current.forEach(revokeAttachmentPreview);
      return [];
    });
    setLoadedDraftKey(draftKey);
  }, [draftKey, isDraftStoreHydrated, readDraft]);

  useEffect(() => {
    if (!isDraftStoreHydrated || loadedDraftKey !== draftKey) {
      return;
    }
    upsertDraft(draftKey, value);
  }, [draftKey, isDraftStoreHydrated, loadedDraftKey, upsertDraft, value]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const nextHeight = Math.min(textarea.scrollHeight, CHAT_INPUT_MAX_HEIGHT);
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? "auto" : "hidden";
    }
  }, [value]);

  useEffect(() => {
    if (!prefillRequest) {
      return;
    }
    setValue((previousValue) => {
      const nextValue =
        prefillRequest.mode === "append"
          ? `${previousValue}${previousValue && !/\s$/.test(previousValue) ? " " : ""}${prefillRequest.text}`
          : prefillRequest.text;

      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextValue.length, nextValue.length);
      });

      return nextValue;
    });
  }, [prefillRequest]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const slotsRemaining = Math.max(0, MAX_FILES - attachments.length);
      const selectedFiles = fileArray.slice(0, slotsRemaining);
      const nextAttachments = selectedFiles.map((file): AttachmentUploadState => {
        const mimeType = file.type || "application/octet-stream";
        const previewUrl = mimeType.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        return {
          localId: createLocalAttachmentId(),
          name: file.name,
          mimeType,
          sizeBytes: file.size,
          status: file.size > MAX_FILE_SIZE ? "failed" : "uploading",
          progress: 0,
          previewUrl,
          error: file.size > MAX_FILE_SIZE ? t("File is over 1 GB") : undefined,
        };
      });

      if (nextAttachments.length === 0) {
        return;
      }

      setAttachments((prev) => [...prev, ...nextAttachments]);
      nextAttachments.forEach((attachment, index) => {
        if (attachment.status === "failed") {
          return;
        }
        const file = selectedFiles[index];
        void uploadFileAsset(file, {
          onProgress: ({ percent }) => {
            setAttachments((prev) =>
              prev.map((item) =>
                item.localId === attachment.localId ? { ...item, progress: percent } : item,
              ),
            );
          },
        })
          .then((result) => {
            setAttachments((prev) =>
              prev.map((item) =>
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
            setAttachments((prev) =>
              prev.map((item) =>
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
    },
    [attachments.length, t],
  );

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((attachment) => attachment.localId === localId);
      if (target) {
        revokeAttachmentPreview(target);
      }
      return prev.filter((attachment) => attachment.localId !== localId);
    });
  }, []);

  const readyAttachments = attachments.filter(isReadyAttachment).map(toSubmitAttachment);
  const hasUnreadyAttachments = attachments.some((attachment) => attachment.status !== "ready");

  const handleSubmit = useCallback(() => {
    const trimmedValue = value.trim();
    if ((!trimmedValue && readyAttachments.length === 0) || disabled || hasUnreadyAttachments) {
      return;
    }

    onSend(trimmedValue, readyAttachments.length > 0 ? readyAttachments : undefined);
    setAttachments((current) => {
      current.forEach(revokeAttachmentPreview);
      return [];
    });
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.overflowY = "hidden";
    }
  }, [disabled, hasUnreadyAttachments, onSend, readyAttachments, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        void addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleRemoveAttachmentClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const attachmentId = e.currentTarget.dataset.attachmentId;
      if (attachmentId) {
        removeAttachment(attachmentId);
      }
    },
    [removeAttachment],
  );

  const handleOpenFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        void addFiles(e.target.files);
      }
      e.target.value = "";
    },
    [addFiles],
  );

  const handleValueChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
  }, []);

  const handleRecordMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!disabled && !isStreaming) {
        onStartRecording?.();
      }
    },
    [disabled, isStreaming, onStartRecording],
  );

  const handleRecordMouseUp = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isRecording) {
        onStopRecording?.();
      }
    },
    [isRecording, onStopRecording],
  );

  const handleRecordMouseLeave = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isRecording) {
        onStopRecording?.();
      }
    },
    [isRecording, onStopRecording],
  );

  const handleRecordTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (!disabled && !isStreaming) {
        onStartRecording?.();
      }
    },
    [disabled, isStreaming, onStartRecording],
  );

  const handleRecordTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (isRecording) {
        onStopRecording?.();
      }
    },
    [isRecording, onStopRecording],
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-muted/50 p-2 transition-colors",
        isDragging && "border-primary bg-primary/5",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {attachments.map((a) => (
            <div
              key={a.localId}
              className="group bg-background relative flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
            >
              {a.mimeType.startsWith("image/") && a.previewUrl ? (
                <AppImage
                  src={a.previewUrl}
                  alt={a.name}
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : a.status === "uploading" ? (
                <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
              ) : (
                <Paperclip className="text-muted-foreground h-3.5 w-3.5" />
              )}
              <span className="max-w-[120px] truncate">
                {a.name}
                {a.status === "uploading" ? ` ${a.progress}%` : ""}
              </span>
              {a.status === "failed" ? (
                <span className="max-w-[120px] truncate text-destructive">
                  {a.error ?? t("Upload failed")}
                </span>
              ) : null}
              <button
                type="button"
                data-attachment-id={a.localId}
                onClick={handleRemoveAttachmentClick}
                className="hover:bg-muted ml-0.5 rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {/* Attach button */}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0"
          disabled={disabled || attachments.length >= MAX_FILES}
          onClick={handleOpenFilePicker}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          value={value}
          onChange={handleValueChange}
          onKeyDown={handleKeyDown}
          placeholder={t("Send a message...")}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none overflow-y-hidden overscroll-contain bg-transparent px-2 py-1.5 text-sm focus:outline-none disabled:opacity-50"
        />
        {onStartRecording && onStopRecording && (
          <Button
            onMouseDown={handleRecordMouseDown}
            onMouseUp={handleRecordMouseUp}
            onMouseLeave={handleRecordMouseLeave}
            onTouchStart={handleRecordTouchStart}
            onTouchEnd={handleRecordTouchEnd}
            disabled={disabled && !isRecording}
            size="icon"
            variant={isRecording ? "destructive" : "outline"}
            className={cn("h-9 w-9 touch-none", isRecording && "animate-pulse")}
          >
            <Mic className="h-4 w-4" />
          </Button>
        )}
        {isStreaming ? (
          <Button
            onClick={onStop}
            data-testid="chat-stop"
            aria-label={t("Stop generation")}
            size="icon"
            variant="destructive"
            className="h-9 w-9"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          onClick={handleSubmit}
          data-testid={isStreaming ? "chat-queue" : "chat-send"}
          aria-label={isStreaming ? "Queue message" : "Send message"}
          title={isStreaming ? "Queue next message" : "Send message"}
          disabled={
            disabled || hasUnreadyAttachments || (!value.trim() && readyAttachments.length === 0)
          }
          size="icon"
          variant={isStreaming ? "secondary" : "default"}
          className="h-9 w-9"
        >
          {isStreaming ? <Clock3 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
