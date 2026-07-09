import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { GetFederationTokenCommand, STSClient } from "@aws-sdk/client-sts";
import { db } from "@bap/db/client";
import {
  coworker,
  coworkerDocument,
  runtimeVolume,
  skill,
  skillDocument,
  skillFile,
  type RuntimeVolumeManifestEntry,
} from "@bap/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { lookup as lookupMimeType } from "mime-types";
import { env } from "../../env";
import {
  BUCKET_NAME,
  deleteFromS3,
  downloadFromS3,
  listS3Objects,
  uploadToS3,
} from "../storage/s3-client";
import { logger } from "../utils/observability";

export const RUNTIME_VOLUME_ROOT_PREFIX = "runtime-volumes";
const RUNTIME_VOLUME_CREDENTIAL_TTL_SECONDS = 60 * 60;

export type RuntimeVolumeKind = "owned_skills" | "shared_skills" | "coworker_documents";

export type RuntimeVolumeProjectionInput = {
  workspaceId: string;
  kind: RuntimeVolumeKind;
  ownerUserId?: string | null;
  coworkerId?: string | null;
  storagePrefix: string;
  mountPath: string;
  readOnly: boolean;
  generationId?: string | null;
};

export type RuntimeVolumeManifest = {
  entries: RuntimeVolumeManifestEntry[];
  hash: string;
};

export type RuntimeVolumeS3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAt?: Date;
};

export function assertRuntimeVolumePathSegment(value: string, label: string): string {
  if (!value || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`Invalid Runtime Volume ${label}: ${value}`);
  }
  if (value === "." || value === "..") {
    throw new Error(`Invalid Runtime Volume ${label}: ${value}`);
  }
  return value;
}

export function sanitizeRuntimeVolumeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("Runtime Volume path must be a non-empty relative path");
  }

  const parts = normalized.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      throw new Error(`Invalid Runtime Volume path: ${relativePath}`);
    }
  }

  return parts.join("/");
}

export function ensureTrailingSlash(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export function buildOwnedSkillsRuntimeVolumePrefix(input: {
  workspaceId: string;
  userId: string;
}): string {
  return ensureTrailingSlash(
    [
      RUNTIME_VOLUME_ROOT_PREFIX,
      assertRuntimeVolumePathSegment(input.workspaceId, "workspace id"),
      "users",
      assertRuntimeVolumePathSegment(input.userId, "user id"),
      "skills",
    ].join("/"),
  );
}

export function buildSharedSkillsRuntimeVolumePrefix(input: { workspaceId: string }): string {
  return ensureTrailingSlash(
    [
      RUNTIME_VOLUME_ROOT_PREFIX,
      assertRuntimeVolumePathSegment(input.workspaceId, "workspace id"),
      "shared-skills",
    ].join("/"),
  );
}

export function buildCoworkerDocumentsRuntimeVolumePrefix(input: {
  workspaceId: string;
  coworkerId: string;
}): string {
  return ensureTrailingSlash(
    [
      RUNTIME_VOLUME_ROOT_PREFIX,
      assertRuntimeVolumePathSegment(input.workspaceId, "workspace id"),
      "coworkers",
      assertRuntimeVolumePathSegment(input.coworkerId, "coworker id"),
      "documents",
    ].join("/"),
  );
}

export function appendRuntimeVolumeSkillSlug(prefix: string, skillSlug: string): string {
  return ensureTrailingSlash(
    `${ensureTrailingSlash(prefix)}${assertRuntimeVolumePathSegment(skillSlug, "skill slug")}`,
  );
}

export function buildRuntimeVolumeObjectKey(prefix: string, relativePath: string): string {
  return `${ensureTrailingSlash(prefix)}${sanitizeRuntimeVolumeRelativePath(relativePath)}`;
}

export async function readRuntimeVolumeFile(input: {
  storagePrefix: string;
  relativePath: string;
}): Promise<Buffer> {
  return await downloadFromS3(buildRuntimeVolumeObjectKey(input.storagePrefix, input.relativePath));
}

export async function writeRuntimeVolumeFile(input: {
  storagePrefix: string;
  relativePath: string;
  body: Buffer;
  contentType?: string;
}): Promise<void> {
  await uploadToS3(
    buildRuntimeVolumeObjectKey(input.storagePrefix, input.relativePath),
    input.body,
    input.contentType ?? "application/octet-stream",
  );
}

export async function deleteRuntimeVolumeFile(input: {
  storagePrefix: string;
  relativePath: string;
}): Promise<void> {
  await deleteFromS3(buildRuntimeVolumeObjectKey(input.storagePrefix, input.relativePath));
}

export async function deleteRuntimeVolumePrefix(storagePrefix: string): Promise<void> {
  const prefix = ensureTrailingSlash(storagePrefix);
  const objects = await listS3Objects(prefix);
  await Promise.all(objects.map((object) => deleteFromS3(object.key)));
}

export async function copyRuntimeVolumePrefix(input: {
  sourceStoragePrefix: string;
  targetStoragePrefix: string;
}): Promise<number> {
  const sourcePrefix = ensureTrailingSlash(input.sourceStoragePrefix);
  const targetPrefix = ensureTrailingSlash(input.targetStoragePrefix);
  const objects = (await listS3Objects(sourcePrefix)).filter((object) => !object.key.endsWith("/"));

  await Promise.all(
    objects.map(async (object) => {
      const relativePath = sanitizeRuntimeVolumeRelativePath(object.key.slice(sourcePrefix.length));
      await uploadToS3(
        buildRuntimeVolumeObjectKey(targetPrefix, relativePath),
        await downloadFromS3(object.key),
        "application/octet-stream",
      );
    }),
  );

  return objects.length;
}

export async function listRuntimeVolumeManifest(storagePrefix: string): Promise<RuntimeVolumeManifest> {
  const prefix = ensureTrailingSlash(storagePrefix);
  const entries = (await listS3Objects(prefix))
    .filter((object) => object.key !== prefix && !object.key.endsWith("/"))
    .map((object): RuntimeVolumeManifestEntry => {
      const relativePath = sanitizeRuntimeVolumeRelativePath(object.key.slice(prefix.length));
      return {
        path: relativePath,
        kind: "file",
        sizeBytes: object.sizeBytes,
        etag: object.etag,
        lastModifiedAt: object.lastModified?.toISOString(),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    entries,
    hash: computeRuntimeVolumeManifestHash(entries),
  };
}

export function computeRuntimeVolumeManifestHash(
  entries: readonly RuntimeVolumeManifestEntry[],
): string {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.kind);
    hash.update("\0");
    hash.update(String(entry.sizeBytes));
    hash.update("\0");
    hash.update(entry.etag ?? entry.lastModifiedAt ?? "");
    hash.update("\n");
  }
  return hash.digest("hex");
}

let runtimeVolumeStsClient: STSClient | null = null;

function getRuntimeVolumeStsClient(): STSClient {
  if (!runtimeVolumeStsClient) {
    runtimeVolumeStsClient = new STSClient({
      endpoint: getRuntimeVolumeStsEndpoint(),
      region: env.AWS_DEFAULT_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return runtimeVolumeStsClient;
}

function getRuntimeVolumeStsEndpoint(): string | undefined {
  if (!env.AWS_ENDPOINT_URL) {
    return undefined;
  }

  try {
    const host = new URL(env.AWS_ENDPOINT_URL).host;
    return host.endsWith("amazonaws.com") ? undefined : env.AWS_ENDPOINT_URL;
  } catch {
    return env.AWS_ENDPOINT_URL;
  }
}

export async function issueRuntimeVolumeS3Credentials(input: {
  generationId?: string | null;
  roots: readonly Pick<RuntimeVolumeProjectionInput, "storagePrefix" | "readOnly">[];
  durationSeconds?: number;
}): Promise<RuntimeVolumeS3Credentials> {
  const roots = input.roots.map((root) => ({
    storagePrefix: ensureTrailingSlash(root.storagePrefix),
    readOnly: root.readOnly,
  }));
  if (roots.length === 0) {
    throw new Error("runtime_volume_credentials_no_roots: no Runtime Volume roots requested");
  }

  if (shouldUseStaticRuntimeVolumeCredentialsForLocalS3()) {
    logger.warn({
      event: "runtime_volume.local_static_s3_credentials",
      endpointHost: getRuntimeVolumeS3EndpointHost(),
      rootCount: roots.length,
    });
    return {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    };
  }

  const response = await getRuntimeVolumeStsClient().send(
    new GetFederationTokenCommand({
      Name: buildRuntimeVolumeCredentialSessionName(input.generationId),
      DurationSeconds: input.durationSeconds ?? RUNTIME_VOLUME_CREDENTIAL_TTL_SECONDS,
      Policy: JSON.stringify(buildRuntimeVolumeCredentialPolicy(roots)),
    }),
  );
  const credentials = response.Credentials;
  if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
    throw new Error("runtime_volume_credentials_unavailable: STS did not return session credentials");
  }

  return {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
    expiresAt: credentials.Expiration,
  };
}

function shouldUseStaticRuntimeVolumeCredentialsForLocalS3(): boolean {
  const host = getRuntimeVolumeS3EndpointHost();
  if (!host) {
    return false;
  }

  const hostname = host.split(":")[0]?.toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function getRuntimeVolumeS3EndpointHost(): string | undefined {
  if (!env.AWS_ENDPOINT_URL) {
    return undefined;
  }

  try {
    return new URL(env.AWS_ENDPOINT_URL).host;
  } catch {
    return env.AWS_ENDPOINT_URL;
  }
}

function buildRuntimeVolumeCredentialSessionName(generationId?: string | null): string {
  const source = generationId || randomUUID();
  const suffix = createHash("sha256").update(source).digest("hex").slice(0, 16);
  return `bap-rv-${suffix}`;
}

export function buildRuntimeVolumeCredentialPolicy(
  roots: readonly Pick<RuntimeVolumeProjectionInput, "storagePrefix" | "readOnly">[],
) {
  const readResources = roots.map(
    (root) => `arn:aws:s3:::${BUCKET_NAME}/${ensureTrailingSlash(root.storagePrefix)}*`,
  );
  const writeResources = roots
    .filter((root) => !root.readOnly)
    .map((root) => `arn:aws:s3:::${BUCKET_NAME}/${ensureTrailingSlash(root.storagePrefix)}*`);
  const listPrefixes = roots.flatMap((root) => {
    const prefix = ensureTrailingSlash(root.storagePrefix);
    return [prefix, `${prefix}*`];
  });

  const statements: unknown[] = [
    {
      Effect: "Allow",
      Action: ["s3:GetBucketLocation"],
      Resource: [`arn:aws:s3:::${BUCKET_NAME}`],
    },
    {
      Effect: "Allow",
      Action: ["s3:ListBucket"],
      Resource: [`arn:aws:s3:::${BUCKET_NAME}`],
      Condition: {
        StringLike: {
          "s3:prefix": Array.from(new Set(listPrefixes)),
        },
      },
    },
    {
      Effect: "Allow",
      Action: ["s3:GetObject"],
      Resource: Array.from(new Set(readResources)),
    },
  ];

  if (writeResources.length > 0) {
    statements.push({
      Effect: "Allow",
      Action: ["s3:ListBucketMultipartUploads"],
      Resource: [`arn:aws:s3:::${BUCKET_NAME}`],
      Condition: {
        StringLike: {
          "s3:prefix": Array.from(
            new Set(
              roots
                .filter((root) => !root.readOnly)
                .flatMap((root) => {
                  const prefix = ensureTrailingSlash(root.storagePrefix);
                  return [prefix, `${prefix}*`];
                }),
            ),
          ),
        },
      },
    });
    statements.push({
      Effect: "Allow",
      Action: [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
      ],
      Resource: Array.from(new Set(writeResources)),
    });
  }

  return {
    Version: "2012-10-17",
    Statement: statements,
  };
}

export async function upsertRuntimeVolumeProjection(input: RuntimeVolumeProjectionInput & {
  manifest: RuntimeVolumeManifest;
  error?: { code: string; message: string } | null;
}) {
  const now = new Date();
  const [row] = await db
    .insert(runtimeVolume)
    .values({
      workspaceId: input.workspaceId,
      kind: input.kind,
      ownerUserId: input.ownerUserId ?? null,
      coworkerId: input.coworkerId ?? null,
      storagePrefix: ensureTrailingSlash(input.storagePrefix),
      mountPath: input.mountPath,
      readOnly: input.readOnly,
      manifestHash: input.manifest.hash,
      manifest: [...input.manifest.entries],
      lastReconciledAt: now,
      lastReconciledGenerationId: input.generationId ?? null,
      lastErrorCode: input.error?.code ?? null,
      lastErrorMessage: input.error?.message ?? null,
    })
    .onConflictDoUpdate({
      target: runtimeVolume.storagePrefix,
      set: {
        workspaceId: input.workspaceId,
        kind: input.kind,
        ownerUserId: input.ownerUserId ?? null,
        coworkerId: input.coworkerId ?? null,
        mountPath: input.mountPath,
        readOnly: input.readOnly,
        manifestHash: input.manifest.hash,
        manifest: [...input.manifest.entries],
        lastReconciledAt: now,
        lastReconciledGenerationId: input.generationId ?? null,
        lastErrorCode: input.error?.code ?? null,
        lastErrorMessage: input.error?.message ?? null,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

export async function reconcileRuntimeVolumeProjection(input: RuntimeVolumeProjectionInput): Promise<{
  changed: boolean;
  manifestHash: string;
  entryCount: number;
}> {
  const prefix = ensureTrailingSlash(input.storagePrefix);
  const existing = await db.query.runtimeVolume.findFirst({
    where: eq(runtimeVolume.storagePrefix, prefix),
  });
  const manifest = await listRuntimeVolumeManifest(prefix);
  const warning = getRuntimeVolumeProjectionWarning(input, manifest);
  await upsertRuntimeVolumeProjection({
    ...input,
    storagePrefix: prefix,
    manifest,
    error: warning,
  });

  const changed = existing?.manifestHash !== manifest.hash;
  if (changed) {
    await reconcileRuntimeVolumeProductIndex({ ...input, storagePrefix: prefix }, manifest);
  }

  return {
    changed,
    manifestHash: manifest.hash,
    entryCount: manifest.entries.length,
  };
}

export async function migrateLegacyRuntimeVolumeDataForWorkspace(input: {
  workspaceId: string;
  dryRun?: boolean;
}): Promise<{
  migratedSkillCount: number;
  migratedCoworkerDocumentCount: number;
  reconciledRootCount: number;
}> {
  const skills = await db.query.skill.findMany({
    where: eq(skill.workspaceId, input.workspaceId),
    with: {
      files: true,
      documents: {
        with: {
          fileAsset: true,
        },
      },
    },
  });
  let migratedSkillCount = 0;
  const rootsToReconcile = new Map<string, RuntimeVolumeProjectionInput>();

  for (const row of skills) {
    const isShared = row.visibility === "public";
    const prefix = isShared
      ? buildSharedSkillsRuntimeVolumePrefix({ workspaceId: input.workspaceId })
      : buildOwnedSkillsRuntimeVolumePrefix({
          workspaceId: input.workspaceId,
          userId: row.userId,
        });
    const skillPrefix = appendRuntimeVolumeSkillSlug(prefix, row.name);
    rootsToReconcile.set(prefix, {
      workspaceId: input.workspaceId,
      kind: isShared ? "shared_skills" : "owned_skills",
      ownerUserId: isShared ? null : row.userId,
      storagePrefix: prefix,
      mountPath: isShared ? "/runtime/shared-skills" : "/runtime/skills",
      readOnly: isShared,
      generationId: null,
    });

    for (const file of row.files) {
      if (!input.dryRun) {
        await writeRuntimeVolumeFile({
          storagePrefix: skillPrefix,
          relativePath: file.path,
          body: Buffer.from(file.content ?? "", "utf8"),
          contentType: "text/plain; charset=utf-8",
        });
      }
    }

    for (const document of row.documents) {
      if (!input.dryRun) {
        const buffer = await downloadFromS3(document.fileAsset?.storageKey ?? document.storageKey);
        await writeRuntimeVolumeFile({
          storagePrefix: skillPrefix,
          relativePath: document.path || document.filename,
          body: buffer,
          contentType: document.mimeType,
        });
      }
    }

    migratedSkillCount += 1;
  }

  const coworkers = await db.query.coworker.findMany({
    where: eq(coworker.workspaceId, input.workspaceId),
    with: {
      documents: {
        with: {
          fileAsset: true,
        },
      },
    },
  });
  let migratedCoworkerDocumentCount = 0;

  for (const row of coworkers) {
    const prefix = buildCoworkerDocumentsRuntimeVolumePrefix({
      workspaceId: input.workspaceId,
      coworkerId: row.id,
    });
    rootsToReconcile.set(prefix, {
      workspaceId: input.workspaceId,
      kind: "coworker_documents",
      coworkerId: row.id,
      storagePrefix: prefix,
      mountPath: "/home/user/coworker-documents",
      readOnly: false,
      generationId: null,
    });
    for (const document of row.documents) {
      if (!input.dryRun) {
        const buffer = await downloadFromS3(document.fileAsset?.storageKey ?? document.storageKey);
        await writeRuntimeVolumeFile({
          storagePrefix: prefix,
          relativePath: document.filename,
          body: buffer,
          contentType: document.mimeType,
        });
      }
      migratedCoworkerDocumentCount += 1;
    }
  }

  if (!input.dryRun) {
    await Promise.all(
      Array.from(rootsToReconcile.values()).map((root) => reconcileRuntimeVolumeProjection(root)),
    );
  }

  return {
    migratedSkillCount,
    migratedCoworkerDocumentCount,
    reconciledRootCount: input.dryRun ? 0 : rootsToReconcile.size,
  };
}

async function reconcileRuntimeVolumeProductIndex(
  input: RuntimeVolumeProjectionInput,
  manifest: RuntimeVolumeManifest,
): Promise<void> {
  if (input.kind === "owned_skills" && input.ownerUserId) {
    await reconcileOwnedSkillsFromRuntimeVolume(input, manifest);
    return;
  }

  if (input.kind === "coworker_documents" && input.coworkerId) {
    await reconcileCoworkerDocumentsFromRuntimeVolume(input, manifest);
  }
}

function getRuntimeVolumeProjectionWarning(
  input: RuntimeVolumeProjectionInput,
  manifest: RuntimeVolumeManifest,
): { code: string; message: string } | null {
  if (input.kind !== "coworker_documents") {
    return null;
  }

  const nestedEntries = manifest.entries.filter((entry) => entry.path.includes("/"));
  if (nestedEntries.length === 0) {
    return null;
  }

  return {
    code: "unsupported_nested_coworker_document",
    message: `${nestedEntries.length} nested Coworker Document file${
      nestedEntries.length === 1 ? "" : "s"
    } ignored; Coworker Documents are flat in Runtime Volume v1.`,
  };
}

type RuntimeVolumeSkillFileEntry = RuntimeVolumeManifestEntry & {
  skillSlug: string;
  relativePath: string;
  objectRelativePath: string;
};

async function reconcileOwnedSkillsFromRuntimeVolume(
  input: RuntimeVolumeProjectionInput,
  manifest: RuntimeVolumeManifest,
): Promise<void> {
  if (!input.ownerUserId) {
    return;
  }

  const grouped = groupSkillManifestEntries(input.storagePrefix, manifest.entries);
  const skillSlugs = Array.from(grouped.keys()).toSorted();
  const selectedSkillSlug = getSelectedSkillSlugFromStoragePrefix(input.storagePrefix);
  if (!selectedSkillSlug) {
    const existingOwnedSkills = await db.query.skill.findMany({
      where: and(
        eq(skill.workspaceId, input.workspaceId),
        eq(skill.userId, input.ownerUserId),
        eq(skill.visibility, "private"),
      ),
      columns: { id: true, name: true },
    });
    const missingSkillIds = existingOwnedSkills
      .filter((existing) => !skillSlugs.includes(existing.name))
      .map((existing) => existing.id);
    if (missingSkillIds.length > 0) {
      await db.delete(skill).where(inArray(skill.id, missingSkillIds));
    }
  }

  if (skillSlugs.length === 0) {
    return;
  }

  for (const skillSlug of skillSlugs) {
    const entries = grouped.get(skillSlug) ?? [];
    const skillMdEntry = entries.find((entry) => entry.relativePath === "SKILL.md");
    const existing = await db.query.skill.findFirst({
      where: and(eq(skill.workspaceId, input.workspaceId), eq(skill.name, skillSlug)),
    });

    if (!skillMdEntry) {
      if (existing?.userId === input.ownerUserId) {
        await db.delete(skill).where(eq(skill.id, existing.id));
      }
      continue;
    }

    const skillMd = (await readRuntimeVolumeFile({
      storagePrefix: input.storagePrefix,
      relativePath: skillMdEntry.objectRelativePath,
    })).toString("utf8");
    const metadata = parseSkillMarkdownMetadata(skillMd, skillSlug, existing);

    if (existing && existing.userId !== input.ownerUserId) {
      logger.warn({
        event: "RUNTIME_VOLUME_SKILL_PROJECTION_SKIPPED_OWNER_MISMATCH",
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
        existingOwnerUserId: existing.userId,
        skillSlug,
      });
      continue;
    }

    const skillId = existing
      ? (
          await db
            .update(skill)
            .set({
              displayName: metadata.displayName,
              description: metadata.description,
              updatedAt: new Date(),
            })
            .where(eq(skill.id, existing.id))
            .returning({ id: skill.id })
        )[0]?.id
      : (
          await db
            .insert(skill)
            .values({
              userId: input.ownerUserId,
              workspaceId: input.workspaceId,
              name: skillSlug,
              displayName: metadata.displayName,
              description: metadata.description,
              visibility: "private",
              enabled: true,
            })
            .returning({ id: skill.id })
        )[0]?.id;

    if (!skillId) {
      continue;
    }

    const existingDocuments = await db.query.skillDocument.findMany({
      where: eq(skillDocument.skillId, skillId),
      columns: {
        path: true,
        description: true,
      },
    });
    const existingDocumentDescriptions = new Map(
      existingDocuments.map((document) => [document.path, document.description]),
    );

    await db.delete(skillFile).where(eq(skillFile.skillId, skillId));
    await db.delete(skillDocument).where(eq(skillDocument.skillId, skillId));

    const textFiles = entries.filter((entry) => isRuntimeVolumeTextSkillFile(entry.relativePath));
    if (textFiles.length > 0) {
      await db.insert(skillFile).values(
        await Promise.all(
          textFiles.map(async (entry) => ({
            skillId,
            path: entry.relativePath,
            content: null,
          })),
        ),
      );
    }

    const documentEntries = entries.filter(
      (entry) => !isRuntimeVolumeTextSkillFile(entry.relativePath),
    );
    if (documentEntries.length > 0) {
      await db.insert(skillDocument).values(
        documentEntries.map((entry) => ({
          skillId,
          filename: path.posix.basename(entry.relativePath),
          path: entry.relativePath,
          mimeType: inferRuntimeVolumeMimeType(entry.relativePath),
          sizeBytes: entry.sizeBytes,
          storageKey: buildRuntimeVolumeObjectKey(input.storagePrefix, entry.objectRelativePath),
          description: existingDocumentDescriptions.get(entry.relativePath) ?? null,
        })),
      );
    }
  }
}

async function reconcileCoworkerDocumentsFromRuntimeVolume(
  input: RuntimeVolumeProjectionInput,
  manifest: RuntimeVolumeManifest,
): Promise<void> {
  if (!input.coworkerId) {
    return;
  }

  const flatEntries = manifest.entries.filter((entry) => !entry.path.includes("/"));
  const filenames = flatEntries.map((entry) => entry.path);
  const existingDocuments = await db.query.coworkerDocument.findMany({
    where: eq(coworkerDocument.coworkerId, input.coworkerId),
  });
  const existingByFilename = new Map(existingDocuments.map((document) => [document.filename, document]));
  const missingIds = existingDocuments
    .filter((document) => !filenames.includes(document.filename))
    .map((document) => document.id);

  if (missingIds.length > 0) {
    await db.delete(coworkerDocument).where(inArray(coworkerDocument.id, missingIds));
  }

  for (const entry of flatEntries) {
    const existing = existingByFilename.get(entry.path);
    const values = {
      filename: entry.path,
      mimeType: inferRuntimeVolumeMimeType(entry.path),
      sizeBytes: entry.sizeBytes,
      storageKey: buildRuntimeVolumeObjectKey(input.storagePrefix, entry.path),
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(coworkerDocument).set(values).where(eq(coworkerDocument.id, existing.id));
      continue;
    }

    await db.insert(coworkerDocument).values({
      coworkerId: input.coworkerId,
      ...values,
    });
  }
}

function groupSkillManifestEntries(
  storagePrefix: string,
  entries: readonly RuntimeVolumeManifestEntry[],
): Map<string, RuntimeVolumeSkillFileEntry[]> {
  const selectedSkillSlug = getSelectedSkillSlugFromStoragePrefix(storagePrefix);
  const grouped = new Map<string, RuntimeVolumeSkillFileEntry[]>();

  for (const entry of entries) {
    const parts = entry.path.split("/");
    const skillSlug = selectedSkillSlug ?? parts[0];
    const relativePath = selectedSkillSlug ? entry.path : parts.slice(1).join("/");
    if (!skillSlug || !relativePath) {
      continue;
    }
    const group = grouped.get(skillSlug) ?? [];
    group.push({
      ...entry,
      skillSlug,
      relativePath,
      objectRelativePath: selectedSkillSlug ? entry.path : `${skillSlug}/${relativePath}`,
    });
    grouped.set(skillSlug, group);
  }

  return grouped;
}

function getSelectedSkillSlugFromStoragePrefix(storagePrefix: string): string | null {
  const marker = "/skills/";
  const normalized = ensureTrailingSlash(storagePrefix);
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const rest = normalized.slice(markerIndex + marker.length).replace(/\/$/, "");
  return rest || null;
}

function parseSkillMarkdownMetadata(
  markdown: string,
  fallbackSlug: string,
  existing?: { displayName: string; description: string } | null,
): {
  displayName: string;
  description: string;
} {
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/);
  const name = frontmatter ? parseFrontmatterScalar(frontmatter[1], "name") : null;
  const displayName = frontmatter ? parseFrontmatterScalar(frontmatter[1], "displayName") : null;
  const description = frontmatter ? parseFrontmatterScalar(frontmatter[1], "description") : null;

  return {
    displayName: displayName || existing?.displayName || name || fallbackSlug,
    description: description || existing?.description || "Runtime Volume skill",
  };
}

function parseFrontmatterScalar(frontmatter: string, key: string): string | null {
  const line = frontmatter
    .split("\n")
    .find((candidate) => candidate.match(new RegExp(`^${key}:\\s*`)));
  const raw = line?.replace(new RegExp(`^${key}:\\s*`), "").trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/^["']|["']$/g, "");
}

function isRuntimeVolumeTextSkillFile(relativePath: string): boolean {
  const ext = path.posix.extname(relativePath).toLowerCase();
  return (
    relativePath === "SKILL.md" ||
    [
      ".css",
      ".csv",
      ".js",
      ".json",
      ".md",
      ".py",
      ".sh",
      ".toml",
      ".ts",
      ".txt",
      ".yaml",
      ".yml",
    ].includes(ext)
  );
}

function inferRuntimeVolumeMimeType(relativePath: string): string {
  return lookupMimeType(relativePath) || "application/octet-stream";
}
