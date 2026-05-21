import { describe, expect, it } from "vitest";
import {
  ConnectedAccountResolutionError,
  selectConnectedAccountCredential,
} from "./connected-account-resolution";

const gmail = (label: string, accessToken = `${label}-token`) => ({
  integrationType: "google_gmail" as const,
  accessToken,
  connectedAccountId: `${label}-account`,
  connectedIdentityId: `${label}-identity`,
  accountLabel: label,
  displayName: `${label}@example.com`,
  metadata: null,
});

describe("selectConnectedAccountCredential", () => {
  it("returns auth_required when no Connected Account exists", () => {
    expect(() =>
      selectConnectedAccountCredential({ integrationType: "google_gmail" }, []),
    ).toThrow(ConnectedAccountResolutionError);
    expect(() =>
      selectConnectedAccountCredential({ integrationType: "google_gmail" }, []),
    ).toThrow("No Connected Account is available");
  });

  it("resolves the only available Connected Account without a label", () => {
    expect(selectConnectedAccountCredential({ integrationType: "google_gmail" }, [gmail("work")]))
      .toMatchObject({ accessToken: "work-token", accountLabel: "work" });
  });

  it("requires a label when multiple Account Labels can provide the Integration Type", () => {
    try {
      selectConnectedAccountCredential({ integrationType: "google_gmail" }, [
        gmail("personal"),
        gmail("work"),
      ]);
      throw new Error("Expected account_label_required");
    } catch (error) {
      expect(error).toMatchObject({
        code: "account_label_required",
        availableAccountLabels: ["personal", "work"],
      });
    }
  });

  it("resolves an explicit Account Label", () => {
    expect(
      selectConnectedAccountCredential(
        { integrationType: "google_gmail", accountLabel: "work" },
        [gmail("personal"), gmail("work")],
      ),
    ).toMatchObject({ accessToken: "work-token", accountLabel: "work" });
  });

  it("also resolves by connected email display name", () => {
    expect(
      selectConnectedAccountCredential(
        { integrationType: "google_gmail", accountLabel: "work@example.com" },
        [gmail("personal"), gmail("work")],
      ),
    ).toMatchObject({ accessToken: "work-token", accountLabel: "work" });
  });

  it("uses stable account_label_not_found errors for unknown labels", () => {
    expect(() =>
      selectConnectedAccountCredential(
        { integrationType: "google_gmail", accountLabel: "missing" },
        [gmail("personal"), gmail("work")],
      ),
    ).toThrow('Account Label "missing" is not connected');
  });
});
