import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const authorizeRuntimeTurnMock = vi.fn<VitestProcedure>();
const coworkerFindFirstMock = vi.fn<VitestProcedure>();
const coworkerFindManyMock = vi.fn<VitestProcedure>();
const userFindFirstMock = vi.fn<VitestProcedure>();
const triggerCoworkerRunMock = vi.fn<VitestProcedure>();
const uploadCoworkerDocumentMock = vi.fn<VitestProcedure>();
const resolveCoworkerBuilderContextByConversationMock = vi.fn<VitestProcedure>();
const applyCoworkerEditMock = vi.fn<VitestProcedure>();

vi.mock("@/server/internal/runtime-auth", () => ({
  authorizeRuntimeTurn: authorizeRuntimeTurnMock,
}));

vi.mock("@/server/services/coworker-document", () => ({
  uploadCoworkerDocument: uploadCoworkerDocumentMock,
}));

vi.mock("@bap/db/client", () => ({
  db: {
    query: {
      coworker: {
        findFirst: coworkerFindFirstMock,
        findMany: coworkerFindManyMock,
      },
      user: {
        findFirst: userFindFirstMock,
      },
    },
  },
}));

vi.mock("@bap/core/server/services/coworker-service", () => ({
  triggerCoworkerRun: triggerCoworkerRunMock,
}));

vi.mock("@bap/core/server/services/coworker-metadata", () => ({
  normalizeCoworkerUsername: (value: string) =>
    value
      .toLowerCase()
      .trim()
      .replace(/^@+/, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, ""),
}));

vi.mock("@bap/core/server/services/coworker-builder-service", async () => {
  const actual = await vi.importActual<
    typeof import("@bap/core/server/services/coworker-builder-service")
  >("@bap/core/server/services/coworker-builder-service");
  return {
    ...actual,
    resolveCoworkerBuilderContextByConversation: resolveCoworkerBuilderContextByConversationMock,
    applyCoworkerEdit: applyCoworkerEditMock,
  };
});

let handleCoworkerDocumentUpload: typeof import("./coworker-runtime").handleCoworkerDocumentUpload;
let handleCoworkerEdit: typeof import("./coworker-runtime").handleCoworkerEdit;
let handleCoworkerInvoke: typeof import("./coworker-runtime").handleCoworkerInvoke;
let handleCoworkerList: typeof import("./coworker-runtime").handleCoworkerList;

describe("coworker runtime handlers", () => {
  beforeAll(async () => {
    ({
      handleCoworkerDocumentUpload,
      handleCoworkerEdit,
      handleCoworkerInvoke,
      handleCoworkerList,
    } = await import("./coworker-runtime"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authorizeRuntimeTurnMock.mockResolvedValue({
      ok: true,
      runtimeId: "rt-1",
      turnSeq: 2,
      generationId: "gen-1",
      conversationId: "conv-1",
      userId: "user-1",
    });
  });

  describe("handleCoworkerDocumentUpload", () => {
    beforeEach(() => {
      uploadCoworkerDocumentMock.mockResolvedValue({
        id: "doc-1",
        filename: "brief.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
      });
    });

    it("uploads a coworker document for later runs", async () => {
      const response = await handleCoworkerDocumentUpload(
        new Request("https://app.example.com/api/internal/coworkers/runtime/documents/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer runtime-token",
          },
          body: JSON.stringify({
            runtimeId: "rt-1",
            turnSeq: 2,
            coworkerId: "cw-1",
            filename: "brief.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("hello world").toString("base64"),
            description: "Reference brief",
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(uploadCoworkerDocumentMock).toHaveBeenCalledWith({
        database: expect.anything(),
        userId: "user-1",
        coworkerId: "cw-1",
        filename: "brief.pdf",
        mimeType: "application/pdf",
        contentBase64: Buffer.from("hello world").toString("base64"),
        description: "Reference brief",
      });
      expect(body).toEqual({
        document: {
          id: "doc-1",
          filename: "brief.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
        },
      });
    });

    it("returns stale_turn for an older runtime callback", async () => {
      authorizeRuntimeTurnMock.mockResolvedValue({ ok: false, reason: "stale_turn" });

      const response = await handleCoworkerDocumentUpload(
        new Request("https://app.example.com/api/internal/coworkers/runtime/documents/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer runtime-token",
          },
          body: JSON.stringify({
            runtimeId: "rt-1",
            turnSeq: 1,
            coworkerId: "cw-1",
            filename: "brief.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("hello world").toString("base64"),
          }),
        }),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "stale_turn" });
      expect(uploadCoworkerDocumentMock).not.toHaveBeenCalled();
    });
  });

  describe("handleCoworkerEdit", () => {
    beforeEach(() => {
      authorizeRuntimeTurnMock.mockResolvedValue({
        ok: true,
        runtimeId: "rt-1",
        turnSeq: 2,
        generationId: "gen-1",
        conversationId: "conv-builder",
        userId: "user-1",
      });
      userFindFirstMock.mockResolvedValue({ role: "admin" });
      resolveCoworkerBuilderContextByConversationMock.mockResolvedValue({
        coworkerId: "cw-1",
        updatedAt: "2026-03-03T12:00:00.000Z",
        prompt: "Current prompt",
        model: "openai/gpt-5.4",
        toolAccessMode: "selected",
        triggerType: "manual",
        schedule: null,
        allowedIntegrations: ["github"],
      });
      applyCoworkerEditMock.mockResolvedValue({
        status: "applied",
        appliedChanges: ["prompt"],
        coworker: {
          coworkerId: "cw-1",
          updatedAt: "2026-03-03T12:01:00.000Z",
          prompt: "Updated prompt",
          model: "openai/gpt-5.4",
          toolAccessMode: "selected",
          triggerType: "manual",
          schedule: null,
          allowedIntegrations: ["github"],
        },
      });
    });

    it("applies coworker edits for the active builder conversation", async () => {
      const response = await handleCoworkerEdit(
        new Request("https://app.example.com/api/internal/coworkers/runtime/edit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer runtime-token",
          },
          body: JSON.stringify({
            runtimeId: "rt-1",
            turnSeq: 2,
            coworkerId: "cw-1",
            baseUpdatedAt: "2026-03-03T12:00:00.000Z",
            changes: { prompt: "Updated prompt" },
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(applyCoworkerEditMock).toHaveBeenCalledWith({
        database: expect.anything(),
        userId: "user-1",
        userRole: "admin",
        coworkerId: "cw-1",
        baseUpdatedAt: "2026-03-03T12:00:00.000Z",
        changes: { prompt: "Updated prompt" },
      });
      expect(body).toEqual({
        edit: {
          kind: "coworker_edit_apply",
          status: "applied",
          coworkerId: "cw-1",
          appliedChanges: ["prompt"],
          coworker: {
            coworkerId: "cw-1",
            updatedAt: "2026-03-03T12:01:00.000Z",
            prompt: "Updated prompt",
            model: "openai/gpt-5.4",
            toolAccessMode: "selected",
            triggerType: "manual",
            schedule: null,
            allowedIntegrations: ["github"],
          },
          message: "Saved coworker edits: prompt.",
        },
      });
    });

    it("returns stale_turn for out-of-date runtime callbacks", async () => {
      authorizeRuntimeTurnMock.mockResolvedValue({ ok: false, reason: "stale_turn" });

      const response = await handleCoworkerEdit(
        new Request("https://app.example.com/api/internal/coworkers/runtime/edit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer runtime-token",
          },
          body: JSON.stringify({
            runtimeId: "rt-1",
            turnSeq: 1,
            coworkerId: "cw-1",
            baseUpdatedAt: "2026-03-03T12:00:00.000Z",
            changes: { prompt: "Updated prompt" },
          }),
        }),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "stale_turn" });
      expect(applyCoworkerEditMock).not.toHaveBeenCalled();
    });

    it("returns validation details for invalid edit payloads", async () => {
      const response = await handleCoworkerEdit(
        new Request("https://app.example.com/api/internal/coworkers/runtime/edit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer runtime-token",
          },
          body: JSON.stringify({
            runtimeId: "rt-1",
            turnSeq: 2,
            coworkerId: "cw-1",
            baseUpdatedAt: "2026-03-03T12:00:00.000Z",
            changes: {},
          }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "invalid_request",
        details: ["changes: Edit must include at least one editable field"],
      });
      expect(applyCoworkerEditMock).not.toHaveBeenCalled();
    });
  });

  describe("handleCoworkerInvoke", () => {
    beforeEach(() => {
      coworkerFindFirstMock.mockResolvedValue({
        id: "cw-1",
        name: "LinkedIn Digest",
        username: "linkedin-digest",
      });
      coworkerFindManyMock.mockResolvedValue([]);
      triggerCoworkerRunMock.mockResolvedValue({
        coworkerId: "cw-1",
        runId: "run-1",
        generationId: "child-gen-1",
        conversationId: "child-conv-1",
      });
    });

    it("invokes a coworker with chat-origin payload and forwarded attachments", async () => {
      const response = await handleCoworkerInvoke(
        new Request("https://app.example.com/api/internal/coworkers/runtime/invoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer runtime-token",
          },
          body: JSON.stringify({
            runtimeId: "rt-1",
            turnSeq: 2,
            username: "@linkedin-digest",
            message: "Review these LinkedIn messages",
            attachments: [
              {
                name: "voice-note.m4a",
                mimeType: "audio/mp4",
                dataUrl: "data:audio/mp4;base64,ZmFrZQ==",
              },
            ],
          }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(triggerCoworkerRunMock).toHaveBeenCalledWith({
        coworkerId: "cw-1",
        startKind: "user_intent",
        userId: "user-1",
        triggerPayload: {
          source: "chat_mention",
          parentGenerationId: "gen-1",
          parentConversationId: "conv-1",
          mention: "@linkedin-digest",
          message: "Review these LinkedIn messages",
          attachmentNames: ["voice-note.m4a"],
        },
        fileAttachments: [
          {
            name: "voice-note.m4a",
            mimeType: "audio/mp4",
            dataUrl: "data:audio/mp4;base64,ZmFrZQ==",
          },
        ],
      });
      expect(body).toEqual({
        invocation: {
          kind: "coworker_invocation",
          coworkerId: "cw-1",
          username: "linkedin-digest",
          name: "LinkedIn Digest",
          runId: "run-1",
          conversationId: "child-conv-1",
          generationId: "child-gen-1",
          status: "running",
          attachmentNames: ["voice-note.m4a"],
          message: "Review these LinkedIn messages",
        },
      });
    });

    it("returns stale_turn when the runtime callback is for an older turn", async () => {
      authorizeRuntimeTurnMock.mockResolvedValue({ ok: false, reason: "stale_turn" });

      const response = await handleCoworkerInvoke(
        new Request("https://app.example.com/api/internal/coworkers/runtime/invoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer runtime-token",
          },
          body: JSON.stringify({
            runtimeId: "rt-1",
            turnSeq: 1,
            username: "@linkedin-digest",
            message: "Review these LinkedIn messages",
          }),
        }),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "stale_turn" });
      expect(triggerCoworkerRunMock).not.toHaveBeenCalled();
    });
  });

  describe("handleCoworkerList", () => {
    beforeEach(() => {
      coworkerFindManyMock.mockResolvedValue([
        {
          id: "cw-1",
          name: "LinkedIn Digest",
          username: "linkedin-digest",
          description: "Reviews LinkedIn inbox items",
          triggerType: "manual",
        },
        {
          id: "cw-2",
          name: "Hidden",
          username: null,
          description: null,
          triggerType: "manual",
        },
      ]);
    });

    it("returns invokable coworkers for the current runtime user", async () => {
      const response = await handleCoworkerList(
        new Request("https://app.example.com/api/internal/coworkers/runtime/list", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer runtime-token",
          },
          body: JSON.stringify({ runtimeId: "rt-1", turnSeq: 2 }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        coworkers: [
          {
            id: "cw-1",
            name: "LinkedIn Digest",
            username: "linkedin-digest",
            description: "Reviews LinkedIn inbox items",
            triggerType: "manual",
          },
        ],
      });
    });

    it("returns stale_turn when the runtime binding is out of date", async () => {
      authorizeRuntimeTurnMock.mockResolvedValue({ ok: false, reason: "stale_turn" });

      const response = await handleCoworkerList(
        new Request("https://app.example.com/api/internal/coworkers/runtime/list", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer runtime-token",
          },
          body: JSON.stringify({ runtimeId: "rt-1", turnSeq: 1 }),
        }),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "stale_turn" });
    });
  });
});
