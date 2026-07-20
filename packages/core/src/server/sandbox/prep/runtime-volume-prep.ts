import { env } from "../../../env";
import type { SandboxHandle } from "../core/types";
import { escapeShell } from "../opencode-session-support";
import { resolvePublicCallbackBaseUrl } from "../../../lib/worktree-routing";
import { BUCKET_NAME } from "../../storage/s3-client";
import {
  appendRuntimeVolumeSkillSlug,
  buildCoworkerDocumentsRuntimeVolumePrefix,
  buildOwnedSkillsRuntimeVolumePrefix,
  buildSharedSkillsRuntimeVolumePrefix,
  ensureTrailingSlash,
  issueRuntimeVolumeS3Credentials,
  type RuntimeVolumeProjectionInput,
} from "../../services/runtime-volume-service";

const OWNED_SKILLS_MOUNT_PATH = "/runtime/skills";
const SHARED_SKILLS_MOUNT_PATH = "/runtime/shared-skills";
const SELECTED_OWNED_SKILLS_MOUNT_ROOT = "/runtime/selected-skills/owned";
const SELECTED_SHARED_SKILLS_MOUNT_ROOT = "/runtime/selected-skills/shared";
const OPENCODE_SKILLS_PATH = "/app/.opencode/skills";
const COWORKER_DOCUMENTS_RUNTIME_PATH = "/home/user/coworker-documents";

export type RuntimeVolumeSkillScope =
  | { type: "authoring" }
  | {
      type: "selected";
      skillSlugs: readonly string[];
      ownedSkillSlugs: readonly string[];
      sharedSkillSlugs: readonly string[];
    };

export type RuntimeVolumeMountRoot = RuntimeVolumeProjectionInput & {
  s3MountTarget: string;
};

export type RuntimeVolumeMountPlan = {
  skillScope: RuntimeVolumeSkillScope;
  roots: RuntimeVolumeMountRoot[];
  visibleSkillNames: string[];
  coworkerDocumentsPath?: string;
};

export type RuntimeVolumeMountPlanInput = {
  workspaceId: string;
  userId: string;
  skillScope: RuntimeVolumeSkillScope;
  visibleSkillNames: readonly string[];
  coworkerDocumentsCoworkerId?: string | null;
  generationId?: string | null;
};

export class RuntimeVolumeSetupError extends Error {
  constructor(
    message: string,
    readonly reason: string = "runtime_volume_setup_failed",
  ) {
    super(message);
    this.name = "RuntimeVolumeSetupError";
  }
}

const RUNTIME_VOLUME_SETUP_FAILURE_REASONS = new Set([
  "runtime_volume_mount_missing",
  "runtime_volume_setup_missing_dependencies",
  "runtime_volume_unmount_failed",
]);

function resolveRuntimeVolumeSetupFailureReason(detail: string): string {
  const candidate = detail.match(/\b(runtime_volume_[a-z_]+)\b/)?.[1];
  return candidate && RUNTIME_VOLUME_SETUP_FAILURE_REASONS.has(candidate)
    ? candidate
    : "runtime_volume_setup_failed";
}

export function buildRuntimeVolumeMountPlan(
  input: RuntimeVolumeMountPlanInput,
): RuntimeVolumeMountPlan {
  const roots: RuntimeVolumeMountRoot[] = [];
  const ownedSkillsPrefix = buildOwnedSkillsRuntimeVolumePrefix({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  const sharedSkillsPrefix = buildSharedSkillsRuntimeVolumePrefix({
    workspaceId: input.workspaceId,
  });

  if (input.skillScope.type === "authoring") {
    roots.push(
      {
        workspaceId: input.workspaceId,
        kind: "owned_skills",
        ownerUserId: input.userId,
        storagePrefix: ownedSkillsPrefix,
        mountPath: OWNED_SKILLS_MOUNT_PATH,
        readOnly: false,
        generationId: input.generationId ?? null,
        s3MountTarget: buildS3fsMountTarget(ownedSkillsPrefix),
      },
      {
        workspaceId: input.workspaceId,
        kind: "shared_skills",
        storagePrefix: sharedSkillsPrefix,
        mountPath: SHARED_SKILLS_MOUNT_PATH,
        readOnly: true,
        generationId: input.generationId ?? null,
        s3MountTarget: buildS3fsMountTarget(sharedSkillsPrefix),
      },
    );
  } else {
    for (const skillSlug of uniqueSorted(input.skillScope.ownedSkillSlugs)) {
      const storagePrefix = appendRuntimeVolumeSkillSlug(ownedSkillsPrefix, skillSlug);
      roots.push({
        workspaceId: input.workspaceId,
        kind: "owned_skills",
        ownerUserId: input.userId,
        storagePrefix,
        mountPath: `${SELECTED_OWNED_SKILLS_MOUNT_ROOT}/${skillSlug}`,
        readOnly: false,
        generationId: input.generationId ?? null,
        s3MountTarget: buildS3fsMountTarget(storagePrefix),
      });
    }

    for (const skillSlug of uniqueSorted(input.skillScope.sharedSkillSlugs)) {
      const storagePrefix = appendRuntimeVolumeSkillSlug(sharedSkillsPrefix, skillSlug);
      roots.push({
        workspaceId: input.workspaceId,
        kind: "shared_skills",
        storagePrefix,
        mountPath: `${SELECTED_SHARED_SKILLS_MOUNT_ROOT}/${skillSlug}`,
        readOnly: true,
        generationId: input.generationId ?? null,
        s3MountTarget: buildS3fsMountTarget(storagePrefix),
      });
    }
  }

  if (input.coworkerDocumentsCoworkerId) {
    const storagePrefix = buildCoworkerDocumentsRuntimeVolumePrefix({
      workspaceId: input.workspaceId,
      coworkerId: input.coworkerDocumentsCoworkerId,
    });
    roots.push({
      workspaceId: input.workspaceId,
      kind: "coworker_documents",
      coworkerId: input.coworkerDocumentsCoworkerId,
      storagePrefix,
      mountPath: COWORKER_DOCUMENTS_RUNTIME_PATH,
      readOnly: false,
      generationId: input.generationId ?? null,
      s3MountTarget: buildS3fsMountTarget(storagePrefix),
    });
  }

  return {
    skillScope: input.skillScope,
    roots,
    visibleSkillNames: uniqueSorted(input.visibleSkillNames),
    coworkerDocumentsPath: input.coworkerDocumentsCoworkerId
      ? COWORKER_DOCUMENTS_RUNTIME_PATH
      : undefined,
  };
}

export async function prepareRuntimeVolumesForSandbox(input: {
  sandbox: SandboxHandle;
  plan: RuntimeVolumeMountPlan;
}): Promise<void> {
  if (input.sandbox.provider !== "daytona") {
    throw new RuntimeVolumeSetupError(
      "Runtime Volumes require a Daytona sandbox.",
      "runtime_volume_provider_unsupported",
    );
  }

  const result = await input.sandbox.exec(buildRuntimeVolumeSetupCommand(input.plan), {
    timeoutMs: 90_000,
    env: await buildRuntimeVolumeSetupEnv(input.plan),
  });

  if (result.exitCode !== 0) {
    const detail = result.stderr || result.stdout || "unknown error";
    throw new RuntimeVolumeSetupError(
      "Runtime Volume setup failed.",
      resolveRuntimeVolumeSetupFailureReason(detail),
    );
  }
}

async function buildRuntimeVolumeSetupEnv(
  plan: RuntimeVolumeMountPlan,
): Promise<Record<string, string>> {
  if (plan.roots.length === 0) {
    return {};
  }

  const credentials = await issueRuntimeVolumeS3Credentials({
    generationId: plan.roots[0]?.generationId,
    roots: plan.roots,
  });

  return {
    RUNTIME_VOLUME_AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    RUNTIME_VOLUME_AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    RUNTIME_VOLUME_AWS_SESSION_TOKEN: credentials.sessionToken ?? "",
    RUNTIME_VOLUME_AWS_ENDPOINT_URL: resolveRuntimeVolumeMountEndpointUrl(),
    RUNTIME_VOLUME_AWS_DEFAULT_REGION: env.AWS_DEFAULT_REGION,
    RUNTIME_VOLUME_FORCE_PATH_STYLE: env.AWS_S3_FORCE_PATH_STYLE ? "1" : "0",
  };
}

export function resolveRuntimeVolumeMountEndpointUrl(): string {
  if (!isLoopbackEndpointUrl(env.AWS_ENDPOINT_URL)) {
    return env.AWS_ENDPOINT_URL;
  }

  const callbackBaseUrl = resolvePublicCallbackBaseUrl({
    callbackBaseUrl: env.E2B_CALLBACK_BASE_URL,
    appUrl: env.APP_URL,
    viteAppUrl: env.VITE_APP_URL,
    nodeEnv: process.env.NODE_ENV,
  });
  if (!callbackBaseUrl) {
    return env.AWS_ENDPOINT_URL;
  }

  try {
    return new URL(callbackBaseUrl).origin;
  } catch {
    return env.AWS_ENDPOINT_URL;
  }
}

export function buildRuntimeVolumeSetupCommand(plan: RuntimeVolumeMountPlan): string {
  const needsS3Mounts = plan.roots.length > 0;
  const needsMergedSkillsMount = needsSkillMerge(plan);
  const planSignature = buildRuntimeVolumeMountPlanSignature(plan);
  const canReuseSignedMounts = canReuseRuntimeVolumeMounts(plan);
  const dependencyChecks = [
    ...(needsS3Mounts ? ["command -v s3fs >/dev/null 2>&1 || missing+=(s3fs)"] : []),
    ...(needsMergedSkillsMount
      ? ["command -v mergerfs >/dev/null 2>&1 || missing+=(mergerfs)"]
      : []),
  ];
  const credentialSetup = needsS3Mounts
    ? [
        'RUNTIME_VOLUME_AWS_HOME="/tmp/bap-runtime-volume-aws"',
        'mkdir -p "$RUNTIME_VOLUME_AWS_HOME/.aws"',
        'CREDENTIALS_FILE="$RUNTIME_VOLUME_AWS_HOME/.aws/credentials"',
        'cat > "$CREDENTIALS_FILE" <<EOF',
        "[bap-runtime-volume]",
        "aws_access_key_id=$RUNTIME_VOLUME_AWS_ACCESS_KEY_ID",
        "aws_secret_access_key=$RUNTIME_VOLUME_AWS_SECRET_ACCESS_KEY",
        "EOF",
        'if [ -n "$RUNTIME_VOLUME_AWS_SESSION_TOKEN" ]; then',
        '  printf "aws_session_token=%s\\n" "$RUNTIME_VOLUME_AWS_SESSION_TOKEN" >> "$CREDENTIALS_FILE"',
        "fi",
        'chmod 600 "$CREDENTIALS_FILE"',
        'export HOME="$RUNTIME_VOLUME_AWS_HOME"',
        'export AWS_SHARED_CREDENTIALS_FILE="$CREDENTIALS_FILE"',
        'mkdir -p /root/.aws 2>/dev/null && cp "$CREDENTIALS_FILE" /root/.aws/credentials && chmod 600 /root/.aws/credentials || true',
        'if [ -n "$RUNTIME_VOLUME_AWS_SESSION_TOKEN" ]; then',
        '  export AWS_SESSION_TOKEN="$RUNTIME_VOLUME_AWS_SESSION_TOKEN"',
        '  export AWSSESSIONTOKEN="$RUNTIME_VOLUME_AWS_SESSION_TOKEN"',
        "fi",
      ]
    : [];
  const script = [
    "set -euo pipefail",
    "missing=()",
    ...dependencyChecks,
    'if [ "${#missing[@]}" -gt 0 ]; then',
    '  printf "runtime_volume_setup_missing_dependencies: %s\\n" "${missing[*]}" >&2',
    "  exit 78",
    "fi",
    ...credentialSetup,
    `RUNTIME_VOLUME_PLAN_SIGNATURE=${escapeShell(planSignature)}`,
    'RUNTIME_VOLUME_MOUNT_SIGNATURE_FILE="/tmp/bap-runtime-volume-mount.signature"',
    `RUNTIME_VOLUME_CAN_REUSE_SIGNED=${canReuseSignedMounts ? "1" : "0"}`,
    "mount_s3_prefix() {",
    '  local target="$1"',
    '  local mount_path="$2"',
    '  local mode="$3"',
    '  mkdir -p "$mount_path"',
    '  if mountpoint -q "$mount_path"; then',
    "    return 0",
    "  fi",
    '  local opts=(-o profile=bap-runtime-volume -o url="$RUNTIME_VOLUME_AWS_ENDPOINT_URL" -o endpoint="$RUNTIME_VOLUME_AWS_DEFAULT_REGION" -o umask=0002)',
    '  if [ -n "$RUNTIME_VOLUME_AWS_SESSION_TOKEN" ]; then',
    "    opts+=(-o use_session_token)",
    "  fi",
    '  if [ "$RUNTIME_VOLUME_FORCE_PATH_STYLE" = "1" ]; then',
    "    opts+=(-o use_path_request_style)",
    "  fi",
    '  if [ "$mode" = "ro" ]; then',
    "    opts+=(-o ro)",
    "  fi",
    '  s3fs "$target" "$mount_path" "${opts[@]}"',
    "}",
    "verify_runtime_volume_mount() {",
    '  local mount_path="$1"',
    '  local _mode="$2"',
    '  if ! is_runtime_volume_mountpoint "$mount_path"; then',
    '    printf "runtime_volume_mount_missing: %s\\n" "$mount_path" >&2',
    "    return 1",
    "  fi",
    "  return 0",
    "}",
    "is_runtime_volume_mountpoint() {",
    '  local mount_path="$1"',
    '  mountpoint -q "$mount_path" && return 0',
    "  command -v findmnt >/dev/null 2>&1 || return 1",
    '  findmnt -rn -o TARGET | grep -Fx -- "$mount_path" >/dev/null 2>&1',
    "}",
    "runtime_volume_mount_signature() {",
    '  printf "%s\\ncredentialAccessKeyId=%s" "$RUNTIME_VOLUME_PLAN_SIGNATURE" "${RUNTIME_VOLUME_AWS_ACCESS_KEY_ID:-}"',
    "}",
    "write_runtime_volume_mount_signature() {",
    '  runtime_volume_mount_signature > "$RUNTIME_VOLUME_MOUNT_SIGNATURE_FILE"',
    "}",
    "runtime_volume_mounts_ready() {",
    '  [ "$RUNTIME_VOLUME_CAN_REUSE_SIGNED" = "1" ] || return 1',
    '  [ -f "$RUNTIME_VOLUME_MOUNT_SIGNATURE_FILE" ] || return 1',
    '  [ "$(cat "$RUNTIME_VOLUME_MOUNT_SIGNATURE_FILE")" = "$(runtime_volume_mount_signature)" ] || return 1',
    ...(needsMergedSkillsMount
      ? [`  is_runtime_volume_mountpoint ${escapeShell(OPENCODE_SKILLS_PATH)} || return 1`]
      : []),
    ...plan.roots.map(
      (root) =>
        `  verify_runtime_volume_mount ${escapeShell(root.mountPath)} ${
          root.readOnly ? "ro" : "rw"
        } || return 1`,
    ),
    "  return 0",
    "}",
    "has_managed_runtime_volume_mounts() {",
    "  command -v findmnt >/dev/null 2>&1 || return 1",
    "  local mount_path",
    "  while IFS= read -r mount_path; do",
    '    case "$mount_path" in',
    "      /app/.opencode/skills|/runtime/skills|/runtime/skills/*|/runtime/shared-skills|/runtime/shared-skills/*|/runtime/selected-skills|/runtime/selected-skills/*|/home/user/coworker-documents)",
    "        return 0",
    "        ;;",
    "    esac",
    "  done < <(findmnt -rn -o TARGET)",
    "  return 1",
    "}",
    "stop_opencode_server_if_runtime_volumes_mounted() {",
    "  has_managed_runtime_volume_mounts || return 0",
    `  local mount_path=${escapeShell(OPENCODE_SKILLS_PATH)}`,
    '  pkill -f "opencode serve .*--port 4096" 2>/dev/null || true',
    '  pkill -f "mergerfs .* $mount_path" 2>/dev/null || true',
    "  for _ in 1 2 3 4 5; do",
    '    pgrep -f "opencode serve .*--port 4096" >/dev/null 2>&1 || return 0',
    "    sleep 0.2",
    "  done",
    '  pkill -9 -f "opencode serve .*--port 4096" 2>/dev/null || true',
    "}",
    "print_unmount_diagnostics() {",
    '  local mount_path="$1"',
    '  printf "runtime_volume_unmount_diagnostics: %s\\n" "$mount_path" >&2',
    '  findmnt -rn -o TARGET,FSTYPE,SOURCE,OPTIONS | grep -F -- "$mount_path" >&2 || true',
    "  ps -eo pid,ppid,stat,comm,args | grep -F -e opencode -e mergerfs -e s3fs -e fuse | grep -v grep >&2 || true",
    "  if command -v fuser >/dev/null 2>&1; then",
    '    fuser -vm "$mount_path" >&2 || true',
    "  fi",
    "}",
    "unmount_if_mounted() {",
    '  local mount_path="$1"',
    '  if ! is_runtime_volume_mountpoint "$mount_path"; then',
    "    return 0",
    "  fi",
    '  if fusermount -u "$mount_path" 2>/dev/null || umount "$mount_path" 2>/dev/null; then',
    "    return 0",
    "  fi",
    '  if fusermount -uz "$mount_path" 2>/dev/null || umount -l "$mount_path" 2>/dev/null; then',
    '    is_runtime_volume_mountpoint "$mount_path" || return 0',
    "  fi",
    '  is_runtime_volume_mountpoint "$mount_path" || return 0',
    '  print_unmount_diagnostics "$mount_path"',
    '  printf "runtime_volume_unmount_failed: %s\\n" "$mount_path" >&2',
    "  return 1",
    "}",
    "reset_mountpoint() {",
    '  unmount_if_mounted "$1"',
    "}",
    "reset_runtime_volume_mounts() {",
    "  command -v findmnt >/dev/null 2>&1 || return 0",
    '  local mounts_file="/tmp/bap-runtime-volume-mounts.txt"',
    '  findmnt -rn -o TARGET | sort -r > "$mounts_file"',
    "  while IFS= read -r mount_path; do",
    '    [ -n "$mount_path" ] || continue',
    '    case "$mount_path" in',
    "      /runtime/skills|/runtime/skills/*|/runtime/shared-skills|/runtime/shared-skills/*|/runtime/selected-skills|/runtime/selected-skills/*|/home/user/coworker-documents)",
    '        unmount_if_mounted "$mount_path"',
    "        ;;",
    "    esac",
    '  done < "$mounts_file"',
    '  rm -f "$mounts_file"',
    "}",
    "if runtime_volume_mounts_ready; then",
    "  write_runtime_volume_mount_signature",
    "  sync",
    "  exit 0",
    "fi",
    "stop_opencode_server_if_runtime_volumes_mounted",
    `reset_mountpoint ${escapeShell(OPENCODE_SKILLS_PATH)}`,
    "reset_runtime_volume_mounts",
    `rm -rf ${escapeShell(OPENCODE_SKILLS_PATH)}`,
    `rm -rf ${escapeShell("/runtime/selected-skills")}`,
    `mkdir -p ${escapeShell(OPENCODE_SKILLS_PATH)}`,
    `mkdir -p ${escapeShell("/runtime")}`,
    ...plan.roots.map(
      (root) =>
        `mount_s3_prefix ${escapeShell(root.s3MountTarget)} ${escapeShell(root.mountPath)} ${
          root.readOnly ? "ro" : "rw"
        }\nverify_runtime_volume_mount ${escapeShell(root.mountPath)} ${
          root.readOnly ? "ro" : "rw"
        }`,
    ),
    ...buildSkillMergeCommands(plan),
    "write_runtime_volume_mount_signature",
    "sync",
  ].join("\n");

  return `bash <<'BAP_RUNTIME_VOLUME_SCRIPT'\n${script}\nBAP_RUNTIME_VOLUME_SCRIPT`;
}

function buildRuntimeVolumeMountPlanSignature(plan: RuntimeVolumeMountPlan): string {
  return JSON.stringify({
    coworkerDocumentsPath: plan.coworkerDocumentsPath ?? null,
    roots: plan.roots.map((root) => ({
      kind: root.kind,
      mountPath: root.mountPath,
      readOnly: root.readOnly,
      s3MountTarget: root.s3MountTarget,
      storagePrefix: root.storagePrefix,
    })),
    skillScope: plan.skillScope,
    visibleSkillNames: plan.visibleSkillNames,
  });
}

export function buildRuntimeVolumeMountSignature(input: {
  plan: RuntimeVolumeMountPlan;
  credentialAccessKeyId?: string | null;
}): string {
  return `${buildRuntimeVolumeMountPlanSignature(input.plan)}\ncredentialAccessKeyId=${
    input.credentialAccessKeyId ?? ""
  }`;
}

export function canReuseRuntimeVolumeMounts(plan: RuntimeVolumeMountPlan): boolean {
  return plan.roots.length > 0 && plan.roots.every((root) => Boolean(root.generationId));
}

export function canReuseRuntimeVolumeMountSignature(input: {
  plan: RuntimeVolumeMountPlan;
  credentialAccessKeyId?: string | null;
  storedSignature?: string | null;
}): boolean {
  if (!canReuseRuntimeVolumeMounts(input.plan) || !input.storedSignature) {
    return false;
  }

  return (
    input.storedSignature ===
    buildRuntimeVolumeMountSignature({
      plan: input.plan,
      credentialAccessKeyId: input.credentialAccessKeyId,
    })
  );
}

function buildSkillMergeCommands(plan: RuntimeVolumeMountPlan): string[] {
  if (plan.skillScope.type === "selected" && plan.skillScope.skillSlugs.length === 0) {
    return [`chmod 0555 ${escapeShell(OPENCODE_SKILLS_PATH)}`];
  }

  const branches =
    plan.skillScope.type === "authoring"
      ? `${OWNED_SKILLS_MOUNT_PATH}=RW:${SHARED_SKILLS_MOUNT_PATH}=RO`
      : `${SELECTED_OWNED_SKILLS_MOUNT_ROOT}=RW:${SELECTED_SHARED_SKILLS_MOUNT_ROOT}=RO`;

  const commands: string[] = [];
  if (plan.skillScope.type === "selected") {
    commands.push(
      `mkdir -p ${escapeShell(SELECTED_OWNED_SKILLS_MOUNT_ROOT)} ${escapeShell(
        SELECTED_SHARED_SKILLS_MOUNT_ROOT,
      )}`,
      `chmod 0555 ${escapeShell(SELECTED_OWNED_SKILLS_MOUNT_ROOT)} ${escapeShell(
        SELECTED_SHARED_SKILLS_MOUNT_ROOT,
      )}`,
    );
  }

  commands.push(
    `mergerfs -o defaults,use_ino,cache.files=off,category.create=ff,category.search=ff ${escapeShell(
      branches,
    )} ${escapeShell(OPENCODE_SKILLS_PATH)}`,
  );

  return commands;
}

function needsSkillMerge(plan: RuntimeVolumeMountPlan): boolean {
  return plan.skillScope.type === "authoring" || plan.skillScope.skillSlugs.length > 0;
}

function buildS3fsMountTarget(storagePrefix: string): string {
  const prefix = ensureTrailingSlash(storagePrefix).replace(/\/$/, "");
  return `${BUCKET_NAME}:/${prefix}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).toSorted();
}

function isLoopbackEndpointUrl(endpointUrl: string): boolean {
  try {
    const hostname = new URL(endpointUrl).hostname.toLowerCase();
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}
