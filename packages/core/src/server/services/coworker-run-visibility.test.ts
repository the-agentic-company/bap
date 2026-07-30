import { describe, expect, it } from "vitest";
import {
  decideCoworkerRunContentAccess,
  decideCoworkerRunMetadataAccess,
} from "./coworker-run-visibility";

describe("coworker run visibility", () => {
  it("shows workspace run metadata to active members", () => {
    expect(
      decideCoworkerRunMetadataAccess({
        actorUserId: "member-2",
        isActiveWorkspaceMember: true,
        coworkerVisibility: "workspace",
        coworkerCreatedByUserId: "member-1",
      }),
    ).toEqual({ allowed: true });
  });

  it("keeps private run metadata with the coworker creator", () => {
    expect(
      decideCoworkerRunMetadataAccess({
        actorUserId: "admin-1",
        isActiveWorkspaceMember: true,
        coworkerVisibility: "private",
        coworkerCreatedByUserId: "member-1",
      }),
    ).toEqual({ allowed: false, reason: "private_coworker" });
  });

  it("keeps manual run content private to its initiator, including from admins", () => {
    expect(
      decideCoworkerRunContentAccess({
        actorUserId: "member-2",
        workspaceRole: "admin",
        isActiveWorkspaceMember: true,
        coworkerVisibility: "workspace",
        coworkerCreatedByUserId: "member-1",
        startKind: "user_intent",
        initiatedByUserId: "member-1",
      }),
    ).toEqual({ allowed: false, reason: "manual_run_initiator_required" });
    expect(
      decideCoworkerRunContentAccess({
        actorUserId: "member-1",
        workspaceRole: "member",
        isActiveWorkspaceMember: true,
        coworkerVisibility: "workspace",
        coworkerCreatedByUserId: "member-1",
        startKind: "user_intent",
        initiatedByUserId: "member-1",
      }),
    ).toEqual({ allowed: true });
  });

  it("shares automated run content with workspace members", () => {
    expect(
      decideCoworkerRunContentAccess({
        actorUserId: "member-2",
        workspaceRole: "member",
        isActiveWorkspaceMember: true,
        coworkerVisibility: "workspace",
        coworkerCreatedByUserId: "member-1",
        startKind: "external_trigger",
        initiatedByUserId: null,
      }),
    ).toEqual({ allowed: true });
  });
});
