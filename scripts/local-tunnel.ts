import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { matchWorktreePublicRoute } from "../packages/core/src/lib/worktree-routing";
import {
  resolveConfiguredSharedWorktreeRoot,
  resolveSharedWorktreeInstanceRoot,
} from "../.agents/skills/worktree/cli/src/coordination";

type InstanceMetadata = {
  instanceId: string;
  repoRoot: string;
  appUrl: string;
  minioBucketName?: string;
};

const DEFAULT_PROXY_PORT = 3399;
const LOCAL_TUNNEL_HEALTH_PATH = "/__localcan/health";
const LOCAL_TUNNEL_HEALTH_TIMEOUT_MS = 500;

type LocalTunnelHealthResponse = {
  ok?: boolean;
  proxy?: string;
};

function fail(message: string): never {
  console.error(`[worktree] ${message}`);
  process.exit(1);
  throw new Error(message);
}

function runCommand(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed: ${
        result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`
      }`,
    );
  }
  return result.stdout.trim();
}

function resolveRepoRoot(): string {
  return runCommand("git", ["rev-parse", "--show-toplevel"], process.cwd());
}

function slugify(value: string, separator: "-" | "_" = "-"): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`\\${separator}+`, "g"), separator)
    .replace(new RegExp(`^\\${separator}|\\${separator}$`, "g"), "");

  return normalized || "main";
}

function buildInstanceId(repoRoot: string): string {
  const base = slugify(repoRoot.split("/").filter(Boolean).at(-1) ?? "bap");
  const hash = createHash("sha1").update(repoRoot).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

function isMainCheckout(repoRoot: string): boolean {
  try {
    return statSync(join(repoRoot, ".git")).isDirectory();
  } catch {
    return false;
  }
}

function listWorktreeRoots(repoRoot: string): string[] {
  const worktreeList = runCommand("git", ["worktree", "list", "--porcelain"], repoRoot);
  return Array.from(
    new Set(
      worktreeList
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length))
        .filter(Boolean),
    ),
  );
}

function loadInstanceMetadata(worktreeRoot: string): InstanceMetadata | null {
  const instanceId = buildInstanceId(worktreeRoot);
  const metadataFile = join(resolveInstanceRoot(instanceId), "metadata.json");
  if (!existsSync(metadataFile)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(metadataFile, "utf8")) as Partial<InstanceMetadata>;
    if (
      typeof parsed.instanceId !== "string" ||
      typeof parsed.repoRoot !== "string" ||
      typeof parsed.appUrl !== "string"
    ) {
      return null;
    }
    return {
      instanceId: parsed.instanceId,
      repoRoot: parsed.repoRoot,
      appUrl: parsed.appUrl,
      minioBucketName:
        typeof parsed.minioBucketName === "string" ? parsed.minioBucketName : undefined,
    };
  } catch {
    return null;
  }
}

function resolveInstanceRoot(instanceId: string): string {
  const sharedRoot = resolveConfiguredSharedWorktreeRoot({
    cwd: process.cwd(),
    homeDir: process.env.HOME,
    explicitRoot: process.env.BAP_SHARED_WORKTREE_ROOT,
  });
  return resolveSharedWorktreeInstanceRoot(sharedRoot, instanceId);
}

function resolveMainAppUrl(): string {
  return `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
}

function resolveLocalMinioUrl(): string {
  return `http://127.0.0.1:${process.env.BAP_MINIO_API_PORT ?? process.env.APP_MINIO_API_PORT ?? "9000"}`;
}

function buildLocalTunnelHealthUrl(port: number): string {
  return `http://127.0.0.1:${port}${LOCAL_TUNNEL_HEALTH_PATH}`;
}

async function isHealthyLocalTunnelRunning(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_TUNNEL_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(buildLocalTunnelHealthUrl(port), {
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }

    const body = (await response.json()) as LocalTunnelHealthResponse;
    return body.ok === true && body.proxy === "localcan";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function buildProxyRequest(
  request: Request,
  target: URL,
  requestUrl: URL,
  options: { preserveHost?: boolean } = {},
): Request {
  const headers = new Headers(request.headers);
  if (!options.preserveHost) {
    headers.set("host", target.host);
  }
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));
  headers.set("x-bap-localcan-proxy", "1");
  return new Request(target, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
    redirect: "manual",
  } as RequestInit & { duplex: "half" });
}

async function idleInWorktree(): Promise<never> {
  console.log("[worktree] in a worktree; there is nothing for me to do here");
  await new Promise(() => {});
  throw new Error("unreachable");
}

export async function runLocalTunnelProxy(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  if (!isMainCheckout(repoRoot) && process.env.BAP_LOCAL_TUNNEL_ALLOW_WORKTREE !== "1") {
    await idleInWorktree();
    return;
  }

  const port = Number.parseInt(
    process.env.LOCAL_TUNNEL_PROXY_PORT ?? String(DEFAULT_PROXY_PORT),
    10,
  );
  if (await isHealthyLocalTunnelRunning(port)) {
    console.log(`[worktree] local tunnel already running and healthy on http://127.0.0.1:${port}`);
    return;
  }

  Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request: Request) {
      const requestUrl = new URL(request.url);

      if (requestUrl.pathname === LOCAL_TUNNEL_HEALTH_PATH) {
        return Response.json({
          ok: true,
          proxy: "localcan",
          mainAppUrl: resolveMainAppUrl(),
        });
      }

      const worktreeMetadata = listWorktreeRoots(repoRoot)
        .map((worktreeRoot) => loadInstanceMetadata(worktreeRoot))
        .filter((metadata): metadata is InstanceMetadata => metadata !== null);
      const runtimeVolumeS3Target = matchRuntimeVolumeS3ProxyTarget(
        requestUrl.pathname,
        worktreeMetadata,
      );
      if (runtimeVolumeS3Target || matchesConfiguredLocalS3Bucket(requestUrl.pathname)) {
        const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, resolveLocalMinioUrl());
        return await fetch(buildProxyRequest(request, target, requestUrl, { preserveHost: true }));
      }

      const worktreeRoute = matchWorktreePublicRoute(requestUrl.pathname);
      let targetBaseUrl = resolveMainAppUrl();
      let targetPath = requestUrl.pathname;

      if (worktreeRoute) {
        const metadataByInstanceId = new Map(
          worktreeMetadata.map((metadata) => [metadata.instanceId, metadata]),
        );
        const metadata = metadataByInstanceId.get(worktreeRoute.instanceId);
        if (!metadata) {
          return Response.json(
            {
              ok: false,
              error: "worktree_not_found",
              instanceId: worktreeRoute.instanceId,
            },
            { status: 404 },
          );
        }
        targetBaseUrl = metadata.appUrl;
        targetPath = worktreeRoute.forwardedPath;
      }

      const target = new URL(`${targetPath}${requestUrl.search}`, targetBaseUrl);
      try {
        return await fetch(buildProxyRequest(request, target, requestUrl));
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: "proxy_error",
            message: error instanceof Error ? error.message : String(error),
            target: target.toString(),
          },
          { status: 502 },
        );
      }
    },
  });

  console.log(`[worktree] localcan proxy listening on http://127.0.0.1:${port}`);
}

function matchRuntimeVolumeS3ProxyTarget(
  pathname: string,
  metadata: readonly InstanceMetadata[],
): InstanceMetadata | null {
  for (const instance of metadata) {
    const bucket = instance.minioBucketName;
    if (!bucket) {
      continue;
    }

    if (pathname === `/${bucket}` || pathname.startsWith(`/${bucket}/`)) {
      return instance;
    }
  }

  return null;
}

function matchesConfiguredLocalS3Bucket(pathname: string): boolean {
  const bucket = process.env.AWS_S3_BUCKET_NAME?.trim();
  if (!bucket) {
    return false;
  }

  return pathname === `/${bucket}` || pathname.startsWith(`/${bucket}/`);
}

if (import.meta.main) {
  await runLocalTunnelProxy();
}
