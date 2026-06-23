// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingCoworkerPrompt,
  getPendingCoworkerGenerationContent,
  readPendingCoworkerPrompt,
  writePendingCoworkerPrompt,
} from "./pending-coworker-prompt";

describe("pending-coworker-prompt", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it("stores and reads a trimmed prompt with attachments", () => {
    writePendingCoworkerPrompt({
      initialMessage: "  Draft my onboarding coworker  ",
      attachments: [
        {
          fileAssetId: "file-brief",
          name: "brief.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4,
        },
      ],
    });

    expect(readPendingCoworkerPrompt()).toEqual({
      initialMessage: "Draft my onboarding coworker",
      attachments: [
        {
          fileAssetId: "file-brief",
          name: "brief.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4,
        },
      ],
    });
  });

  it("clears malformed payloads", () => {
    globalThis.localStorage?.setItem("bap.pendingCoworkerPrompt", "{bad json");

    expect(readPendingCoworkerPrompt()).toBeNull();
    expect(globalThis.localStorage?.getItem("bap.pendingCoworkerPrompt")).toBeNull();
  });

  it("expires old prompts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T12:00:00.000Z"));

    writePendingCoworkerPrompt({ initialMessage: "Review latest support tickets" });
    vi.setSystemTime(new Date("2026-03-12T12:11:00.000Z"));

    expect(readPendingCoworkerPrompt()).toBeNull();
    expect(globalThis.localStorage?.getItem("bap.pendingCoworkerPrompt")).toBeNull();

    vi.useRealTimers();
  });

  it("removes the stored prompt", () => {
    writePendingCoworkerPrompt({ initialMessage: "Build a daily digest" });
    clearPendingCoworkerPrompt();

    expect(readPendingCoworkerPrompt()).toBeNull();
  });

  it("resolves a fallback message when only attachments are present", () => {
    const pendingPrompt = {
      initialMessage: "",
      attachments: [
        {
          fileAssetId: "file-notes",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
        },
      ],
    };

    writePendingCoworkerPrompt(pendingPrompt);

    expect(readPendingCoworkerPrompt()).toEqual(pendingPrompt);
    expect(getPendingCoworkerGenerationContent(pendingPrompt)).toBe(
      "Use the attached files as context while building this coworker.",
    );
  });
});
