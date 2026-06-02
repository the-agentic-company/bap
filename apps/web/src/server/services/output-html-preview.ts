import { downloadFromS3 } from "@cmdclaw/core/server/storage/s3-client";

export const OUTPUT_HTML_PREVIEW_FILENAME = "output.html";
export const OUTPUT_HTML_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export type OutputHtmlPreviewErrorCode =
  | "not_found"
  | "invalid_filename"
  | "invalid_mime"
  | "missing_storage"
  | "too_large";

export class OutputHtmlPreviewError extends Error {
  constructor(
    public readonly code: OutputHtmlPreviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OutputHtmlPreviewError";
  }
}

type SandboxFileForPreview = {
  filename: string;
  mimeType: string | null;
  storageKey: string | null;
  sizeBytes: number | null;
  conversation: {
    userId: string | null;
    workspaceId: string | null;
  };
};

export async function loadOutputHtmlPreview(params: {
  file: SandboxFileForPreview | null | undefined;
  userId: string;
  workspaceId: string;
}): Promise<{
  html: string;
  filename: typeof OUTPUT_HTML_PREVIEW_FILENAME;
  sizeBytes: number | null;
}> {
  const { file, userId, workspaceId } = params;
  if (
    !file ||
    file.conversation.userId !== userId ||
    file.conversation.workspaceId !== workspaceId
  ) {
    throw new OutputHtmlPreviewError("not_found", "File not found");
  }

  if (file.filename !== OUTPUT_HTML_PREVIEW_FILENAME) {
    throw new OutputHtmlPreviewError("invalid_filename", "File is not previewable");
  }

  if (!isPreviewableHtmlMimeType(file.mimeType)) {
    throw new OutputHtmlPreviewError("invalid_mime", "File is not a previewable HTML document");
  }

  if (!file.storageKey) {
    throw new OutputHtmlPreviewError("missing_storage", "File not uploaded");
  }

  if (file.sizeBytes !== null && file.sizeBytes > OUTPUT_HTML_PREVIEW_MAX_BYTES) {
    throw new OutputHtmlPreviewError("too_large", "File is too large to preview");
  }

  const body = await downloadFromS3(file.storageKey);
  if (body.length > OUTPUT_HTML_PREVIEW_MAX_BYTES) {
    throw new OutputHtmlPreviewError("too_large", "File is too large to preview");
  }

  return {
    html: body.toString("utf8"),
    filename: OUTPUT_HTML_PREVIEW_FILENAME,
    sizeBytes: file.sizeBytes,
  };
}

function isPreviewableHtmlMimeType(mimeType: string | null): boolean {
  if (!mimeType) {
    return false;
  }
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim();
  return normalized === "text/html" || normalized === "application/xhtml+xml";
}
