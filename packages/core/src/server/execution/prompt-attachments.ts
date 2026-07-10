import { db } from "@bap/db/client";
import {
  buildCoworkerDocumentAttachmentPrompt,
  buildUserUploadedFilePrompt,
  buildUserUploadFailurePrompt,
} from "@bap/prompts";
import type { RuntimePromptPart } from "../sandbox/core/types";
import { writeCoworkerDocumentsToSandbox } from "../sandbox/prep/coworker-documents-prep";
import { assertReadyFileAssetsForWorkspace } from "../services/file-asset-service";
import {
  isFileAssetUserAttachment,
  type UserFileAttachment,
} from "../services/generation/attachments";
import { downloadFromS3 } from "../storage/s3-client";

export type RuntimePromptAttachment = UserFileAttachment;

type RuntimePromptAttachmentSandbox = {
  exec(
    command: string,
    opts?: {
      timeoutMs?: number;
      env?: Record<string, string>;
      background?: boolean;
      onStderr?: (chunk: string) => void;
    },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  writeFile(path: string, contents: string | ArrayBuffer): Promise<void>;
};

type StagePromptAttachmentsStep = <T>(
  stepName: string,
  metricName: string,
  fn: () => Promise<T>,
) => Promise<T>;

export type StageRuntimePromptAttachmentsResult = {
  promptParts: RuntimePromptPart[];
  stagedCoworkerDocumentCount: number;
  stagedUploadCount: number;
  stagedUploadFailureCount: number;
};

export async function stageRuntimePromptAttachments(input: {
  runtimeSandbox: RuntimePromptAttachmentSandbox;
  coworkerId?: string | null;
  coworkerDocumentsMountedPath?: string | null;
  workspaceId?: string | null;
  attachments?: RuntimePromptAttachment[] | null;
  userStagedFilePaths?: Set<string>;
  runStep: StagePromptAttachmentsStep;
  logAttachmentWriteError?: (sandboxPath: string, error: unknown) => void;
}): Promise<StageRuntimePromptAttachmentsResult> {
  const promptParts: RuntimePromptPart[] = [];
  let stagedCoworkerDocumentCount = 0;
  let stagedUploadCount = 0;
  let stagedUploadFailureCount = 0;
  const usedUploadFilenames = new Set<string>();

  const allocateSandboxPath = (filename: string): string => {
    const sanitized = sanitizeUploadFilename(filename);
    const dotIndex = sanitized.lastIndexOf(".");
    const hasExtension = dotIndex > 0 && dotIndex < sanitized.length - 1;
    const base = hasExtension ? sanitized.slice(0, dotIndex) : sanitized;
    const extension = hasExtension ? sanitized.slice(dotIndex) : "";
    let candidate = sanitized;
    let suffix = 2;
    while (usedUploadFilenames.has(candidate.toLowerCase())) {
      candidate = `${base} (${suffix})${extension}`;
      suffix += 1;
    }
    usedUploadFilenames.add(candidate.toLowerCase());
    return `/home/user/uploads/${candidate}`;
  };

  const coworkerId = input.coworkerId;
  if (coworkerId) {
    if (input.coworkerDocumentsMountedPath) {
      promptParts.push({
        type: "text",
        text: buildCoworkerDocumentAttachmentPrompt([input.coworkerDocumentsMountedPath]),
      });
    } else {
      const coworkerDocumentPaths = await input.runStep(
        "coworker_docs_stage",
        "stageCoworkerDocsMs",
        async () => await writeCoworkerDocumentsToSandbox(input.runtimeSandbox, coworkerId),
      );
      if (coworkerDocumentPaths.length > 0) {
        stagedCoworkerDocumentCount = coworkerDocumentPaths.length;
        promptParts.push({
          type: "text",
          text: buildCoworkerDocumentAttachmentPrompt(coworkerDocumentPaths),
        });
      }
    }
  }

  if (input.attachments && input.attachments.length > 0) {
    await input.runStep("attachments_stage", "stageAttachmentsMs", async () => {
      await Promise.all(
        input.attachments!.map(async (attachment) => {
          let sandboxPath = "/home/user/uploads/upload";
          try {
            if (!isFileAssetUserAttachment(attachment)) {
              throw new Error("Invalid runtime prompt attachment");
            }
            if (!input.workspaceId) {
              throw new Error("Workspace is required to stage File Asset attachments");
            }
            const [asset] = await assertReadyFileAssetsForWorkspace({
              database: db,
              workspaceId: input.workspaceId,
              fileAssetIds: [attachment.fileAssetId],
            });
            sandboxPath = allocateSandboxPath(asset.filename);
            const buffer = await downloadFromS3(asset.storageKey);
            await writeBufferToSandbox(input.runtimeSandbox, sandboxPath, buffer);
            input.userStagedFilePaths?.add(sandboxPath);
            promptParts.push({
              type: "text",
              text: buildUserUploadedFilePrompt({
                sandboxPath,
                mimeType: asset.mimeType,
              }),
            });
            stagedUploadCount += 1;
          } catch (error) {
            stagedUploadFailureCount += 1;
            input.logAttachmentWriteError?.(sandboxPath, error);
            promptParts.push({
              type: "text",
              text: buildUserUploadFailurePrompt(attachment.name ?? "uploaded file"),
            });
          }
        }),
      );
    });
  }

  return {
    promptParts,
    stagedCoworkerDocumentCount,
    stagedUploadCount,
    stagedUploadFailureCount,
  };
}

function sanitizeUploadFilename(filename: string): string {
  const sanitized = filename
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^a-zA-Z0-9._ -]/g, "_")
    .trim();
  return sanitized || "upload";
}

async function writeBufferToSandbox(
  runtimeSandbox: RuntimePromptAttachmentSandbox,
  sandboxPath: string,
  buffer: Buffer,
): Promise<void> {
  await runtimeSandbox.writeFile(
    sandboxPath,
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
}
