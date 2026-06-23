import type { db as database } from "@bap/db/client";
import {
  createFileAssetFromBuffer,
  markFileAssetReference,
} from "@bap/core/server/services/file-asset-service";
import { resolveUniqueSkillNameInWorkspace } from "@bap/core/server/services/workspace-skill-service";
import { skill, skillDocument, skillFile } from "@bap/db/schema";
import { ORPCError } from "@orpc/server";
import { lookup as lookupMimeType } from "mime-types";
import { Buffer } from "node:buffer";
import path from "node:path";
import * as yauzl from "yauzl";
import { parseSkillContent } from "@/lib/skill-markdown";

const MAX_ZIP_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_EXTRACTED_BYTES = 25 * 1024 * 1024;
const MAX_FILE_COUNT = 100;
const MAX_PATH_LENGTH = 256;

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/x-sh",
  "image/svg+xml",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".py",
  ".sh",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

type ZipModeInput = {
  mode: "zip";
  filename: string;
  contentBase64: string;
};

type FolderModeInput = {
  mode: "folder";
  files: Array<{
    path: string;
    mimeType?: string | null;
    contentBase64: string;
  }>;
};

export type ImportSkillInput = ZipModeInput | FolderModeInput;
type DatabaseLike = typeof database;

type RawImportEntry = {
  path: string;
  content: Buffer;
  mimeType?: string;
};

type NormalizedTextEntry = {
  type: "text";
  path: string;
  content: string;
};

type NormalizedBinaryEntry = {
  type: "binary";
  path: string;
  filename: string;
  mimeType: string;
  content: Buffer;
};

type NormalizedImportEntry = NormalizedTextEntry | NormalizedBinaryEntry;

type ParsedSkillMetadata = {
  rawName: string;
  slug: string;
  description: string;
  displayName: string;
};

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function badRequest(message: string) {
  return new ORPCError("BAD_REQUEST", { message });
}

function toSkillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function parseSkillMetadata(markdown: string): ParsedSkillMetadata {
  const parsed = parseSkillContent(markdown);
  if (!parsed.frontmatter) {
    throw badRequest("SKILL.md must start with YAML frontmatter.");
  }

  const rawName = parsed.name.trim();
  const slug = toSkillSlug(rawName);
  const description = parsed.description.trim();

  if (!slug) {
    throw badRequest("SKILL.md must include a valid 'name' frontmatter value.");
  }
  if (description.length === 0 || description.length > 1024) {
    throw badRequest("SKILL.md must include a non-empty 'description' under 1024 characters.");
  }

  return {
    rawName,
    slug,
    description,
    displayName: rawName || titleCaseSlug(slug),
  };
}

function normalizePath(inputPath: string): string {
  const trimmed = inputPath
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  if (!trimmed) {
    throw badRequest("Import contains an empty file path.");
  }
  if (trimmed.startsWith("/")) {
    throw badRequest(`Import path '${inputPath}' must be relative.`);
  }

  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw badRequest(`Import path '${inputPath}' is invalid.`);
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw badRequest(`Import path '${inputPath}' is invalid.`);
  }

  const normalized = segments.join("/");
  if (normalized.length > MAX_PATH_LENGTH) {
    throw badRequest(`Import path '${normalized}' exceeds ${MAX_PATH_LENGTH} characters.`);
  }

  return normalized;
}

function shouldIgnorePath(inputPath: string): boolean {
  const basename = path.posix.basename(inputPath);
  return inputPath.startsWith("__MACOSX/") || basename === ".DS_Store";
}

function stripCommonRoot(entries: RawImportEntry[]): RawImportEntry[] {
  if (entries.length === 0) {
    throw badRequest("Import does not contain any files.");
  }

  const firstSegments = entries.map((entry) => entry.path.split("/")[0] ?? "");
  const commonRoot = firstSegments[0];
  if (!commonRoot || firstSegments.some((segment) => segment !== commonRoot)) {
    return entries;
  }
  if (entries.some((entry) => !entry.path.includes("/"))) {
    return entries;
  }

  return entries.map((entry) => ({
    ...entry,
    path: entry.path.slice(commonRoot.length + 1),
  }));
}

function isTextLike(pathname: string, mimeType: string | undefined, content: Buffer): boolean {
  const extension = path.posix.extname(pathname).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }
  if (mimeType?.startsWith("text/") || (mimeType && TEXT_MIME_TYPES.has(mimeType))) {
    return true;
  }
  if (content.includes(0)) {
    return false;
  }

  try {
    utf8Decoder.decode(content);
    return true;
  } catch {
    return false;
  }
}

function decodeUtf8(pathname: string, content: Buffer): string {
  try {
    return utf8Decoder.decode(content);
  } catch {
    throw badRequest(`File '${pathname}' must be valid UTF-8 text.`);
  }
}

function resolveMimeType(pathname: string, providedMimeType?: string): string {
  return providedMimeType || lookupMimeType(pathname) || "application/octet-stream";
}

function assertArchiveSafety(entries: RawImportEntry[]): void {
  if (entries.length === 0) {
    throw badRequest("Import does not contain any files.");
  }
  if (entries.length > MAX_FILE_COUNT) {
    throw badRequest(`Import exceeds the ${MAX_FILE_COUNT} file limit.`);
  }

  let totalSize = 0;
  const seenPaths = new Set<string>();
  for (const entry of entries) {
    totalSize += entry.content.length;
    if (entry.content.length > MAX_FILE_SIZE_BYTES) {
      throw badRequest(
        `File '${entry.path}' exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB size limit.`,
      );
    }
    if (totalSize > MAX_TOTAL_EXTRACTED_BYTES) {
      throw badRequest(
        `Import exceeds the ${(MAX_TOTAL_EXTRACTED_BYTES / 1024 / 1024).toFixed(0)} MB total size limit.`,
      );
    }
    if (seenPaths.has(entry.path)) {
      throw badRequest(`Import contains duplicate path '${entry.path}'.`);
    }
    seenPaths.add(entry.path);
    if (entry.path.toLowerCase().endsWith(".zip")) {
      throw badRequest(`Nested archive '${entry.path}' is not allowed.`);
    }
  }
}

function normalizeEntries(rawEntries: RawImportEntry[]): NormalizedImportEntry[] {
  const sanitizedEntries = rawEntries
    .map((entry) => ({
      ...entry,
      path: normalizePath(entry.path),
    }))
    .filter((entry) => !shouldIgnorePath(entry.path));

  const strippedEntries = stripCommonRoot(sanitizedEntries);

  assertArchiveSafety(strippedEntries);

  const normalizedEntries = strippedEntries.map((entry) => {
    const mimeType = resolveMimeType(entry.path, entry.mimeType);
    if (isTextLike(entry.path, mimeType, entry.content)) {
      return {
        type: "text",
        path: entry.path,
        content: decodeUtf8(entry.path, entry.content),
      } satisfies NormalizedTextEntry;
    }

    return {
      type: "binary",
      path: entry.path,
      filename: path.posix.basename(entry.path),
      mimeType,
      content: entry.content,
    } satisfies NormalizedBinaryEntry;
  });

  const skillFileEntry = normalizedEntries.find((entry) => entry.path === "SKILL.md");
  if (!skillFileEntry || skillFileEntry.type !== "text") {
    throw badRequest("Import must contain a root-level SKILL.md file.");
  }

  return normalizedEntries;
}

function isSymlinkEntry(entry: yauzl.Entry): boolean {
  const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
  return fileType === 0o120000;
}

async function readZipEntries(buffer: Buffer): Promise<RawImportEntry[]> {
  if (buffer.length > MAX_ZIP_SIZE_BYTES) {
    throw badRequest(`Zip exceeds the ${MAX_ZIP_SIZE_BYTES / 1024 / 1024} MB size limit.`);
  }

  return await new Promise<RawImportEntry[]>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(badRequest("Failed to read zip archive."));
        return;
      }

      const entries: RawImportEntry[] = [];
      let totalSize = 0;
      let settled = false;

      const resolveOnce = (value: RawImportEntry[]) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      const rejectAndClose = (reason: ReturnType<typeof badRequest>) => {
        if (settled) {
          return;
        }
        settled = true;
        zipfile.close();
        reject(reason);
      };

      zipfile.on("error", () => {
        rejectAndClose(badRequest("Failed to read zip archive."));
      });

      zipfile.on("entry", (entry) => {
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
          rejectAndClose(badRequest("Encrypted zip entries are not supported."));
          return;
        }

        if (entry.fileName.endsWith("/")) {
          zipfile.readEntry();
          return;
        }

        if (isSymlinkEntry(entry)) {
          rejectAndClose(badRequest(`Zip entry '${entry.fileName}' is not a regular file.`));
          return;
        }

        if (entry.uncompressedSize > MAX_FILE_SIZE_BYTES) {
          rejectAndClose(
            badRequest(
              `File '${entry.fileName}' exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB size limit.`,
            ),
          );
          return;
        }

        zipfile.openReadStream(entry, (streamError, readStream) => {
          if (streamError || !readStream) {
            rejectAndClose(badRequest(`Failed to extract '${entry.fileName}' from zip.`));
            return;
          }

          const chunks: Buffer[] = [];
          let entrySize = 0;

          readStream.on("data", (chunk: Buffer) => {
            entrySize += chunk.length;
            totalSize += chunk.length;
            if (entrySize > MAX_FILE_SIZE_BYTES) {
              readStream.destroy(badRequest(`File '${entry.fileName}' exceeds the allowed size.`));
              return;
            }
            if (totalSize > MAX_TOTAL_EXTRACTED_BYTES) {
              readStream.destroy(
                badRequest(
                  `Import exceeds the ${(MAX_TOTAL_EXTRACTED_BYTES / 1024 / 1024).toFixed(0)} MB total size limit.`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });

          readStream.on("error", (streamReadError) => {
            if (streamReadError instanceof ORPCError) {
              rejectAndClose(streamReadError);
              return;
            }
            rejectAndClose(badRequest(`Failed to extract '${entry.fileName}' from zip.`));
          });

          readStream.on("end", () => {
            entries.push({
              path: entry.fileName,
              content: Buffer.concat(chunks),
            });
            if (entries.length > MAX_FILE_COUNT) {
              rejectAndClose(badRequest(`Import exceeds the ${MAX_FILE_COUNT} file limit.`));
              return;
            }
            zipfile.readEntry();
          });
        });
      });

      zipfile.on("end", () => resolveOnce(entries));
      zipfile.readEntry();
    });
  });
}

async function collectRawEntries(input: ImportSkillInput): Promise<RawImportEntry[]> {
  if (input.mode === "folder") {
    return input.files.map((file) => ({
      path: file.path,
      mimeType: file.mimeType ?? undefined,
      content: Buffer.from(file.contentBase64, "base64"),
    }));
  }

  if (!input.filename.toLowerCase().endsWith(".zip")) {
    throw badRequest("Import expects a .zip archive.");
  }

  return await readZipEntries(Buffer.from(input.contentBase64, "base64"));
}

function resolveImportedDisplayName(
  baseDisplayName: string,
  _baseSlug: string,
  _resolvedSlug: string,
): string {
  return baseDisplayName;
}

export async function importSkill(
  database: DatabaseLike,
  userId: string,
  workspaceId: string,
  input: ImportSkillInput,
): Promise<{
  id: string;
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
}> {
  const normalizedEntries = normalizeEntries(await collectRawEntries(input));
  const skillMarkdown = normalizedEntries.find((entry) => entry.path === "SKILL.md");
  if (!skillMarkdown || skillMarkdown.type !== "text") {
    throw badRequest("Import must contain a root-level SKILL.md file.");
  }

  const parsedMetadata = parseSkillMetadata(skillMarkdown.content);
  const resolvedSlug = await resolveUniqueSkillNameInWorkspace(
    database,
    workspaceId,
    parsedMetadata.slug,
  ).catch((error) => {
    throw badRequest(
      error instanceof Error ? error.message : "Could not allocate a unique skill name.",
    );
  });
  const resolvedDisplayName = resolveImportedDisplayName(
    parsedMetadata.displayName,
    parsedMetadata.slug,
    resolvedSlug,
  );

  return await database.transaction(async (tx) => {
    const [createdSkill] = await tx
      .insert(skill)
      .values({
        userId,
        workspaceId,
        name: resolvedSlug,
        displayName: resolvedDisplayName,
        description: parsedMetadata.description,
        icon: null,
        visibility: "private",
        enabled: true,
      })
      .returning({
        id: skill.id,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
      });

    const textEntries = normalizedEntries.filter(
      (entry): entry is NormalizedTextEntry => entry.type === "text",
    );
    const binaryEntries = normalizedEntries.filter(
      (entry): entry is NormalizedBinaryEntry => entry.type === "binary",
    );

    if (textEntries.length > 0) {
      await tx.insert(skillFile).values(
        textEntries.map((entry) => ({
          skillId: createdSkill.id,
          path: entry.path,
          content: entry.content,
        })),
      );
    }

    if (binaryEntries.length > 0) {
      await Promise.all(
        binaryEntries.map(async (entry) => {
          const asset = await createFileAssetFromBuffer({
            database: tx as unknown as typeof database,
            userId,
            workspaceId,
            filename: entry.filename,
            mimeType: entry.mimeType,
            content: entry.content,
          });
          const [document] = await tx
            .insert(skillDocument)
            .values({
              skillId: createdSkill.id,
              fileAssetId: asset.id,
              filename: asset.filename,
              path: entry.path,
              mimeType: asset.mimeType,
              sizeBytes: asset.sizeBytes,
              storageKey: asset.storageKey,
              description: null,
            })
            .returning({ id: skillDocument.id });

          if (document) {
            await markFileAssetReference({
              database: tx as unknown as typeof database,
              fileAssetId: asset.id,
              kind: "skill_document",
              referenceId: document.id,
            });
          }
        }),
      );
    }

    return {
      id: createdSkill.id,
      name: createdSkill.name,
      displayName: createdSkill.displayName,
      description: createdSkill.description,
      enabled: true,
    };
  });
}
