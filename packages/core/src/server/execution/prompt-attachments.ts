import type { RuntimePromptPart } from "../sandbox/core/types";
import { writeCoworkerDocumentsToSandbox } from "../sandbox/prep/coworker-documents-prep";

export type RuntimePromptAttachment = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

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
  attachments?: RuntimePromptAttachment[] | null;
  userStagedFilePaths?: Set<string>;
  runStep: StagePromptAttachmentsStep;
  logAttachmentWriteError?: (sandboxPath: string, error: unknown) => void;
}): Promise<StageRuntimePromptAttachmentsResult> {
  const promptParts: RuntimePromptPart[] = [];
  let stagedCoworkerDocumentCount = 0;
  let stagedUploadCount = 0;
  let stagedUploadFailureCount = 0;

  const coworkerId = input.coworkerId;
  if (coworkerId) {
    const coworkerDocumentPaths = await input.runStep(
      "coworker_docs_stage",
      "stageCoworkerDocsMs",
      async () => await writeCoworkerDocumentsToSandbox(input.runtimeSandbox, coworkerId),
    );
    if (coworkerDocumentPaths.length > 0) {
      stagedCoworkerDocumentCount = coworkerDocumentPaths.length;
      promptParts.push({
        type: "text",
        text: [
          "Persistent coworker documents are available in the sandbox for this run:",
          ...coworkerDocumentPaths.map((filePath) => `- ${filePath}`),
          "Read them from disk when they are relevant to the task.",
        ].join("\n"),
      });
    }
  }

  if (input.attachments && input.attachments.length > 0) {
    await input.runStep("attachments_stage", "stageAttachmentsMs", async () => {
      await Promise.all(
        input.attachments!.map(async (attachment) => {
          const sandboxPath = `/home/user/uploads/${attachment.name}`;
          try {
            const base64Data = attachment.dataUrl.split(",")[1] || "";
            const buffer = Buffer.from(base64Data, "base64");
            await input.runtimeSandbox.writeFile(
              sandboxPath,
              buffer.buffer.slice(
                buffer.byteOffset,
                buffer.byteOffset + buffer.byteLength,
              ) as ArrayBuffer,
            );
            input.userStagedFilePaths?.add(sandboxPath);
            promptParts.push({
              type: "text",
              text: `The user uploaded a file: ${sandboxPath} (${attachment.mimeType}).`,
            });
            stagedUploadCount += 1;
            if (attachment.mimeType.startsWith("image/")) {
              promptParts.push({
                type: "file",
                mime: attachment.mimeType,
                url: attachment.dataUrl,
                filename: attachment.name,
              });
            }
          } catch (error) {
            stagedUploadFailureCount += 1;
            input.logAttachmentWriteError?.(sandboxPath, error);
            promptParts.push({
              type: "text",
              text: `The user tried to upload a file "${attachment.name}" but it could not be written to the sandbox.`,
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
