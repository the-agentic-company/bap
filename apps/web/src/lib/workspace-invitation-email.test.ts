import { describe, expect, it } from "vitest";
import {
  buildWorkspaceInvitationEmailPayload,
  buildWorkspaceInvitationUrl,
} from "./workspace-invitation-email";

describe("workspace-invitation-email", () => {
  it("builds a product route invitation URL", () => {
    expect(
      buildWorkspaceInvitationUrl("inv 1", "https://heybap.com", "recipient@example.com"),
    ).toBe("https://heybap.com/workspace-invitations/inv%201?email=recipient%40example.com");
  });

  it("renders invitation content without exposing raw HTML", () => {
    const payload = buildWorkspaceInvitationEmailPayload({
      invitationUrl: "https://heybap.com/workspace-invitations/inv-1",
      workspaceName: "<Acme>",
      inviterEmail: "owner@example.com",
    });

    expect(payload.text).toContain("owner@example.com invited you to join <Acme> on Bap.");
    expect(payload.html).toContain("&lt;Acme&gt;");
    expect(payload.html).not.toContain("<Acme>");
  });
});
