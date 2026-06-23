import { db } from "@bap/db/client";
import { coworkerDocument } from "@bap/db/schema";
import { eq } from "drizzle-orm";
import path from "path";
import { downloadFromS3 } from "../../storage/s3-client";

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  const fallback = trimmed.length > 0 ? trimmed : "document";
  return fallback.replace(/[\\/:*?"<>|]/g, "_");
}

function buildUniqueFilename(filename: string, seen: Set<string>): string {
  const parsed = path.posix.parse(sanitizeFilename(filename));
  const baseName = parsed.name || "document";
  const extension = parsed.ext;
  let candidate = `${baseName}${extension}`;
  let index = 1;

  while (seen.has(candidate)) {
    candidate = `${baseName}-${index}${extension}`;
    index += 1;
  }

  seen.add(candidate);
  return candidate;
}

export async function writeCoworkerDocumentsToSandbox(
  sandbox: {
    exec(
      command: string,
      opts?: {
        timeoutMs?: number;
        env?: Record<string, string>;
        background?: boolean;
        onStderr?: (chunk: string) => void;
      },
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
    writeFile(path: string, content: string | ArrayBuffer): Promise<void>;
  },
  coworkerId: string,
): Promise<string[]> {
  const documents = await db.query.coworkerDocument.findMany({
    where: eq(coworkerDocument.coworkerId, coworkerId),
    orderBy: (row, { asc }) => [asc(row.createdAt), asc(row.filename)],
    with: {
      fileAsset: true,
    },
  });

  if (documents.length === 0) {
    return [];
  }

  const targetDir = `/home/user/coworker-documents/${coworkerId}`;
  await sandbox.exec(`mkdir -p ${JSON.stringify(targetDir)}`);

  const seenFilenames = new Set<string>();
  const writtenPaths: string[] = [];

  await Promise.all(
    documents.map(async (document) => {
      try {
        const buffer = await downloadFromS3(document.fileAsset?.storageKey ?? document.storageKey);
        const sandboxFilename = buildUniqueFilename(document.filename, seenFilenames);
        const sandboxPath = `${targetDir}/${sandboxFilename}`;
        await sandbox.writeFile(
          sandboxPath,
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          ) as ArrayBuffer,
        );
        writtenPaths.push(sandboxPath);
      } catch (error) {
        console.error(
          `[CoworkerDocumentsPrep] Failed to write document ${document.filename} for coworker ${coworkerId}:`,
          error,
        );
      }
    }),
  );

  return writtenPaths.toSorted();
}
