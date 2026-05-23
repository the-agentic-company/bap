import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFsProfileStore, profileSlugForServerUrl } from "./profile-store";

describe("profile store", () => {
  it("creates a stable slug for server URLs", () => {
    expect(profileSlugForServerUrl("http://localhost:3000")).toBe("http--localhost-3000");
  });

  it("saves, loads, and clears per-server profiles", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "cmdclaw-profile-store-"));
    const store = createFsProfileStore({ rootDir });

    store.save({
      serverUrl: "http://localhost:3000",
      token: "token-1",
    });

    expect(store.load("http://localhost:3000")).toEqual({
      serverUrl: "http://localhost:3000",
      token: "token-1",
    });

    expect(store.load("https://cmdclaw.ai")).toBeNull();

    store.clear("http://localhost:3000");
    expect(store.load("http://localhost:3000")).toBeNull();
  });
});
