import { downloadFromS3 } from "@bap/core/server/storage/s3-client";

export const AGENTIC_APP_FILENAME = "output.html";
export const AGENTIC_APP_MAX_BYTES = 2 * 1024 * 1024;

export type AgenticAppHtmlErrorCode =
  | "not_found"
  | "invalid_filename"
  | "invalid_mime"
  | "missing_storage"
  | "too_large";

export class AgenticAppHtmlError extends Error {
  constructor(
    public readonly code: AgenticAppHtmlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgenticAppHtmlError";
  }
}

type SandboxFileForAgenticApp = {
  filename: string;
  mimeType: string | null;
  storageKey: string | null;
  sizeBytes: number | null;
  conversation: {
    userId: string | null;
    workspaceId: string | null;
  };
};

export async function loadAgenticAppHtml(params: {
  file: SandboxFileForAgenticApp | null | undefined;
  userId: string;
  workspaceId: string;
  allowSharedAutomatedRun?: boolean;
}): Promise<{
  html: string;
  filename: typeof AGENTIC_APP_FILENAME;
  sizeBytes: number | null;
}> {
  const { file, userId, workspaceId } = params;
  if (
    !file ||
    (file.conversation.userId !== userId && !params.allowSharedAutomatedRun) ||
    file.conversation.workspaceId !== workspaceId
  ) {
    throw new AgenticAppHtmlError("not_found", "File not found");
  }

  if (file.filename !== AGENTIC_APP_FILENAME) {
    throw new AgenticAppHtmlError("invalid_filename", "File is not an Agentic-App");
  }

  if (!isAgenticAppHtmlMimeType(file.mimeType)) {
    throw new AgenticAppHtmlError("invalid_mime", "File is not an Agentic-App HTML document");
  }

  if (!file.storageKey) {
    throw new AgenticAppHtmlError("missing_storage", "File not uploaded");
  }

  if (file.sizeBytes !== null && file.sizeBytes > AGENTIC_APP_MAX_BYTES) {
    throw new AgenticAppHtmlError("too_large", "File is too large to display");
  }

  const body = await downloadFromS3(file.storageKey);
  if (body.length > AGENTIC_APP_MAX_BYTES) {
    throw new AgenticAppHtmlError("too_large", "File is too large to display");
  }

  return {
    html: body.toString("utf8"),
    filename: AGENTIC_APP_FILENAME,
    sizeBytes: file.sizeBytes,
  };
}

function isAgenticAppHtmlMimeType(mimeType: string | null): boolean {
  if (!mimeType) {
    return false;
  }
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim();
  return normalized === "text/html" || normalized === "application/xhtml+xml";
}
