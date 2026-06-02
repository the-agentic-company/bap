import type { Message, SandboxFileData } from "./message-list";

type DoneArtifactsForOutputPreview = {
  sandboxFiles?: SandboxFileData[];
};

type LatestOutputHtmlInput =
  | Message[]
  | {
      messages?: Message[];
      persistedSandboxFiles?: SandboxFileData[];
      doneArtifacts?: DoneArtifactsForOutputPreview | null;
    };

export function isOutputHtmlSandboxFile(file: SandboxFileData): boolean {
  return file.filename === "output.html";
}

function findLatestOutputHtmlFromFiles(
  files: SandboxFileData[] | undefined,
): SandboxFileData | null {
  for (let fileIndex = (files?.length ?? 0) - 1; fileIndex >= 0; fileIndex -= 1) {
    const file = files?.[fileIndex];
    if (file && isOutputHtmlSandboxFile(file)) {
      return file;
    }
  }

  return null;
}

export function findLatestOutputHtmlFile(input: LatestOutputHtmlInput): SandboxFileData | null {
  if (!Array.isArray(input)) {
    const doneArtifactFile = findLatestOutputHtmlFromFiles(input.doneArtifacts?.sandboxFiles);
    if (doneArtifactFile) {
      return doneArtifactFile;
    }

    const persistedFile = findLatestOutputHtmlFromFiles(input.persistedSandboxFiles);
    if (persistedFile) {
      return persistedFile;
    }
  }

  const messages = Array.isArray(input) ? input : (input.messages ?? []);
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const file = findLatestOutputHtmlFromFiles(messages[messageIndex]?.sandboxFiles);
    if (file) {
      return file;
    }
  }

  return null;
}
