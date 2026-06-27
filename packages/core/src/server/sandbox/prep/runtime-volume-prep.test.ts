import { describe, expect, it, vi } from "vitest";
import {
  buildRuntimeVolumeMountPlan,
  buildRuntimeVolumeSetupCommand,
  prepareRuntimeVolumesForSandbox,
  resolveRuntimeVolumeMountEndpointUrl,
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
    expect(command).toContain("/runtime/selected-skills/owned=RW:/runtime/selected-skills/shared=RO");
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

  it("keeps the configured S3 endpoint for non-loopback storage", () => {
    expect(resolveRuntimeVolumeMountEndpointUrl()).toBe("https://s3.test.local");
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
    ).rejects.toThrow("runtime_volume_provider_unsupported");
    expect(sandbox.exec).not.toHaveBeenCalled();
  });
});
