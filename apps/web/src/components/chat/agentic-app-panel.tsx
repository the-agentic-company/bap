import { T, useGT } from "gt-react";
import { Download, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { triggerBrowserDownload } from "@/lib/download-file";
import type { AgenticAppHtmlErrorCode } from "@/server/services/agentic-app-html";
import { useAgenticAppHtml, useDownloadSandboxFile } from "@/orpc/hooks/conversation";
import type { SandboxFileData } from "./message-list";
import { useAgenticAppPromptBridge } from "./use-agentic-app-prompt-bridge";

type Props = {
  outputFile: SandboxFileData;
  onClose: () => void;
  onSendPrompt: (prompt: string) => Promise<unknown>;
};

function readAgenticAppErrorCode(error: unknown): AgenticAppHtmlErrorCode | "" {
  const record = error && typeof error === "object" ? (error as { data?: unknown }) : null;
  const data =
    record?.data && typeof record.data === "object"
      ? (record.data as { agenticAppCode?: unknown })
      : null;
  const code = data?.agenticAppCode;
  return typeof code === "string" ? (code as AgenticAppHtmlErrorCode) : "";
}

function getAgenticAppErrorCopy(
  error: unknown,
  t: (text: string) => string,
): { title: string; description: string } {
  const code = readAgenticAppErrorCode(error);

  if (code === "too_large") {
    return {
      title: t("output.html is too large to display"),
      description: t("Download output.html to inspect the generated file."),
    };
  }

  if (code === "not_found" || code === "missing_storage") {
    return {
      title: t("output.html is no longer available"),
      description: t("The generated file could not be loaded from storage."),
    };
  }

  return {
    title: t("Agentic-App unavailable"),
    description: t("Download output.html to inspect the generated file."),
  };
}

export function AgenticAppPanel({ outputFile, onClose, onSendPrompt }: Props) {
  const t = useGT();

  const appHtml = useAgenticAppHtml(outputFile.fileId);
  const { mutateAsync: downloadSandboxFile, isPending: isDownloading } = useDownloadSandboxFile();
  const { iframeRef, handleIframeLoad, recordGesture } = useAgenticAppPromptBridge({
    outputFileId: outputFile.fileId,
    onSendPrompt,
  });

  const handleRefresh = useCallback(() => {
    void appHtml.refetch();
  }, [appHtml]);

  const handleDownload = useCallback(async () => {
    const result = await downloadSandboxFile(outputFile.fileId);
    await triggerBrowserDownload(result.url, outputFile.filename);
  }, [downloadSandboxFile, outputFile.fileId, outputFile.filename]);

  return (
    <div
      className="bg-background flex min-h-0 flex-1 flex-col"
      onPointerDownCapture={recordGesture}
      onPointerMoveCapture={recordGesture}
      onKeyDownCapture={recordGesture}
    >
      <div className="border-border/70 flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            <T>output.html</T>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleRefresh}
          disabled={appHtml.isFetching}
          aria-label={t("Refresh Agentic-App")}
        >
          {appHtml.isFetching ? (
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
          aria-label={t("Download output.html")}
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
          aria-label={t("Close Agentic-App")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="bg-muted/30 min-h-0 flex-1">
        {appHtml.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : appHtml.isError ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div className="max-w-sm space-y-2">
              {(() => {
                const copy = getAgenticAppErrorCopy(appHtml.error, t);
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
            ref={iframeRef}
            title={t("output.html Agentic-App")}
            className="bg-background h-full w-full border-0"
            sandbox="allow-scripts allow-forms"
            srcDoc={appHtml.data?.html ?? ""}
            onLoad={handleIframeLoad}
            onPointerDownCapture={recordGesture}
            onPointerMoveCapture={recordGesture}
            onKeyDownCapture={recordGesture}
          />
        )}
      </div>
    </div>
  );
}
