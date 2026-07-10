// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerBrowserDownload } from "./download-file";

describe("triggerBrowserDownload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads the fetched blob without opening a new tab", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      blob: vi.fn<() => Promise<Blob>>().mockResolvedValue(blob),
    } as unknown as Response);
    const createObjectUrlMock = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:download-url");
    const revokeObjectUrlMock = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");

    await triggerBrowserDownload("https://example.com/output.html", "output.html");

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/output.html");
    expect(createObjectUrlMock).toHaveBeenCalled();
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:download-url");
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);

    const anchor = appendSpy.mock.calls[0]?.[0];
    expect(anchor).toBeInstanceOf(HTMLAnchorElement);
    expect((anchor as HTMLAnchorElement).download).toBe("output.html");
    expect((anchor as HTMLAnchorElement).target).toBe("");
  });
});
