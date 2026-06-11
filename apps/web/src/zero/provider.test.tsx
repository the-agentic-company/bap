import { describe, expect, it } from "vitest";
import { resolveZeroCacheURL, resolveZeroQueryURL } from "./provider-urls";
import { buildZeroStorageKey } from "./storage-key";

describe("Zero provider URLs", () => {
  it("uses configured public Zero URLs when present", async () => {
    expect(resolveZeroCacheURL("https://zero.example.com", undefined)).toBe(
      "https://zero.example.com",
    );
    expect(resolveZeroQueryURL("https://app.example.com/api/zero/query", undefined)).toBe(
      "https://app.example.com/api/zero/query",
    );
  });

  it("falls back to local docker compose URLs on loopback app hosts", async () => {
    const location = { hostname: "localhost", port: "3000" };

    expect(resolveZeroCacheURL(undefined, location)).toBe("http://localhost:4848");
    expect(resolveZeroQueryURL(undefined, location)).toBe(
      "http://host.docker.internal:3000/api/zero/query",
    );
  });

  it("does not assume local Zero endpoints on non-loopback hosts", async () => {
    const location = { hostname: "app.cmdclaw.com", port: "" };

    expect(resolveZeroCacheURL(undefined, location)).toBeUndefined();
    expect(resolveZeroQueryURL(undefined, location)).toBeUndefined();
  });
});

describe("Zero storage identity", () => {
  it("isolates persisted state by user and workspace", () => {
    expect(buildZeroStorageKey({ userId: "user-1", workspaceId: "workspace-1" })).toBe(
      "cmdclaw-web:user-1:workspace-1",
    );
    expect(buildZeroStorageKey({ userId: "user-2", workspaceId: "workspace-1" })).not.toBe(
      buildZeroStorageKey({ userId: "user-1", workspaceId: "workspace-1" }),
    );
    expect(buildZeroStorageKey({ userId: "user-1", workspaceId: "workspace-2" })).not.toBe(
      buildZeroStorageKey({ userId: "user-1", workspaceId: "workspace-1" }),
    );
  });
});
