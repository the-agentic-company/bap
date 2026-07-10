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

  it("falls back to host-reachable local URLs on loopback app hosts", async () => {
    const location = {
      host: "localhost:3000",
      hostname: "localhost",
      port: "3000",
      protocol: "http:",
    };

    expect(resolveZeroCacheURL(undefined, location)).toBe("http://localhost:4848");
    expect(resolveZeroQueryURL(undefined, location)).toBe("http://localhost:3000/api/zero/query");
  });

  it("preserves the loopback host used by the browser", async () => {
    const location = {
      host: "127.0.0.1:3001",
      hostname: "127.0.0.1",
      port: "3001",
      protocol: "http:",
    };

    expect(resolveZeroCacheURL(undefined, location)).toBe("http://127.0.0.1:4848");
    expect(resolveZeroQueryURL(undefined, location)).toBe("http://127.0.0.1:3001/api/zero/query");
  });

  it("formats IPv6 loopback URLs correctly", async () => {
    const location = {
      host: "[::1]:3000",
      hostname: "::1",
      port: "3000",
      protocol: "http:",
    };

    expect(resolveZeroCacheURL(undefined, location)).toBe("http://[::1]:4848");
    expect(resolveZeroQueryURL(undefined, location)).toBe("http://[::1]:3000/api/zero/query");
  });

  it("falls back to same-origin app edge URLs on non-loopback hosts", async () => {
    const location = {
      host: "staging.heybap.com",
      hostname: "staging.heybap.com",
      port: "",
      protocol: "https:",
    };

    expect(resolveZeroCacheURL(undefined, location)).toBe("https://staging.heybap.com/zero");
    expect(resolveZeroQueryURL(undefined, location)).toBe(
      "https://staging.heybap.com/api/zero/query",
    );
  });
});

describe("Zero storage identity", () => {
  it("isolates persisted state by user and workspace", () => {
    expect(buildZeroStorageKey({ userId: "user-1", workspaceId: "workspace-1" })).toBe(
      "bap-web:user-1:workspace-1",
    );
    expect(buildZeroStorageKey({ userId: "user-2", workspaceId: "workspace-1" })).not.toBe(
      buildZeroStorageKey({ userId: "user-1", workspaceId: "workspace-1" }),
    );
    expect(buildZeroStorageKey({ userId: "user-1", workspaceId: "workspace-2" })).not.toBe(
      buildZeroStorageKey({ userId: "user-1", workspaceId: "workspace-1" }),
    );
  });
});
