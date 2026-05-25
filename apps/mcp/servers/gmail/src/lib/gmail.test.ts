import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGmailClient } from "./gmail";

describe("createGmailClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists message summaries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: "msg-1" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg-1",
          snippet: "hello",
          payload: {
            headers: [
              { name: "Subject", value: "Hello" },
              { name: "From", value: "boss@example.com" },
              { name: "Date", value: "Fri, 27 Feb 2026 09:25:52 -0600" },
            ],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = createGmailClient("token", "Europe/Dublin");
    const result = await client.listMessages({ limit: 5 });

    expect(result.messages).toEqual([
      {
        id: "msg-1",
        subject: "Hello",
        from: "boss@example.com",
        date: "2026-02-27 15:25:52",
        snippet: "hello",
      },
    ]);
  });

  it("returns message details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "msg-1",
          payload: {
            headers: [
              { name: "Subject", value: "Hello" },
              { name: "From", value: "boss@example.com" },
              { name: "To", value: "me@example.com" },
              { name: "Date", value: "Fri, 27 Feb 2026 09:25:52 -0600" },
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: Buffer.from("Body text").toString("base64") },
              },
            ],
          },
        }),
      }),
    );

    const client = createGmailClient("token", "Europe/Dublin");
    const result = await client.getMessage("msg-1");

    expect(result.message).toMatchObject({
      id: "msg-1",
      subject: "Hello",
      to: "me@example.com",
      body: "Body text",
    });
  });

  it("returns a Gmail URL when sending a message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg-1", threadId: "thread-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createGmailClient("token", "Europe/Dublin");
    const result = await client.sendMessage({
      to: "user@example.com",
      subject: "Hello",
      body: "Body text",
    });

    expect(result).toEqual({
      id: "msg-1",
      threadId: "thread-1",
      url: "https://mail.google.com/mail/u/0/#all/thread-1",
      status: "sent",
    });
  });

  it("returns a Gmail draft URL when creating a draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "draft-1", message: { id: "draft-message-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createGmailClient("token", "Europe/Dublin");
    const result = await client.createDraft({
      to: "user@example.com",
      subject: "Hello",
      body: "Body text",
    });

    expect(result).toEqual({
      id: "draft-1",
      messageId: "draft-message-1",
      url: "https://mail.google.com/mail/u/0/#drafts?compose=draft-message-1",
      status: "drafted",
    });
  });
});
