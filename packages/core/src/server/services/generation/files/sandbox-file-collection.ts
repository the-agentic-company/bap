import path from "path";
import type { ContentPart } from "@cmdclaw/db/schema";
import type { SandboxBackend } from "../../../sandbox/types";
import {
  collectNewSandboxFiles,
  uploadSandboxFile,
  type SandboxFileRecord,
} from "../../sandbox-file-service";

type AutoCollectedSandboxFile = {
  path: string;
  content: Buffer;
};

export type MentionedSandboxFileCollectionResult = {
  discoveredCount: number;
  exposedCount: number;
  uploadedCount: number;
  uploadedFileIds: string[];
};

function extractFinalAnswerTextForFileHeuristic(input: {
  assistantContent: string;
  contentParts: ContentPart[];
}): string {
  const textFromParts = input.contentParts.flatMap((part) => {
    if (!part || typeof part !== "object") {
      return [];
    }
    const record = part as { type?: unknown; text?: unknown; content?: unknown };
    if (record.type === "text" && typeof record.text === "string") {
      return [record.text];
    }
    if (record.type === "system" && typeof record.content === "string") {
      return [record.content];
    }
    return [];
  });

  const segments = [input.assistantContent, ...textFromParts].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return segments.join("\n");
}

function filterAutoCollectedFilesMentionedInAnswer(
  files: AutoCollectedSandboxFile[],
  finalAnswerText: string,
): AutoCollectedSandboxFile[] {
  // This heuristic is only for auto-collected files discovered after generation.
  // Files explicitly exposed via the send_file tool bypass this path and are always kept.
  const haystack = finalAnswerText.toLowerCase();
  if (!haystack.trim()) {
    return [];
  }

  return files.filter((file) => {
    const filename = path.basename(file.path).toLowerCase();
    const fullPath = file.path.toLowerCase();
    return haystack.includes(filename) || haystack.includes(fullPath);
  });
}

function isOutputHtmlPath(filePath: string): boolean {
  return path.basename(filePath) === "output.html";
}

function compareOutputHtmlCandidates(
  left: AutoCollectedSandboxFile,
  right: AutoCollectedSandboxFile,
): number {
  if (left.path === "/app/output.html") {
    return -1;
  }
  if (right.path === "/app/output.html") {
    return 1;
  }
  return left.path.localeCompare(right.path);
}

export function selectAutoCollectedFilesForExposure(input: {
  files: AutoCollectedSandboxFile[];
  finalAnswerText: string;
}): AutoCollectedSandboxFile[] {
  const selected = new Map<string, AutoCollectedSandboxFile>();

  for (const file of filterAutoCollectedFilesMentionedInAnswer(
    input.files,
    input.finalAnswerText,
  )) {
    selected.set(file.path, file);
  }

  const outputHtml = input.files.filter((file) => isOutputHtmlPath(file.path));
  const preferredOutputHtml = outputHtml.sort(compareOutputHtmlCandidates)[0];
  if (preferredOutputHtml) {
    selected.set(preferredOutputHtml.path, preferredOutputHtml);
  }

  return Array.from(selected.values());
}

export async function collectMentionedSandboxFiles(input: {
  sandbox: SandboxBackend;
  markerTime: number;
  conversationId: string;
  assistantContent: string;
  contentParts: ContentPart[];
  excludePaths: string[];
  onCollectionSummary?: (summary: { discoveredCount: number; exposedCount: number }) => void;
  onUploadedFile?: (file: SandboxFileRecord & { path: string }) => void;
  onUploadError?: (filePath: string, error: unknown) => void;
}): Promise<MentionedSandboxFileCollectionResult> {
  const newFiles = await collectNewSandboxFiles(input.sandbox, input.markerTime, input.excludePaths);
  const filesToUpload = selectAutoCollectedFilesForExposure({
    files: newFiles,
    finalAnswerText: extractFinalAnswerTextForFileHeuristic(input),
  });

  input.onCollectionSummary?.({
    discoveredCount: newFiles.length,
    exposedCount: filesToUpload.length,
  });

  const uploadedFileIds: string[] = [];
  await Promise.all(
    filesToUpload.map(async (file) => {
      try {
        const fileRecord = await uploadSandboxFile({
          path: file.path,
          content: file.content,
          conversationId: input.conversationId,
        });
        uploadedFileIds.push(fileRecord.id);
        input.onUploadedFile?.({
          ...fileRecord,
          path: file.path,
        });
      } catch (error) {
        input.onUploadError?.(file.path, error);
      }
    }),
  );

  return {
    discoveredCount: newFiles.length,
    exposedCount: filesToUpload.length,
    uploadedCount: uploadedFileIds.length,
    uploadedFileIds,
  };
}
