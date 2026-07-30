import { describe, expect, it } from "vitest";
import { resolveCoworkerExecutionIdentity } from "./coworker-execution-identity";

describe("coworker execution identity", () => {
  it("uses the initiating member for user-intent runs", () => {
    expect(
      resolveCoworkerExecutionIdentity({
        startKind: "user_intent",
        initiatingUserId: "member-1",
        automationOwner: {
          userId: "owner-1",
          consentedAt: new Date(),
          isActiveWorkspaceMember: true,
        },
      }),
    ).toEqual({ ok: true, executionUserId: "member-1" });
  });

  it("never falls back to the automation owner when a user-intent initiator is absent", () => {
    expect(
      resolveCoworkerExecutionIdentity({
        startKind: "user_intent",
        initiatingUserId: null,
        automationOwner: {
          userId: "owner-1",
          consentedAt: new Date(),
          isActiveWorkspaceMember: true,
        },
      }),
    ).toEqual({ ok: false, reason: "initiator_required" });
  });

  it("uses a consenting active automation owner for external triggers", () => {
    expect(
      resolveCoworkerExecutionIdentity({
        startKind: "external_trigger",
        initiatingUserId: null,
        automationOwner: {
          userId: "owner-1",
          consentedAt: new Date("2026-07-30T12:00:00.000Z"),
          isActiveWorkspaceMember: true,
        },
      }),
    ).toEqual({ ok: true, executionUserId: "owner-1" });
  });

  it("returns precise external-trigger failures", () => {
    expect(
      resolveCoworkerExecutionIdentity({
        startKind: "external_trigger",
        initiatingUserId: null,
        automationOwner: null,
      }),
    ).toEqual({ ok: false, reason: "automation_owner_required" });
    expect(
      resolveCoworkerExecutionIdentity({
        startKind: "external_trigger",
        initiatingUserId: null,
        automationOwner: {
          userId: "owner-1",
          consentedAt: null,
          isActiveWorkspaceMember: true,
        },
      }),
    ).toEqual({ ok: false, reason: "automation_owner_unconsented" });
    expect(
      resolveCoworkerExecutionIdentity({
        startKind: "external_trigger",
        initiatingUserId: null,
        automationOwner: {
          userId: "owner-1",
          consentedAt: new Date(),
          isActiveWorkspaceMember: false,
        },
      }),
    ).toEqual({ ok: false, reason: "automation_owner_inactive" });
  });
});
