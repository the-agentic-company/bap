import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../env";

const S3_ERROR_BODY_LOG_LIMIT = 2048;

// S3 client singleton
let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    if (!env.AWS_ENDPOINT_URL || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      throw new Error(
        "S3 configuration is incomplete. Check AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY.",
      );
    }

    s3Client = new S3Client({
      endpoint: env.AWS_ENDPOINT_URL,
      region: env.AWS_DEFAULT_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
      forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE,
    });
  }
  return s3Client;
}

export const BUCKET_NAME = env.AWS_S3_BUCKET_NAME;

function getS3EndpointHost(): string | undefined {
  if (!env.AWS_ENDPOINT_URL) {
    return undefined;
  }

  try {
    return new URL(env.AWS_ENDPOINT_URL).host;
  } catch {
    return env.AWS_ENDPOINT_URL;
  }
}

function summarizeS3Key(key?: string): { key?: string; keyPrefix?: string; keyLength?: number } {
  if (!key) {
    return {};
  }

  if (key.startsWith("opencode-session-snapshots/")) {
    return { key, keyLength: key.length };
  }

  const parts = key.split("/");
  const keyPrefix =
    parts.length > 1 ? `${parts.slice(0, 3).join("/")}${parts.length > 3 ? "/..." : ""}` : key;
  return { keyPrefix, keyLength: key.length };
}

type S3ErrorWithMetadata = {
  name?: string;
  message?: string;
  Code?: string;
  code?: string;
  $metadata?: {
    httpStatusCode?: number;
    requestId?: string;
    extendedRequestId?: string;
    attempts?: number;
    totalRetryDelay?: number;
  };
  $response?: {
    statusCode?: number;
    reason?: string;
    headers?: Record<string, string | string[] | undefined>;
    body?: unknown;
  };
};

function truncateForLog(value: string): string {
  if (value.length <= S3_ERROR_BODY_LOG_LIMIT) {
    return value;
  }
  return `${value.slice(0, S3_ERROR_BODY_LOG_LIMIT)}...[truncated ${value.length - S3_ERROR_BODY_LOG_LIMIT} chars]`;
}

async function readS3ErrorResponseBody(error: unknown): Promise<string | undefined> {
  const body = (error as S3ErrorWithMetadata).$response?.body;
  if (!body) {
    return undefined;
  }

  try {
    if (typeof body === "string") {
      return truncateForLog(body);
    }

    if (body instanceof Uint8Array) {
      return truncateForLog(Buffer.from(body).toString("utf8"));
    }

    if (body instanceof ArrayBuffer) {
      return truncateForLog(Buffer.from(body).toString("utf8"));
    }

    if (typeof body === "object" && body !== null) {
      const transformable = body as { transformToString?: () => Promise<string> };
      if (typeof transformable.transformToString === "function") {
        return truncateForLog(await transformable.transformToString());
      }

      const asyncIterable = body as Partial<AsyncIterable<Uint8Array>>;
      if (typeof asyncIterable[Symbol.asyncIterator] === "function") {
        const chunks: Uint8Array[] = [];
        let totalLength = 0;
        for await (const chunk of asyncIterable as AsyncIterable<Uint8Array>) {
          chunks.push(chunk);
          totalLength += chunk.byteLength;
          if (totalLength >= S3_ERROR_BODY_LOG_LIMIT) {
            break;
          }
        }
        return truncateForLog(Buffer.concat(chunks).toString("utf8"));
      }
    }
  } catch (readError) {
    return `[failed to read S3 error response body: ${
      readError instanceof Error ? readError.message : String(readError)
    }]`;
  }

  return undefined;
}

async function logS3OperationError(
  operation: string,
  key: string | undefined,
  error: unknown,
): Promise<void> {
  const err = error as S3ErrorWithMetadata;
  console.error("[S3] Operation failed", {
    operation,
    bucket: BUCKET_NAME,
    ...summarizeS3Key(key),
    endpointHost: getS3EndpointHost(),
    region: env.AWS_DEFAULT_REGION,
    forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE,
    name: err.name,
    code: err.Code ?? err.code,
    message: err.message,
    httpStatusCode: err.$metadata?.httpStatusCode,
    requestId: err.$metadata?.requestId,
    extendedRequestId: err.$metadata?.extendedRequestId,
    attempts: err.$metadata?.attempts,
    totalRetryDelay: err.$metadata?.totalRetryDelay,
    responseStatusCode: err.$response?.statusCode,
    responseReason: err.$response?.reason,
    responseBody: await readS3ErrorResponseBody(error),
  });
}

async function sendS3Operation<T>(
  operation: string,
  key: string | undefined,
  send: () => Promise<T>,
): Promise<T> {
  try {
    return await send();
  } catch (error) {
    await logS3OperationError(operation, key, error);
    throw error;
  }
}

// Ensure bucket exists (call on startup or first upload)
export async function ensureBucket(): Promise<void> {
  const client = getS3Client();

  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
  } catch (error: unknown) {
    const err = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      await sendS3Operation("CreateBucket", undefined, () =>
        client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME })),
      );
      console.log(`Created S3 bucket: ${BUCKET_NAME}`);
    } else {
      await logS3OperationError("HeadBucket", undefined, error);
      throw error;
    }
  }
}

// Upload file to S3
export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<void> {
  const client = getS3Client();

  await sendS3Operation("PutObject", key, () =>
    client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    ),
  );
}

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds: number = 900,
): Promise<string> {
  const client = getS3Client();

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export async function headS3Object(key: string): Promise<{
  sizeBytes: number;
  contentType?: string;
  etag?: string;
}> {
  const client = getS3Client();

  const response = await sendS3Operation("HeadObject", key, () =>
    client.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      }),
    ),
  );

  return {
    sizeBytes: response.ContentLength ?? 0,
    contentType: response.ContentType,
    etag: response.ETag,
  };
}

export type ListedS3Object = {
  key: string;
  sizeBytes: number;
  etag?: string;
  lastModified?: Date;
};

export async function listS3Objects(prefix: string): Promise<ListedS3Object[]> {
  const client = getS3Client();
  const objects: ListedS3Object[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await sendS3Operation("ListObjectsV2", prefix, () =>
      client.send(
        new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      ),
    );

    for (const entry of response.Contents ?? []) {
      if (!entry.Key) {
        continue;
      }
      objects.push({
        key: entry.Key,
        sizeBytes: entry.Size ?? 0,
        etag: entry.ETag,
        lastModified: entry.LastModified,
      });
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

// Delete file from S3
export async function deleteFromS3(key: string): Promise<void> {
  const client = getS3Client();

  await sendS3Operation("DeleteObject", key, () =>
    client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      }),
    ),
  );
}

// Generate presigned URL for downloading
export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds: number = 3600,
  options?: {
    filename?: string;
    contentType?: string;
  },
): Promise<string> {
  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: options?.filename
      ? buildDownloadContentDisposition(options.filename)
      : undefined,
    ResponseContentType: options?.contentType,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

function buildDownloadContentDisposition(filename: string): string {
  const fallback =
    filename
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/["\\]/g, "")
      .replace(/[/:]/g, "-")
      .trim() || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Download file content from S3 as Buffer
export async function downloadFromS3(key: string): Promise<Buffer> {
  const client = getS3Client();

  const response = await sendS3Operation("GetObject", key, () =>
    client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      }),
    ),
  );

  if (!response.Body) {
    throw new Error(`No body returned for S3 key: ${key}`);
  }

  // Convert the readable stream to a buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Generate storage key for a skill document
export function generateStorageKey(userId: string, skillId: string, filename: string): string {
  const timestamp = Date.now();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `skills/${userId}/${skillId}/${timestamp}-${sanitizedFilename}`;
}
