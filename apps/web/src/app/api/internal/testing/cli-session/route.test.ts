import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirstMock, insertMock, insertValuesMock, updateMock, updateSetMock, updateWhereMock } =
  vi.hoisted(() => ({
    findFirstMock: vi.fn(),
    insertMock: vi.fn(),
    insertValuesMock: vi.fn(),
    updateMock: vi.fn(),
    updateSetMock: vi.fn(),
    updateWhereMock: vi.fn(),
  }));

vi.mock("@/env", () => ({
  env: {
    CMDCLAW_SERVER_SECRET: "test-secret",
  },
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: {
    query: {
      user: {
        findFirst: findFirstMock,
      },
    },
    insert: insertMock,
    update: updateMock,
  },
}));

import { POST } from "./route";

describe("POST /api/internal/testing/cli-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(null);
    insertValuesMock.mockResolvedValue(undefined);
    insertMock.mockReturnValue({ values: insertValuesMock });
    updateWhereMock.mockResolvedValue(undefined);
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateMock.mockReturnValue({ set: updateSetMock });
  });

  it("rejects unauthorized requests", async () => {
    const response = await POST(
      new Request("https://app.example.com/api/internal/testing/cli-session", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("creates a test session for authorized requests", async () => {
    const response = await POST(
      new Request("https://app.example.com/api/internal/testing/cli-session", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
          "user-agent": "test-agent",
        },
        body: JSON.stringify({
          email: "ci@example.com",
          name: "CI Test",
          ttlHours: 2,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      email: "ci@example.com",
      expiresAt: expect.any(String),
      token: expect.any(String),
    });
    expect(body.token).toHaveLength(96);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ci@example.com",
        emailVerified: true,
        name: "CI Test",
        onboardedAt: expect.any(Date),
      }),
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        token: body.token,
        userAgent: "test-agent",
      }),
    );
  });

  it("updates an existing user before creating the session", async () => {
    findFirstMock.mockResolvedValue({
      id: "existing-user",
      onboardedAt: null,
    });

    const response = await POST(
      new Request("https://app.example.com/api/internal/testing/cli-session", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        emailVerified: true,
        name: "Baptiste",
        onboardedAt: expect.any(Date),
      }),
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "existing-user",
      }),
    );
  });
});
