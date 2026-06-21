import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateContentMock, getGenerativeModelMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  getGenerativeModelMock: vi.fn(),
}));

vi.mock("@google/generative-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/generative-ai")>();
  return {
    ...actual,
    GoogleGenerativeAI: function MockGoogleGenerativeAI() {
      return {
        getGenerativeModel: getGenerativeModelMock,
      };
    },
  };
});

vi.mock("../../env", () => ({
  env: {
    GEMINI_API_KEY: "test-key",
  },
}));

import {
  COWORKER_METADATA_GENERATION_TIMEOUT_MS,
  generateCoworkerMetadataOnFirstPromptFill,
  normalizeAndEnsureUniqueCoworkerUsername,
} from "./coworker-metadata";

function createDbStub() {
  const findFirst = vi.fn();
  return {
    db: {
      query: {
        coworker: {
          findFirst,
        },
      },
    },
    mocks: {
      findFirst,
    },
  };
}

describe("coworker-metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-key";
    getGenerativeModelMock.mockReturnValue({
      generateContent: generateContentMock,
    });
  });

  it("fills missing metadata on the first prompt write and adds a deterministic username suffix on collision", async () => {
    const { db, mocks } = createDbStub();
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            name: "Sales Follow Up",
            description: "Follows up with leads after calls.",
            username: "sam-the-sales-closer",
          }),
      },
    });
    mocks.findFirst.mockResolvedValueOnce({ id: "wf-other" });

    const result = await generateCoworkerMetadataOnFirstPromptFill({
      database: db,
      current: {
        id: "cwabcd12",
        name: "",
        description: null,
        username: null,
        prompt: "   ",
        triggerType: "manual",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: null,
        autoApprove: true,
      },
      next: {
        id: "cwabcd12",
        name: "",
        description: null,
        username: null,
        prompt: "Follow up with inbound leads after calls.",
        triggerType: "manual",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: null,
        autoApprove: true,
      },
    });

    expect(result).toEqual({
      name: "Sales Follow Up",
      description: "Follows up with leads after calls.",
      username: "sam-the-sales-closer-cwabcd12",
    });
  });

  it("does not generate metadata once a prompt already exists", async () => {
    const { db } = createDbStub();

    const result = await generateCoworkerMetadataOnFirstPromptFill({
      database: db,
      current: {
        id: "cw-1",
        name: "",
        description: null,
        username: null,
        prompt: "Existing prompt",
        triggerType: "manual",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: null,
        autoApprove: true,
      },
      next: {
        id: "cw-1",
        name: "",
        description: null,
        username: null,
        prompt: "Updated prompt",
        triggerType: "manual",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: null,
        autoApprove: true,
      },
    });

    expect(result).toEqual({});
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("falls back to prompt-derived metadata when Gemini output is invalid", async () => {
    const { db, mocks } = createDbStub();
    generateContentMock.mockResolvedValue({
      response: {
        text: () => "{invalid json",
      },
    });
    mocks.findFirst.mockResolvedValueOnce(null);

    const result = await generateCoworkerMetadataOnFirstPromptFill({
      database: db,
      current: {
        id: "cw-1",
        name: "",
        description: null,
        username: null,
        prompt: "   ",
        triggerType: "manual",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: null,
        autoApprove: true,
      },
      next: {
        id: "cw-1",
        name: "",
        description: null,
        username: null,
        prompt: "Follow up with leads after every call.",
        triggerType: "manual",
        allowedIntegrations: ["slack"],
        allowedCustomIntegrations: [],
        schedule: null,
        autoApprove: true,
      },
    });

    expect(result).toEqual({
      name: "Follow up with leads after every call",
      description: "Follow up with leads after every call.",
      username: "follow-up-with-leads-after-every-call",
    });
  });

  it("falls back to prompt-derived metadata when Gemini generation times out", async () => {
    vi.useFakeTimers();
    try {
      const { db, mocks } = createDbStub();
      generateContentMock.mockReturnValue(new Promise(() => {}));
      mocks.findFirst.mockResolvedValueOnce(null);

      const resultPromise = generateCoworkerMetadataOnFirstPromptFill({
        database: db,
        current: {
          id: "cw-1",
          name: "",
          description: null,
          username: null,
          prompt: "   ",
          triggerType: "manual",
          allowedIntegrations: ["slack"],
          allowedCustomIntegrations: [],
          schedule: null,
          autoApprove: true,
        },
        next: {
          id: "cw-1",
          name: "",
          description: null,
          username: null,
          prompt: "Create a greeting coworker.",
          triggerType: "manual",
          allowedIntegrations: ["slack"],
          allowedCustomIntegrations: [],
          schedule: null,
          autoApprove: true,
        },
      });

      await vi.advanceTimersByTimeAsync(COWORKER_METADATA_GENERATION_TIMEOUT_MS);

      await expect(resultPromise).resolves.toEqual({
        name: "Create a greeting coworker",
        description: "Create a greeting coworker.",
        username: "create-a-greeting-coworker",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes and uniquifies manual usernames", async () => {
    const { db, mocks } = createDbStub();
    mocks.findFirst.mockResolvedValueOnce({ id: "wf-other" });

    const result = await normalizeAndEnsureUniqueCoworkerUsername({
      database: db,
      coworkerId: "cwabcd12",
      username: " Team Helper ",
    });

    expect(result).toBe("team-helper-cwabcd12");
  });
});
