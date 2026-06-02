import type { Message, SandboxFileData } from "./message-list";

export function isOutputHtmlSandboxFile(file: SandboxFileData): boolean {
  return file.filename === "output.html";
}

export function findLatestOutputHtmlFile(messages: Message[]): SandboxFileData | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const files = messages[messageIndex]?.sandboxFiles ?? [];
    for (let fileIndex = files.length - 1; fileIndex >= 0; fileIndex -= 1) {
      const file = files[fileIndex];
      if (file && isOutputHtmlSandboxFile(file)) {
        return file;
      }
    }
  }

  return null;
}
