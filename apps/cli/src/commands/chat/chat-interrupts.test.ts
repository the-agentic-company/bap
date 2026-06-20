import { createReadStream } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApprovalPrompt } from "./chat-interrupts";

vi.mock("node:fs", () => ({
  createReadStream: vi.fn(() => {
    throw new Error("unexpected /dev/tty fallback");
  }),
}));

const originalStdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const originalStdoutIsTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

function setProcessTty(stdin: boolean, stdout: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: stdin,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: stdout,
  });
}

function restoreProperty(target: object, key: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }
  delete (target as Record<string, unknown>)[key];
}

afterEach(() => {
  vi.clearAllMocks();
  restoreProperty(process.stdin, "isTTY", originalStdinIsTty);
  restoreProperty(process.stdout, "isTTY", originalStdoutIsTty);
});

describe("createApprovalPrompt", () => {
  it("uses current stdio when an initial message receives a question in a tty", () => {
    setProcessTty(true, true);

    const prompt = createApprovalPrompt(null);

    try {
      expect(prompt).not.toBeNull();
      expect(createReadStream).not.toHaveBeenCalled();
    } finally {
      prompt?.close();
    }
  });
});
