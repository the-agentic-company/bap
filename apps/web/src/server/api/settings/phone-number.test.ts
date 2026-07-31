import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { getSessionMock, updateMock, setMock, whereMock } = vi.hoisted(() => {
  const whereMock = vi.fn<VitestProcedure>().mockResolvedValue(undefined);
  const setMock = vi.fn<VitestProcedure>(() => ({ where: whereMock }));
  const updateMock = vi.fn<VitestProcedure>(() => ({ set: setMock }));
  return { getSessionMock: vi.fn<VitestProcedure>(), updateMock, setMock, whereMock };
});

vi.mock("@/server/session-auth", () => ({
  getRequestSession: getSessionMock,
}));

vi.mock("@bap/db/client", () => ({
  db: { update: updateMock },
}));

vi.mock("@bap/db/schema", () => ({
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
      new Request("https://heybap.com/api/settings/phone-number", { method: "DELETE" }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("clears the authenticated user's phone number and returns status true", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-123" } });

    const response = await deletePhoneNumber(
      new Request("https://heybap.com/api/settings/phone-number", { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({ phoneNumber: null });
    expect(whereMock).toHaveBeenCalledTimes(1);
  });
});
