import { Daytona } from "@daytonaio/sdk";
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { image } from "./image";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, "../../../.env");

loadEnv({ path: ENV_PATH });

type SnapshotStage = "dev" | "staging" | "prod";

type DaytonaBuildConfig = {
  apiKey?: string;
  jwtToken?: string;
  organizationId?: string;
  apiUrl?: string;
  target?: string;
};

type DaytonaPushAccessResponse = {
  data: {
    storageUrl?: string;
  };
};

type DaytonaSdkError = {
  code?: string;
  path?: string;
  message?: string;
  errno?: number;
  response?: { status?: number };
  statusCode?: number;
};

const SNAPSHOT_DEFAULTS: Record<SnapshotStage, string> = {
  dev: "cmdclaw-agent-dev",
  staging: "cmdclaw-agent-staging",
  prod: "cmdclaw-agent-prod",
};

const SNAPSHOT_ENV_NAMES: Record<SnapshotStage, string> = {
  dev: "DAYTONA_SNAPSHOT_DEV",
  staging: "DAYTONA_SNAPSHOT_STAGING",
  prod: "DAYTONA_SNAPSHOT_PROD",
};

function readNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getDaytonaConfig(): DaytonaBuildConfig {
  const apiKey = process.env.DAYTONA_API_KEY;
  const jwtToken = process.env.DAYTONA_JWT_TOKEN;
  const organizationId = process.env.DAYTONA_ORGANIZATION_ID;
  const apiUrl = process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL;
  const target = process.env.DAYTONA_TARGET;

  if (!apiKey && !(jwtToken && organizationId)) {
    throw new Error(
      `Missing Daytona auth in ${ENV_PATH}. Set DAYTONA_API_KEY, or set both DAYTONA_JWT_TOKEN and DAYTONA_ORGANIZATION_ID.`,
    );
  }

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(jwtToken ? { jwtToken } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(apiUrl ? { apiUrl } : {}),
    ...(target ? { target } : {}),
  };
}

export function getSnapshotName(stage: SnapshotStage): string {
  if (stage === "dev") {
    return (
      readNonEmptyEnv("E2B_DAYTONA_SANDBOX_NAME") ??
      readNonEmptyEnv("DAYTONA_SNAPSHOT_DEV") ??
      SNAPSHOT_DEFAULTS.dev
    );
  }

  return readNonEmptyEnv(SNAPSHOT_ENV_NAMES[stage]) ?? SNAPSHOT_DEFAULTS[stage];
}

function describeStage(stage: SnapshotStage): string {
  if (stage === "prod") {
    return "production";
  }
  return stage;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorRecord(error: unknown): DaytonaSdkError {
  if (typeof error === "object" && error !== null) {
    return error as DaytonaSdkError;
  }
  return {};
}

function isConflictError(error: unknown): boolean {
  const record = getErrorRecord(error);
  const statusCode = Number(record.statusCode ?? record.response?.status);
  return statusCode === 409 || (record.message ?? "").includes("already exists");
}

function isLocalDaytonaApiUrl(apiUrl?: string): boolean {
  if (!apiUrl) {
    return false;
  }

  try {
    const parsed = new URL(apiUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function getLocalMinioPort(): string {
  return process.env.CMDCLAW_MINIO_API_PORT?.trim() || "9100";
}

export function rewriteStorageUrlForHostBuild(storageUrl: string, apiUrl?: string): string {
  const override = process.env.DAYTONA_OBJECT_STORAGE_URL?.trim();
  if (override) {
    return override;
  }

  if (!isLocalDaytonaApiUrl(apiUrl)) {
    return storageUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(storageUrl);
  } catch {
    return storageUrl;
  }

  if (parsed.hostname !== "minio" || parsed.port !== "9000") {
    return storageUrl;
  }

  parsed.hostname = "localhost";
  parsed.port = getLocalMinioPort();
  return parsed.toString();
}

function installLocalObjectStorageRewrite(daytona: Daytona, apiUrl?: string): void {
  const originalApi = (daytona as any).objectStorageApi as
    | {
        getPushAccess: (...args: unknown[]) => Promise<DaytonaPushAccessResponse>;
      }
    | undefined;

  if (!originalApi) {
    return;
  }

  const originalGetPushAccess = originalApi.getPushAccess.bind(originalApi);
  originalApi.getPushAccess = async (...args: unknown[]) => {
    const response = await originalGetPushAccess(...args);
    const storageUrl = response.data?.storageUrl;
    if (!storageUrl) {
      return response;
    }

    const rewrittenStorageUrl = rewriteStorageUrlForHostBuild(storageUrl, apiUrl);
    if (rewrittenStorageUrl !== storageUrl) {
      console.log(
        `[daytona] Rewriting local object storage endpoint for host build: ${storageUrl} -> ${rewrittenStorageUrl}`,
      );
      response.data.storageUrl = rewrittenStorageUrl;
    }

    return response;
  };
}

export function formatDaytonaBuildError(error: unknown, apiUrl?: string): string | null {
  const record = getErrorRecord(error);
  const failedPath = record.path;
  const isMinioSocketError =
    record.code === "FailedToOpenSocket" &&
    typeof failedPath === "string" &&
    failedPath.includes("minio:9000");

  if (!isMinioSocketError) {
    return null;
  }

  const locationHint = isLocalDaytonaApiUrl(apiUrl)
    ? `Your current DAYTONA_API_URL points to a local Daytona API (${apiUrl}).`
    : "The Daytona API appears to be returning an internal object-storage URL.";

  return [
    "Daytona snapshot build failed while uploading the build context to object storage.",
    `The presigned URL points to ${failedPath}, which is only reachable from inside the Docker network.`,
    locationHint,
    "For the local compose stack, either run the build from a container on that network or reconfigure Daytona/MinIO so presigned URLs use a host-reachable address such as http://localhost:9100.",
  ].join(" ");
}

async function createOrReplaceSnapshot(daytona: Daytona, name: string) {
  const tryCreate = async () => {
    console.log(`[daytona] Requesting snapshot build: ${name}`);
    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      console.log(`[daytona] Waiting for build logs... (${seconds}s)`);
    }, 5_000);

    try {
      return await daytona.snapshot.create(
        { name, image },
        {
          onLogs: (chunk) => console.log(`[daytona] ${chunk}`),
        },
      );
    } finally {
      clearInterval(heartbeat);
    }
  };

  const retryCreate = async (attempt: number, lastError?: unknown) => {
    if (attempt > 8) {
      throw new Error(`Unable to recreate snapshot "${name}" after replacement retries.`, {
        cause: lastError,
      });
    }

    await sleep(1_000 * attempt);
    try {
      return await tryCreate();
    } catch (retryError) {
      if (!isConflictError(retryError)) {
        throw retryError;
      }
      return retryCreate(attempt + 1, retryError);
    }
  };

  try {
    return await tryCreate();
  } catch (error) {
    if (!isConflictError(error)) {
      throw error;
    }

    console.log(`[daytona] Snapshot "${name}" already exists, replacing it...`);
    const existing = await daytona.snapshot.get(name);
    await daytona.snapshot.delete(existing);
    return retryCreate(1, error);
  }
}

export async function buildSnapshot(stage: SnapshotStage): Promise<void> {
  const name = getSnapshotName(stage);
  const config = getDaytonaConfig();

  console.log(`[daytona] Preparing ${describeStage(stage)} snapshot build: ${name}`);
  console.log("[daytona] Initializing client...");
  const daytona = new Daytona(config);
  installLocalObjectStorageRewrite(daytona, config.apiUrl);
  console.log("[daytona] Client initialized, starting snapshot build...");

  try {
    const snapshot = await createOrReplaceSnapshot(daytona, name);
    console.log("[daytona] Snapshot created:", snapshot.id ?? name);
  } catch (error) {
    const message = formatDaytonaBuildError(error, config.apiUrl);
    if (message) {
      throw new Error(message, { cause: error });
    }
    throw error;
  }
}
