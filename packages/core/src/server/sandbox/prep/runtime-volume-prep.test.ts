import { describe, expect, it, vi } from "vitest";
import {
  buildRuntimeVolumeMountPlan,
  buildRuntimeVolumeMountSignature,
  buildRuntimeVolumeSetupCommand,
  canReuseRuntimeVolumeMountSignature,
  canReuseRuntimeVolumeMounts,
  prepareRuntimeVolumesForSandbox,
  resolveRuntimeVolumeMountEndpointUrl,
  RuntimeVolumeSetupError,
} from "./runtime-volume-prep";
import type { SandboxHandle } from "../core/types";

describe("runtime-volume-prep", () => {
  it("builds authoring scope with owned skills, shared skills, and exact coworker docs", () => {
    const plan = buildRuntimeVolumeMountPlan({
      workspaceId: "workspace-1",
      userId: "user-1",
      generationId: "generation-1",
      skillScope: { type: "authoring" },
      visibleSkillNames: ["research", "drafting"],
      coworkerDocumentsCoworkerId: "coworker-1",
    });

    expect(plan.visibleSkillNames).toEqual(["drafting", "research"]);
    expect(plan.coworkerDocumentsPath).toBe("/home/user/coworker-documents");
    expect(plan.roots).toMatchObject([
      {
        kind: "owned_skills",
        storagePrefix: "runtime-volumes/workspace-1/users/user-1/skills/",
        mountPath: "/runtime/skills",
        readOnly: false,
      },
      {
        kind: "shared_skills",
        storagePrefix: "runtime-volumes/workspace-1/shared-skills/",
        mountPath: "/runtime/shared-skills",
        readOnly: true,
      },
      {
        kind: "coworker_documents",
        coworkerId: "coworker-1",
        storagePrefix: "runtime-volumes/workspace-1/coworkers/coworker-1/documents/",
        mountPath: "/home/user/coworker-documents",
        readOnly: false,
      },
    ]);
  });

  it("builds selected runner scope without a writable top-level skill root", () => {
    const plan = buildRuntimeVolumeMountPlan({
      workspaceId: "workspace-1",
      userId: "user-1",
      skillScope: {
        type: "selected",
        skillSlugs: ["research"],
        ownedSkillSlugs: ["research"],
        sharedSkillSlugs: [],
      },
      visibleSkillNames: ["research"],
    });
    const command = buildRuntimeVolumeSetupCommand(plan);

    expect(plan.roots).toHaveLength(1);
    expect(plan.roots.map((root) => root.mountPath)).toEqual([
      "/runtime/selected-skills/owned/research",
    ]);
    expect(command).toContain("chmod 0555");
    expect(command).toContain(
      "/runtime/selected-skills/owned=RW:/runtime/selected-skills/shared=RO",
    );
  });

  it("keeps selected shared-only skills read-only", () => {
    const plan = buildRuntimeVolumeMountPlan({
      workspaceId: "workspace-1",
      userId: "user-1",
      skillScope: {
        type: "selected",
        skillSlugs: ["research"],
        ownedSkillSlugs: [],
        sharedSkillSlugs: ["research"],
      },
      visibleSkillNames: ["research"],
    });

    expect(plan.roots).toMatchObject([
      {
        kind: "shared_skills",
        storagePrefix: "runtime-volumes/workspace-1/shared-skills/research/",
        mountPath: "/runtime/selected-skills/shared/research",
        readOnly: true,
      },
    ]);
  });

  it("supports static S3-compatible credentials without a session token", () => {
    const plan = buildRuntimeVolumeMountPlan({
      workspaceId: "workspace-1",
      userId: "user-1",
      skillScope: { type: "authoring" },
      visibleSkillNames: [],
    });
    const command = buildRuntimeVolumeSetupCommand(plan);

    expect(command).toContain('if [ -n "$RUNTIME_VOLUME_AWS_SESSION_TOKEN" ]; then');
    expect(command).toContain("opts+=(-o use_session_token)");
    expect(command).toContain('export AWS_SHARED_CREDENTIALS_FILE="$CREDENTIALS_FILE"');
    expect(command).toContain("/root/.aws/credentials");
    expect(command).not.toContain("grep -E");
    expect(command).not.toContain("-o profile=bap-runtime-volume -o use_session_token -o url=");
  });

  it("makes reused sandbox runtime-volume unmounts idempotent", () => {
    const plan = buildRuntimeVolumeMountPlan({
      workspaceId: "workspace-1",
      userId: "user-1",
      generationId: "generation-1",
      skillScope: { type: "authoring" },
      visibleSkillNames: [],
    });
    const command = buildRuntimeVolumeSetupCommand(plan);

    expect(command).toContain("is_runtime_volume_mountpoint() {");
    expect(command).toContain('findmnt -rn -o TARGET | grep -Fx -- "$mount_path" >/dev/null 2>&1');
    expect(command).toContain("stop_opencode_server_if_runtime_volumes_mounted() {");
    expect(command).toContain('pkill -f "opencode serve .*--port 4096" 2>/dev/null || true');
    expect(command).toContain('pkill -f "mergerfs .* $mount_path" 2>/dev/null || true');
    expect(command).toContain("print_unmount_diagnostics() {");
    expect(command).toContain(
      'findmnt -rn -o TARGET,FSTYPE,SOURCE,OPTIONS | grep -F -- "$mount_path"',
    );
    expect(command).toContain("grep -F -e opencode -e mergerfs -e s3fs -e fuse");
    expect(command).toContain(
      'RUNTIME_VOLUME_MOUNT_SIGNATURE_FILE="/tmp/bap-runtime-volume-mount.signature"',
    );
    expect(command).toContain("RUNTIME_VOLUME_CAN_REUSE_SIGNED=1");
    expect(command).toContain("runtime_volume_mount_signature() {");
    expect(command).toContain("credentialAccessKeyId=%s");
    expect(command).not.toContain("RUNTIME_VOLUME_CAN_REUSE_UNSIGNED");
    expect(command).toContain("runtime_volume_mounts_ready() {");
    expect(command).toContain("if runtime_volume_mounts_ready; then");
    expect(command).toContain("write_runtime_volume_mount_signature");
    expect(command).toContain("verify_runtime_volume_mount() {");
    expect(command).toContain('printf "runtime_volume_mount_missing: %s\\n" "$mount_path" >&2');
    expect(command).toContain("unmount_if_mounted() {");
    expect(command).toContain('if ! is_runtime_volume_mountpoint "$mount_path"; then');
    expect(command).toContain(
      'if fusermount -uz "$mount_path" 2>/dev/null || umount -l "$mount_path" 2>/dev/null; then',
    );
    expect(command).toContain('is_runtime_volume_mountpoint "$mount_path" || return 0');
    expect(command).toContain('print_unmount_diagnostics "$mount_path"');
    expect(command).toContain('printf "runtime_volume_unmount_failed: %s\\n" "$mount_path" >&2');
    expect(command).toContain("stop_opencode_server_if_runtime_volumes_mounted");
    expect(command).toContain("has_managed_runtime_volume_mounts() {");
    expect(command).toContain("done < <(findmnt -rn -o TARGET)");
    expect(command).toContain('unmount_if_mounted "$mount_path"');
    expect(command.indexOf("stop_opencode_server_if_runtime_volumes_mounted\n")).toBeLessThan(
      command.indexOf("reset_runtime_volume_mounts\n"),
    );
  });

  it("reuses mounts only for signed plans with the same credential-scoped signature", () => {
    const plan = buildRuntimeVolumeMountPlan({
      workspaceId: "workspace-1",
      userId: "user-1",
      generationId: "generation-1",
      skillScope: { type: "authoring" },
      visibleSkillNames: [],
    });
    const storedSignature = buildRuntimeVolumeMountSignature({
      plan,
      credentialAccessKeyId: "access-key-1",
    });

    expect(canReuseRuntimeVolumeMounts(plan)).toBe(true);
    expect(
      canReuseRuntimeVolumeMountSignature({
        plan,
        credentialAccessKeyId: "access-key-1",
        storedSignature,
      }),
    ).toBe(true);
    expect(
      canReuseRuntimeVolumeMountSignature({
        plan,
        credentialAccessKeyId: "access-key-1",
        storedSignature: null,
      }),
    ).toBe(false);

    const nextGenerationPlan = buildRuntimeVolumeMountPlan({
      workspaceId: "workspace-1",
      userId: "user-1",
      generationId: "generation-2",
      skillScope: { type: "authoring" },
      visibleSkillNames: [],
    });
    expect(
      canReuseRuntimeVolumeMountSignature({
        plan: nextGenerationPlan,
        credentialAccessKeyId: "access-key-1",
        storedSignature,
      }),
    ).toBe(true);
    expect(
      canReuseRuntimeVolumeMountSignature({
        plan,
        credentialAccessKeyId: "access-key-2",
        storedSignature,
      }),
    ).toBe(false);

    const wrongTargetPlan = {
      ...plan,
      roots: plan.roots.map((root, index) =>
        index === 0 ? { ...root, s3MountTarget: "other-bucket:/wrong-prefix" } : root,
      ),
    };
    expect(
      canReuseRuntimeVolumeMountSignature({
        plan: wrongTargetPlan,
        credentialAccessKeyId: "access-key-1",
        storedSignature,
      }),
    ).toBe(false);

    const readOnlyChangedPlan = {
      ...plan,
      roots: plan.roots.map((root, index) => (index === 0 ? { ...root, readOnly: true } : root)),
    };
    expect(
      canReuseRuntimeVolumeMountSignature({
        plan: readOnlyChangedPlan,
        credentialAccessKeyId: "access-key-1",
        storedSignature,
      }),
    ).toBe(false);
  });

  it("does not reuse unsigned mounts without a Generation-scoped signature", () => {
    const plan = buildRuntimeVolumeMountPlan({
      workspaceId: "workspace-1",
      userId: "user-1",
      skillScope: { type: "authoring" },
      visibleSkillNames: [],
    });
    const storedSignature = buildRuntimeVolumeMountSignature({
      plan,
      credentialAccessKeyId: "access-key-1",
    });
    const command = buildRuntimeVolumeSetupCommand(plan);

    expect(canReuseRuntimeVolumeMounts(plan)).toBe(false);
    expect(
      canReuseRuntimeVolumeMountSignature({
        plan,
        credentialAccessKeyId: "access-key-1",
        storedSignature,
      }),
    ).toBe(false);
    expect(command).toContain("RUNTIME_VOLUME_CAN_REUSE_SIGNED=0");
  });

  it("keeps the configured S3 endpoint for non-loopback storage", () => {
    expect(resolveRuntimeVolumeMountEndpointUrl()).toBe("https://s3.test.local");
  });

  it("uses the public callback base for loopback S3 mounts in development", async () => {
    vi.resetModules();
    vi.doMock("../../../env", () => ({
      env: {
        AWS_ACCESS_KEY_ID: "access-key",
        AWS_DEFAULT_REGION: "us-east-1",
        AWS_ENDPOINT_URL: "http://localhost:9000",
        AWS_S3_FORCE_PATH_STYLE: true,
        AWS_SECRET_ACCESS_KEY: "secret-key",
        AWS_S3_BUCKET_NAME: "bap-documents",
        E2B_CALLBACK_BASE_URL: undefined,
      },
    }));

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const module = await import("./runtime-volume-prep");
      expect(module.resolveRuntimeVolumeMountEndpointUrl()).toBe(
        "https://localcan.baptistecolle.com",
      );
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      vi.doUnmock("../../../env");
      vi.resetModules();
    }
  });

  it("fails fast for unsupported sandbox providers", async () => {
    const sandbox: SandboxHandle = {
      provider: "e2b",
      sandboxId: "sandbox-1",
      exec: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      ensureDir: vi.fn(),
    };

    await expect(
      prepareRuntimeVolumesForSandbox({
        sandbox,
        plan: buildRuntimeVolumeMountPlan({
          workspaceId: "workspace-1",
          userId: "user-1",
          skillScope: { type: "authoring" },
          visibleSkillNames: [],
        }),
      }),
    ).rejects.toMatchObject({
      name: "RuntimeVolumeSetupError",
      message: "Runtime Volumes require a Daytona sandbox.",
      reason: "runtime_volume_provider_unsupported",
    });
    expect(sandbox.exec).not.toHaveBeenCalled();
  });

  it("keeps raw sandbox diagnostics out of Runtime Volume errors", async () => {
    const sandbox: SandboxHandle = {
      provider: "daytona",
      sandboxId: "sandbox-1",
      exec: vi.fn().mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "runtime_volume_unmount_failed: /home/user/coworker-documents secret-detail",
      }),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      ensureDir: vi.fn(),
    };

    await expect(
      prepareRuntimeVolumesForSandbox({
        sandbox,
        plan: buildRuntimeVolumeMountPlan({
          workspaceId: "workspace-1",
          userId: "user-1",
          skillScope: { type: "authoring" },
          visibleSkillNames: [],
        }),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeVolumeSetupError>>({
        message: "Runtime Volume setup failed.",
        reason: "runtime_volume_unmount_failed",
      }),
    );
  });
});
