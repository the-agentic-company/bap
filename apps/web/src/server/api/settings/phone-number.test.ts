import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, updateMock, setMock, whereMock } = vi.hoisted(() => {
  const whereMock = vi.fn().mockResolvedValue(undefined);
  const setMock = vi.fn(() => ({ where: whereMock }));
  const updateMock = vi.fn(() => ({ set: setMock }));
  return { getSessionMock: vi.fn(), updateMock, setMock, whereMock };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));

vi.mock("@cmdclaw/db/client", () => ({
  db: { update: updateMock },
}));

vi.mock("@cmdclaw/db/schema", () => ({
  user: { id: "user.id", phoneNumber: "user.phoneNumber" },
}));

import { deletePhoneNumber } from "./phone-number";

describe("deletePhoneNumber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 and does not touch the database when unauthenticated", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await deletePhoneNumber(
      new Request("https://cmdclaw.ai/api/settings/phone-number", { method: "DELETE" }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("clears the authenticated user's phone number and returns status true", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-123" } });

    const response = await deletePhoneNumber(
      new Request("https://cmdclaw.ai/api/settings/phone-number", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({ phoneNumber: null });
    expect(whereMock).toHaveBeenCalledTimes(1);
  });
});
