"use client";

import { Download, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useDownloadSandboxFile, useOutputHtmlPreview } from "@/orpc/hooks";
import type { SandboxFileData } from "./message-list";

type Props = {
  outputFile: SandboxFileData;
  onClose: () => void;
};

function getPreviewErrorCopy(error: unknown): { title: string; description: string } {
  const record =
    error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = typeof record?.message === "string" ? record.message.toLowerCase() : "";

  if (message.includes("too large")) {
    return {
      title: "output.html is too large to preview",
      description: "Download output.html to inspect the generated file.",
    };
  }

  if (code === "NOT_FOUND" || message.includes("not found") || message.includes("not uploaded")) {
    return {
      title: "output.html is no longer available",
      description: "The generated file could not be loaded from storage.",
    };
  }

  return {
    title: "Preview unavailable",
    description: "Download output.html to inspect the generated file.",
  };
}

export function OutputHtmlPreviewPanel({ outputFile, onClose }: Props) {
  const preview = useOutputHtmlPreview(outputFile.fileId);
  const { mutateAsync: downloadSandboxFile, isPending: isDownloading } = useDownloadSandboxFile();

  const handleRefresh = useCallback(() => {
    void preview.refetch();
  }, [preview]);

  const handleDownload = useCallback(async () => {
    const result = await downloadSandboxFile(outputFile.fileId);
    const link = document.createElement("a");
    link.href = result.url;
    link.download = outputFile.filename;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [downloadSandboxFile, outputFile.fileId, outputFile.filename]);

  return (
    <div className="bg-background flex min-h-0 flex-1 flex-col">
      <div className="border-border/70 flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">output.html</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleRefresh}
          disabled={preview.isFetching}
          aria-label="Refresh output preview"
        >
          {preview.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleDownload}
          disabled={isDownloading}
          aria-label="Download output.html"
        >
          {isDownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          aria-label="Close output preview"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="bg-muted/30 min-h-0 flex-1">
        {preview.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : preview.isError ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="max-w-sm space-y-2">
              {(() => {
                const copy = getPreviewErrorCopy(preview.error);
                return (
                  <>
                    <p className="text-sm font-medium">{copy.title}</p>
                    <p className="text-muted-foreground text-xs">{copy.description}</p>
                  </>
                );
              })()}
            </div>
          </div>
        ) : (
          <iframe
            title="output.html preview"
            className="bg-background h-full w-full border-0"
            sandbox="allow-scripts allow-forms"
            srcDoc={preview.data?.html ?? ""}
          />
        )}
      </div>
    </div>
  );
}
