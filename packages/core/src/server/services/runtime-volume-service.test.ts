import { describe, expect, it } from "vitest";
import {
  buildCoworkerDocumentsRuntimeVolumePrefix,
  buildOwnedSkillsRuntimeVolumePrefix,
  buildRuntimeVolumeCredentialPolicy,
  buildRuntimeVolumeObjectKey,
  buildSharedSkillsRuntimeVolumePrefix,
  computeRuntimeVolumeManifestHash,
  sanitizeRuntimeVolumeRelativePath,
  shouldUseStaticRuntimeVolumeCredentialsForEndpoint,
} from "./runtime-volume-service";
import { BUCKET_NAME } from "../storage/s3-client";

describe("runtime-volume-service", () => {
  it("builds canonical Runtime Volume prefixes", () => {
    expect(
      buildOwnedSkillsRuntimeVolumePrefix({
        workspaceId: "workspace-1",
        userId: "user-1",
      }),
    ).toBe("runtime-volumes/workspace-1/users/user-1/skills/");
    expect(buildSharedSkillsRuntimeVolumePrefix({ workspaceId: "workspace-1" })).toBe(
      "runtime-volumes/workspace-1/shared-skills/",
    );
    expect(
      buildCoworkerDocumentsRuntimeVolumePrefix({
        workspaceId: "workspace-1",
        coworkerId: "coworker-1",
      }),
    ).toBe("runtime-volumes/workspace-1/coworkers/coworker-1/documents/");
  });

  it("rejects absolute, traversal, and empty relative paths", () => {
    expect(sanitizeRuntimeVolumeRelativePath("skill/SKILL.md")).toBe("skill/SKILL.md");
    expect(buildRuntimeVolumeObjectKey("runtime-volumes/ws/shared-skills", "alpha/SKILL.md")).toBe(
      "runtime-volumes/ws/shared-skills/alpha/SKILL.md",
    );
    expect(() => sanitizeRuntimeVolumeRelativePath("../secret")).toThrow(
      "Invalid Runtime Volume path",
    );
    expect(() => sanitizeRuntimeVolumeRelativePath("skill/../secret")).toThrow(
      "Invalid Runtime Volume path",
    );
    expect(() => sanitizeRuntimeVolumeRelativePath("")).toThrow(
      "Runtime Volume path must be a non-empty relative path",
    );
  });

  it("computes an order-independent manifest hash", () => {
    const entries = [
      {
        path: "beta/SKILL.md",
        kind: "file" as const,
        sizeBytes: 20,
        etag: "etag-beta",
      },
      {
        path: "alpha/SKILL.md",
        kind: "file" as const,
        sizeBytes: 10,
        etag: "etag-alpha",
      },
    ];

    expect(computeRuntimeVolumeManifestHash(entries)).toBe(
      computeRuntimeVolumeManifestHash(entries.toReversed()),
    );
    expect(computeRuntimeVolumeManifestHash(entries)).not.toBe(
      computeRuntimeVolumeManifestHash([
        { ...entries[0], etag: "etag-beta-updated" },
        entries[1],
      ]),
    );
  });

  it("scopes generated S3 credentials to exact Runtime Volume prefixes and read/write modes", () => {
    const ownedPrefix = "runtime-volumes/workspace-1/users/user-1/skills/";
    const sharedPrefix = "runtime-volumes/workspace-1/shared-skills/research/";
    const policy = buildRuntimeVolumeCredentialPolicy([
      { storagePrefix: ownedPrefix, readOnly: false },
      { storagePrefix: sharedPrefix, readOnly: true },
    ]) as {
      Statement: Array<{
        Action: string[];
        Resource: string[];
        Condition?: { StringLike?: { "s3:prefix"?: string[] } };
      }>;
    };

    const readStatement = policy.Statement.find((statement) =>
      statement.Action.includes("s3:GetObject"),
    );
    expect(readStatement?.Resource).toEqual(
      expect.arrayContaining([
        `arn:aws:s3:::${BUCKET_NAME}/${ownedPrefix}*`,
        `arn:aws:s3:::${BUCKET_NAME}/${sharedPrefix}*`,
      ]),
    );

    const writeStatement = policy.Statement.find((statement) =>
      statement.Action.includes("s3:PutObject"),
    );
    expect(writeStatement?.Resource).toEqual([`arn:aws:s3:::${BUCKET_NAME}/${ownedPrefix}*`]);
    expect(writeStatement?.Resource).not.toContain(
      `arn:aws:s3:::${BUCKET_NAME}/${sharedPrefix}*`,
    );

    const listStatement = policy.Statement.find((statement) =>
      statement.Action.includes("s3:ListBucket"),
    );
    expect(listStatement?.Condition?.StringLike?.["s3:prefix"]).toEqual(
      expect.arrayContaining([ownedPrefix, `${ownedPrefix}*`, sharedPrefix, `${sharedPrefix}*`]),
    );
  });

  it("uses static credentials for S3-compatible endpoints that do not support AWS STS", () => {
    expect(
      shouldUseStaticRuntimeVolumeCredentialsForEndpoint("https://bap-s3-staging.onrender.com"),
    ).toBe(true);
    expect(shouldUseStaticRuntimeVolumeCredentialsForEndpoint("http://localhost:9000")).toBe(true);
    expect(shouldUseStaticRuntimeVolumeCredentialsForEndpoint("http://127.0.0.1:9000")).toBe(
      true,
    );

    expect(
      shouldUseStaticRuntimeVolumeCredentialsForEndpoint("https://s3.us-east-1.amazonaws.com"),
    ).toBe(false);
    expect(
      shouldUseStaticRuntimeVolumeCredentialsForEndpoint(
        "https://bucket.s3.eu-west-1.amazonaws.com",
      ),
    ).toBe(false);
  });
});
