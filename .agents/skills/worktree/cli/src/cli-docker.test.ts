import { describe, expect, test } from "vitest";

import {
  buildZeroCacheComposeEnv,
  buildZeroCacheVolumeName,
  buildZeroQueryUrl,
} from "./cli-docker";
import type { InstanceMetadata } from "./cli-runtime";

function metadata(overrides: Partial<InstanceMetadata> = {}): InstanceMetadata {
  return {
    instanceId: "bap-1234abcd",
    repoRoot: process.cwd(),
    instanceRoot: "/tmp/worktrees/bap-1234abcd",
    stackSlot: 7,
    appPort: 3707,
    wsPort: 4707,
    appUrl: "http://127.0.0.1:3707",
    databaseName: "bap_bap_1234abcd",
    databaseUser: "bap_bap_1234abcd_user",
    databasePassword: "worktree-db-password",
    databaseUrl: "postgresql://bap_bap_1234abcd_user:worktree-db-password@127.0.0.1:5432/bap_bap_1234abcd",
    redisUser: "wt-redis",
    redisPassword: "redis-password",
    queueName: "bap-bap-1234abcd",
    redisNamespace: "instance:bap-1234abcd:",
    minioBucketName: "bap-bap-1234abcd",
    minioAccessKeyId: "wt-minio",
    minioSecretAccessKey: "minio-secret",
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("worktree zero cache docker config", () => {
  test("derives a worktree-specific query URL and cache volume", () => {
    const instance = metadata();

    expect(buildZeroQueryUrl(instance)).toBe(
      "http://host.docker.internal:3707/api/zero/query",
    );
    expect(buildZeroCacheVolumeName(instance)).toBe("bap-1234abcd_zero_cache_data");
  });

  test("builds compose env for the current worktree database and app port", () => {
    const instance = metadata();
    const previousDatabasePassword = process.env.DATABASE_PASSWORD;
    const previousDbPassword = process.env.DB_PASSWORD;
    const previousAwsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const previousAwsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    try {
      process.env.DATABASE_PASSWORD = "shared-postgres-password";
      delete process.env.DB_PASSWORD;
      process.env.AWS_ACCESS_KEY_ID = "worktree-tenant-user";
      process.env.AWS_SECRET_ACCESS_KEY = "worktree-tenant-secret";

      const env = buildZeroCacheComposeEnv(instance);
      expect(env).toMatchObject({
        BAP_POSTGRES_DB: "bap_bap_1234abcd",
        BAP_ZERO_CACHE_VOLUME: "bap-1234abcd_zero_cache_data",
        VITE_ZERO_QUERY_URL: "http://host.docker.internal:3707/api/zero/query",
      });
      expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(env.MINIO_ROOT_USER).not.toBe("worktree-tenant-user");
      expect(env.MINIO_ROOT_PASSWORD).not.toBe("worktree-tenant-secret");
      expect(env.DATABASE_PASSWORD).toBe(env.DB_PASSWORD);
      expect(env.DATABASE_PASSWORD).not.toBe(instance.databasePassword);
    } finally {
      if (previousDatabasePassword === undefined) {
        delete process.env.DATABASE_PASSWORD;
      } else {
        process.env.DATABASE_PASSWORD = previousDatabasePassword;
      }
      if (previousDbPassword === undefined) {
        delete process.env.DB_PASSWORD;
      } else {
        process.env.DB_PASSWORD = previousDbPassword;
      }
      if (previousAwsAccessKeyId === undefined) {
        delete process.env.AWS_ACCESS_KEY_ID;
      } else {
        process.env.AWS_ACCESS_KEY_ID = previousAwsAccessKeyId;
      }
      if (previousAwsSecretAccessKey === undefined) {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      } else {
        process.env.AWS_SECRET_ACCESS_KEY = previousAwsSecretAccessKey;
      }
    }
  });
});
