import { afterEach, describe, expect, it } from "vitest";
import {
  createOrReplaceSnapshot,
  formatDaytonaBuildError,
  getSnapshotName,
  rewriteStorageUrlForHostBuild,
} from "./build";

const originalEnv = {
  CMDCLAW_MINIO_API_PORT: process.env.CMDCLAW_MINIO_API_PORT,
  DAYTONA_OBJECT_STORAGE_URL: process.env.DAYTONA_OBJECT_STORAGE_URL,
  E2B_DAYTONA_SANDBOX_NAME: process.env.E2B_DAYTONA_SANDBOX_NAME,
  DAYTONA_SNAPSHOT_DEV: process.env.DAYTONA_SNAPSHOT_DEV,
  DAYTONA_SNAPSHOT_STAGING: process.env.DAYTONA_SNAPSHOT_STAGING,
  DAYTONA_SNAPSHOT_PROD: process.env.DAYTONA_SNAPSHOT_PROD,
};

function restoreEnvVar(name: keyof typeof originalEnv) {
  const value = originalEnv[name];
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("daytona build helpers", () => {
  afterEach(() => {
    restoreEnvVar("CMDCLAW_MINIO_API_PORT");
    restoreEnvVar("DAYTONA_OBJECT_STORAGE_URL");
    restoreEnvVar("E2B_DAYTONA_SANDBOX_NAME");
    restoreEnvVar("DAYTONA_SNAPSHOT_DEV");
    restoreEnvVar("DAYTONA_SNAPSHOT_STAGING");
    restoreEnvVar("DAYTONA_SNAPSHOT_PROD");
  });

  it("uses the shared runtime alias for the dev snapshot", () => {
    process.env.E2B_DAYTONA_SANDBOX_NAME = "shared-dev";
    process.env.DAYTONA_SNAPSHOT_DEV = "ignored-dev";

    expect(getSnapshotName("dev")).toBe("shared-dev");
  });

  it("uses the staging-specific env override for the staging snapshot", () => {
    process.env.DAYTONA_SNAPSHOT_STAGING = "custom-staging";

    expect(getSnapshotName("staging")).toBe("custom-staging");
  });

  it("falls back to the default staging snapshot when the override is blank", () => {
    process.env.DAYTONA_SNAPSHOT_STAGING = "";

    expect(getSnapshotName("staging")).toBe("cmdclaw-agent-staging");
  });

  it("falls back to the dev snapshot env when the shared dev alias is blank", () => {
    process.env.E2B_DAYTONA_SANDBOX_NAME = " ";
    process.env.DAYTONA_SNAPSHOT_DEV = "custom-dev";

    expect(getSnapshotName("dev")).toBe("custom-dev");
  });

  it("formats a useful self-hosted minio error", () => {
    const message = formatDaytonaBuildError(
      {
        code: "FailedToOpenSocket",
        path: "http://minio:9000/daytona/?list-type=2",
      },
      "http://localhost:3300/api",
    );

    expect(message).toContain("http://minio:9000/daytona/?list-type=2");
    expect(message).toContain("http://localhost:9000");
    expect(message).toContain("DAYTONA_API_URL points to a local Daytona API");
  });

  it("returns null for unrelated errors", () => {
    expect(formatDaytonaBuildError(new Error("boom"), "http://localhost:3300/api")).toBeNull();
  });

  it("rewrites the local minio endpoint to the published host port", () => {
    process.env.CMDCLAW_MINIO_API_PORT = "9000";

    expect(
      rewriteStorageUrlForHostBuild("http://minio:9000", "http://localhost:3300/api"),
    ).toBe("http://localhost:9000/");
  });

  it("prefers an explicit object storage override", () => {
    process.env.DAYTONA_OBJECT_STORAGE_URL = "http://127.0.0.1:9200";

    expect(
      rewriteStorageUrlForHostBuild("http://minio:9000", "http://localhost:3300/api"),
    ).toBe("http://127.0.0.1:9200");
  });

  it("waits for snapshot deletion to propagate before recreating a conflicting snapshot", async () => {
    const calls: string[] = [];
    let getAttempts = 0;
    const createdSnapshot = { id: "snapshot-created" };
    const existingSnapshot = { id: "snapshot-existing" };
    const daytona = {
      snapshot: {
        create: async () => {
          calls.push("create");
          if (calls.filter((call) => call === "create").length === 1) {
            throw { statusCode: 409, message: "Snapshot already exists" };
          }
          return createdSnapshot;
        },
        get: async () => {
          calls.push("get");
          getAttempts++;
          if (getAttempts === 1) {
            return existingSnapshot;
          }
          if (getAttempts === 2) {
            return existingSnapshot;
          }
          throw { statusCode: 404, message: "not found" };
        },
        delete: async () => {
          calls.push("delete");
        },
      },
    };

    await expect(
      createOrReplaceSnapshot(daytona, "cmdclaw-agent-staging", {
        sleep: async () => {},
        recreateDelayMs: () => 0,
        deleteCheckDelayMs: () => 0,
      }),
    ).resolves.toBe(createdSnapshot);

    expect(calls).toEqual(["create", "get", "delete", "get", "get", "create"]);
  });
});
