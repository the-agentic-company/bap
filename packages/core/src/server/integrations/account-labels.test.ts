import { describe, expect, it } from "vitest";
import {
  normalizeAccountLabel,
  planConnectedIdentityAssignment,
  suggestAccountLabel,
} from "./account-labels";

describe("Account Labels", () => {
  it("normalizes labels into lowercase ASCII slugs", () => {
    expect(normalizeAccountLabel(" Work Email ")).toBe("work-email");
    expect(normalizeAccountLabel("François@Example")).toBe("francois-example");
  });

  it("suggests labels from reliable email local parts", () => {
    expect(
      suggestAccountLabel(
        {
          userId: "user-1",
          integrationType: "google_gmail",
          providerIdentityId: "provider-1",
          reliableEmail: "Work@Company.com",
          displayName: "Work Account",
          workspaceOrTenantName: null,
        },
        [],
      ),
    ).toBe("work");
  });

  it("groups different Integration Types with the same reliable email under one label", () => {
    const assignment = planConnectedIdentityAssignment({
      newAccount: {
        userId: "user-1",
        integrationType: "slack",
        providerIdentityId: "slack-user",
        reliableEmail: "work@company.com",
        displayName: "work@company.com",
        workspaceOrTenantName: "Acme",
      },
      existingIdentities: [
        {
          id: "identity-1",
          label: "work",
          emailIdentity: "work@company.com",
          integrationTypes: ["google_gmail"],
        },
      ],
    });

    expect(assignment).toEqual({
      kind: "existing",
      connectedIdentityId: "identity-1",
      accountLabel: "work",
    });
  });

  it("splits same-Integration Type collisions with contextual suffixes", () => {
    const assignment = planConnectedIdentityAssignment({
      newAccount: {
        userId: "user-1",
        integrationType: "slack",
        providerIdentityId: "slack-user-2",
        reliableEmail: "work@company.com",
        displayName: "work@company.com",
        workspaceOrTenantName: "Client Project",
      },
      existingIdentities: [
        {
          id: "identity-1",
          label: "work-acme",
          emailIdentity: "work@company.com",
          integrationTypes: ["slack"],
        },
      ],
    });

    expect(assignment).toMatchObject({
      kind: "create",
      accountLabel: "work-client-project",
      emailIdentity: "work@company.com",
    });
  });

  it("blocks explicit assignment to a label that already has the Integration Type", () => {
    expect(() =>
      planConnectedIdentityAssignment({
        requestedAccountLabel: "work",
        newAccount: {
          userId: "user-1",
          integrationType: "google_gmail",
          providerIdentityId: "gmail-2",
          reliableEmail: "other@company.com",
          displayName: "other@company.com",
          workspaceOrTenantName: null,
        },
        existingIdentities: [
          {
            id: "identity-1",
            label: "work",
            emailIdentity: "work@company.com",
            integrationTypes: ["google_gmail"],
          },
        ],
      }),
    ).toThrow('Account Label "work" already has a Connected Account for google_gmail.');
  });
});
