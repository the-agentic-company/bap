import { beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;

const { getPublicCoworkerPageMock, notFoundMock } = vi.hoisted(() => ({
  getPublicCoworkerPageMock: vi.fn<VitestProcedure>(),
  notFoundMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@tanstack/react-router", () => ({
  notFound: notFoundMock,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator() {
      return this;
    },
    handler(fn: (args: { data: { slug: string; runId?: string } }) => unknown) {
      return (args: { data: { slug: string; runId?: string } }) => fn(args);
    },
  }),
}));

vi.mock("@/server/services/public-coworker-page", () => ({
  getPublicCoworkerPage: getPublicCoworkerPageMock,
}));

import { loadPublicCoworkerRoute } from "@/lib/public-coworker-loader";

describe("/share/agents/$slug route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a shared public coworker without requiring a session", async () => {
    const page = {
      coworker: {
        id: "coworker-1",
        name: "Shared Coworker",
        description: null,
        username: "shared-coworker",
        sharedAt: "2026-06-26T10:00:00.000Z",
      },
      runs: [],
      selectedRun: null,
      messages: [],
      outputFile: null,
      outputHtml: null,
    };
    getPublicCoworkerPageMock.mockResolvedValue(page);

    await expect(
      loadPublicCoworkerRoute({ params: { slug: "shared-coworker" }, deps: { runId: "run-1" } }),
    ).resolves.toBe(page);
    expect(getPublicCoworkerPageMock).toHaveBeenCalledWith({
      slug: "shared-coworker",
      runId: "run-1",
    });
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("throws notFound for invalid or unshared slugs", async () => {
    const notFoundResult = { statusCode: 404 };
    getPublicCoworkerPageMock.mockResolvedValue(null);
    notFoundMock.mockReturnValue(notFoundResult);

    await expect(
      loadPublicCoworkerRoute({ params: { slug: "private-coworker" }, deps: {} }),
    ).rejects.toBe(notFoundResult);
    expect(notFoundMock).toHaveBeenCalledOnce();
  });
});
