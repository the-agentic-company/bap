import { describe, expect, test } from "vitest";

import { resolveSharedMinioRootCredentialsFromEnv } from "./cli-resources";

describe("worktree shared resource credentials", () => {
  test("prefers live MinIO root credentials over process env values", () => {
    expect(
      resolveSharedMinioRootCredentialsFromEnv(
        {
          MINIO_ROOT_USER: "root-user",
          MINIO_ROOT_PASSWORD: "root-password",
        },
        {
          AWS_ACCESS_KEY_ID: "worktree-tenant-user",
          AWS_SECRET_ACCESS_KEY: "worktree-tenant-secret",
        },
      ),
    ).toEqual({
      accessKeyId: "root-user",
      secretAccessKey: "root-password",
    });
  });

  test("does not use worktree AWS credentials as MinIO admin credentials", () => {
    expect(
      resolveSharedMinioRootCredentialsFromEnv(
        {},
        {
          AWS_ACCESS_KEY_ID: "worktree-tenant-user",
          AWS_SECRET_ACCESS_KEY: "worktree-tenant-secret",
        },
      ),
    ).toEqual({
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
    });
  });
});
