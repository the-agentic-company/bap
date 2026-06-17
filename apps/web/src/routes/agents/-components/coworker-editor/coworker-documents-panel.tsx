import { T } from "gt-react";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatFileSize, formatRelativeTime } from "./coworker-editor-utils";
import type { CoworkerDocumentRecord } from "./types";

type CoworkerDocumentsPanelProps = {
  documents: CoworkerDocumentRecord[];
  isUploadingDocuments: boolean;
  deletingDocumentIds: string[];
  downloadingDocumentIds: string[];
  onUploadDocuments: (files: FileList | File[]) => void | Promise<void>;
  onDownloadDocument: (document: CoworkerDocumentRecord) => void | Promise<void>;
  onDeleteDocument: (document: CoworkerDocumentRecord) => void | Promise<void>;
};

export function CoworkerDocumentsPanel({
  documents,
  isUploadingDocuments,
  deletingDocumentIds,
  downloadingDocumentIds,
  onUploadDocuments,
  onDownloadDocument,
  onDeleteDocument,
}: CoworkerDocumentsPanelProps) {
  const [isDocumentDragActive, setIsDocumentDragActive] = useState(false);
  const documentInputRef = useRef<HTMLInputElement | null>(null);

  const handleBrowseDocuments = useCallback(() => {
    if (isUploadingDocuments) {
      return;
    }
    documentInputRef.current?.click();
  }, [isUploadingDocuments]);

  const handleDocumentInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        void onUploadDocuments(files);
      }
      event.target.value = "";
    },
    [onUploadDocuments],
  );

  const handleDocumentDragOver = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDocumentDragActive(true);
  }, []);

  const handleDocumentDragLeave = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDocumentDragActive(false);
  }, []);

  const handleDocumentDrop = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setIsDocumentDragActive(false);
      if (isUploadingDocuments) {
        return;
      }
      if (event.dataTransfer.files.length > 0) {
        void onUploadDocuments(event.dataTransfer.files);
      }
    },
    [isUploadingDocuments, onUploadDocuments],
  );

  const handleDeleteDocumentClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const documentId = event.currentTarget.dataset.documentId;
      if (!documentId) {
        return;
      }

      const document = documents.find((entry) => entry.id === documentId);
      if (!document) {
        return;
      }

      void onDeleteDocument(document);
    },
    [documents, onDeleteDocument],
  );

  const handleDownloadDocumentClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const documentId = event.currentTarget.dataset.documentId;
      if (!documentId) {
        return;
      }

      const document = documents.find((entry) => entry.id === documentId);
      if (!document) {
        return;
      }

      void onDownloadDocument(document);
    },
    [documents, onDownloadDocument],
  );

  return (
    <div className="px-4 py-3">
      <div className="space-y-3">
        <input
          ref={documentInputRef}
          type="file"
          multiple
          className="hidden"
          aria-label="Upload coworker documents"
          onChange={handleDocumentInputChange}
        />
        <DocumentDropZone
          isUploadingDocuments={isUploadingDocuments}
          isDocumentDragActive={isDocumentDragActive}
          onBrowseDocuments={handleBrowseDocuments}
          onDocumentDragOver={handleDocumentDragOver}
          onDocumentDragLeave={handleDocumentDragLeave}
          onDocumentDrop={handleDocumentDrop}
        />
        {documents.length > 0 ? (
          <div className="space-y-2">
            {documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                isDeleting={deletingDocumentIds.includes(document.id)}
                isDownloading={downloadingDocumentIds.includes(document.id)}
                onDownloadDocument={handleDownloadDocumentClick}
                onDeleteDocument={handleDeleteDocumentClick}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-4">
            <FileText className="text-muted-foreground h-4 w-4" />
            <p className="text-muted-foreground text-xs">
              <T>No documents added yet.</T>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentDropZone({
  isUploadingDocuments,
  isDocumentDragActive,
  onBrowseDocuments,
  onDocumentDragOver,
  onDocumentDragLeave,
  onDocumentDrop,
}: {
  isUploadingDocuments: boolean;
  isDocumentDragActive: boolean;
  onBrowseDocuments: () => void;
  onDocumentDragOver: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDocumentDragLeave: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDocumentDrop: (event: React.DragEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onBrowseDocuments}
      onDragOver={onDocumentDragOver}
      onDragLeave={onDocumentDragLeave}
      onDrop={onDocumentDrop}
      disabled={isUploadingDocuments}
      aria-label="Upload coworker documents"
      className={cn(
        "relative block w-full overflow-hidden rounded-[24px] border-2 border-dashed px-5 py-8 text-left transition-all",
        isDocumentDragActive
          ? "border-emerald-400 bg-emerald-50/70 shadow-[0_0_0_6px_rgba(16,185,129,0.08)]"
          : "border-muted-foreground/25 hover:border-muted-foreground/40 bg-gradient-to-br from-white to-slate-50/80",
        isUploadingDocuments && "cursor-wait opacity-80",
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.04),transparent_55%)]" />
      <div className="relative flex flex-col items-center justify-center gap-3 text-center">
        <div
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-2xl border",
            isDocumentDragActive
              ? "border-emerald-300 bg-emerald-100 text-emerald-700"
              : "border-slate-200 bg-white text-slate-500",
          )}
        >
          {isUploadingDocuments ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : (
            <Upload className="h-7 w-7" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-800">
            {isUploadingDocuments
              ? "Uploading documents and updating the builder..."
              : "Drop files here or browse from your machine"}
          </p>
          <p className="text-muted-foreground text-xs">
            <T>
              PDF, Office docs, text, CSV, and images. Uploaded files are stored for future coworker
              runs and sent to the builder chat.
            </T>
          </p>
        </div>
        <span className="border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground mt-1 inline-flex h-8 items-center justify-center rounded-full border px-4 text-xs font-medium">
          <T>Browse files</T>
        </span>
      </div>
    </button>
  );
}

function DocumentRow({
  document,
  isDownloading,
  isDeleting,
  onDownloadDocument,
  onDeleteDocument,
}: {
  document: CoworkerDocumentRecord;
  isDownloading: boolean;
  isDeleting: boolean;
  onDownloadDocument: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDeleteDocument: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="border-border/40 bg-background/70 flex items-start gap-3 rounded-2xl border px-3 py-3">
      <div className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
        <FileText className="text-muted-foreground h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900">{document.filename}</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium tracking-[0.14em] text-slate-500 uppercase">
            {document.mimeType.split("/")[0]}
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{formatFileSize(document.sizeBytes)}</span>
          <span>
            <T>Added</T> {formatRelativeTime(document.createdAt)}
          </span>
        </div>
        {document.description ? (
          <p className="text-muted-foreground text-xs">{document.description}</p>
        ) : null}
      </div>
      <div className="mt-0.5 flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground rounded-full"
          data-document-id={document.id}
          onClick={onDownloadDocument}
          disabled={isDownloading}
          aria-label={`Download ${document.filename}`}
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive rounded-full"
          data-document-id={document.id}
          onClick={onDeleteDocument}
          disabled={isDeleting}
          aria-label={`Delete ${document.filename}`}
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
