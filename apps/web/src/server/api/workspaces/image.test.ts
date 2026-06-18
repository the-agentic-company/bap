import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const {
  downloadWorkspaceImageForUserMock,
  downloadWorkspaceImageWithSignatureMock,
  getRequestSessionCandidatesMock,
  getRequestSessionMock,
} = vi.hoisted(() => ({
  downloadWorkspaceImageForUserMock: vi.fn<VitestProcedure>(),
  downloadWorkspaceImageWithSignatureMock: vi.fn<VitestProcedure>(),
  getRequestSessionCandidatesMock: vi.fn<VitestProcedure>(),
  getRequestSessionMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/server/session-auth", () => ({
  getRequestSessionCandidates: getRequestSessionCandidatesMock,
  getRequestSession: getRequestSessionMock,
}));

vi.mock("@bap/core/server/billing/workspace-image", () => ({
  downloadWorkspaceImageForUser: downloadWorkspaceImageForUserMock,
  downloadWorkspaceImageWithSignature: downloadWorkspaceImageWithSignatureMock,
}));

import { downloadWorkspaceImage } from "./image";

describe("downloadWorkspaceImage (GET /api/workspaces/:id/image)", () => {
  beforeEach(() => {
    downloadWorkspaceImageForUserMock.mockReset();
    downloadWorkspaceImageWithSignatureMock.mockReset();
    getRequestSessionCandidatesMock.mockReset();
    getRequestSessionMock.mockReset();
    downloadWorkspaceImageWithSignatureMock.mockResolvedValue(null);
    getRequestSessionCandidatesMock.mockResolvedValue([]);
  });

  it("streams an authenticated workspace image", async () => {
    getRequestSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    const bytes = Buffer.from("image-bytes");
    downloadWorkspaceImageForUserMock.mockResolvedValue({
      body: bytes,
      mimeType: "image/png",
    });

    const response = await downloadWorkspaceImage(
      new Request("https://heybap.com/api/workspaces/ws-1/image"),
      "ws-1",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe(bytes.byteLength.toString());
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(downloadWorkspaceImageForUserMock).toHaveBeenCalledWith("user-1", "ws-1");
  });

  it("streams a signed workspace image without reading the session", async () => {
    const bytes = Buffer.from("image-bytes");
    downloadWorkspaceImageWithSignatureMock.mockResolvedValue({
      body: bytes,
      mimeType: "image/webp",
    });

    const response = await downloadWorkspaceImage(
      new Request("https://heybap.com/api/workspaces/ws-1/image?s=signed"),
      "ws-1",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(downloadWorkspaceImageWithSignatureMock).toHaveBeenCalledWith("ws-1", "signed");
    expect(getRequestSessionMock).not.toHaveBeenCalled();
    expect(downloadWorkspaceImageForUserMock).not.toHaveBeenCalled();
  });

  it("tries other valid session cookies when the primary session cannot access the image", async () => {
    getRequestSessionMock.mockResolvedValue({ user: { id: "stale-user" } });
    getRequestSessionCandidatesMock.mockResolvedValue([
      { user: { id: "stale-user" } },
      { user: { id: "current-user" } },
    ]);
    const bytes = Buffer.from("image-bytes");
    downloadWorkspaceImageForUserMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      body: bytes,
      mimeType: "image/webp",
    });

    const response = await downloadWorkspaceImage(
      new Request("https://heybap.com/api/workspaces/ws-1/image", {
        headers: {
          cookie: "better-auth.session_token=stale; better-auth.session_token=current",
        },
      }),
      "ws-1",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(downloadWorkspaceImageForUserMock).toHaveBeenNthCalledWith(1, "stale-user", "ws-1");
    expect(downloadWorkspaceImageForUserMock).toHaveBeenNthCalledWith(2, "current-user", "ws-1");
  });

  it("rejects unauthenticated requests", async () => {
    getRequestSessionMock.mockResolvedValue(null);

    const response = await downloadWorkspaceImage(
      new Request("https://heybap.com/api/workspaces/ws-1/image"),
      "ws-1",
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(downloadWorkspaceImageForUserMock).not.toHaveBeenCalled();
  });

  it("does not cache missing workspace image responses", async () => {
    getRequestSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    downloadWorkspaceImageForUserMock.mockResolvedValue(null);

    const response = await downloadWorkspaceImage(
      new Request("https://heybap.com/api/workspaces/ws-1/image"),
      "ws-1",
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
