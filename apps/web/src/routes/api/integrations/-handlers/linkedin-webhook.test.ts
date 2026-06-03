import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findFirstMock,
  insertValuesMock,
  updateSetMock,
  updateWhereMock,
  getUnipileAccountMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  insertValuesMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  getUnipileAccountMock: vi.fn(),
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    query: { integration: { findFirst: findFirstMock } },
    insert: () => ({ values: insertValuesMock }),
    update: () => ({ set: updateSetMock }),
  },
}));

vi.mock("@cmdclaw/db/schema", () => ({
  integration: { userId: "userId", type: "type", id: "id", providerAccountId: "providerAccountId" },
}));

vi.mock("@/server/integrations/unipile", () => ({
  getUnipileAccount: getUnipileAccountMock,
}));

import { handleLinkedInWebhook } from "./linkedin-webhook";

function makeRequest(body: unknown, url = "https://cmdclaw.ai/api/integrations/linkedin/webhook") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleLinkedInWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    insertValuesMock.mockResolvedValue(undefined);
    updateWhereMock.mockResolvedValue(undefined);
  });

  it("returns 400 when AccountStatus is missing", async () => {
    const response = await handleLinkedInWebhook(makeRequest({ foo: "bar" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Missing AccountStatus" });
  });

  it("returns 400 when account_id is missing", async () => {
    const response = await handleLinkedInWebhook(
      makeRequest({ AccountStatus: { message: "CREATION_SUCCESS", account_type: "LINKEDIN" } }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Missing account_id" });
  });

  it("acknowledges CREATION_SUCCESS without userId and does not write", async () => {
    const response = await handleLinkedInWebhook(
      makeRequest({
        AccountStatus: { message: "CREATION_SUCCESS", account_id: "acc-1", account_type: "LINKEDIN" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(getUnipileAccountMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("derives userId from the standard request URL search params and inserts a new integration", async () => {
    findFirstMock.mockResolvedValue(undefined);
    getUnipileAccountMock.mockResolvedValue({ name: "Jane Doe", identifier: "jane" });

    const response = await handleLinkedInWebhook(
      makeRequest(
        {
          AccountStatus: {
            message: "CREATION_SUCCESS",
            account_id: "acc-1",
            account_type: "LINKEDIN",
          },
        },
        "https://cmdclaw.ai/api/integrations/linkedin/webhook?userId=user-42",
      ),
    );

    expect(response.status).toBe(200);
    expect(getUnipileAccountMock).toHaveBeenCalledWith("acc-1");
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-42",
        type: "linkedin",
        providerAccountId: "acc-1",
        displayName: "Jane Doe",
        enabled: true,
      }),
    );
  });

  it("updates the existing integration on CREATION_SUCCESS", async () => {
    findFirstMock.mockResolvedValue({ id: "int-1" });
    getUnipileAccountMock.mockResolvedValue({ name: "Jane Doe", identifier: "jane" });

    const response = await handleLinkedInWebhook(
      makeRequest(
        {
          AccountStatus: {
            message: "CREATION_SUCCESS",
            account_id: "acc-1",
            account_type: "LINKEDIN",
          },
        },
        "https://cmdclaw.ai/api/integrations/linkedin/webhook?userId=user-42",
      ),
    );

    expect(response.status).toBe(200);
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerAccountId: "acc-1", enabled: true }),
    );
  });

  it("disables the integration on DISCONNECTED", async () => {
    findFirstMock.mockResolvedValue({ id: "int-1" });

    const response = await handleLinkedInWebhook(
      makeRequest({
        AccountStatus: { message: "DISCONNECTED", account_id: "acc-1", account_type: "LINKEDIN" },
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith({ enabled: false });
  });

  it("returns 500 when JSON parsing fails", async () => {
    const badRequest = new Request("https://cmdclaw.ai/api/integrations/linkedin/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    const response = await handleLinkedInWebhook(badRequest);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Internal server error" });
  });
});
