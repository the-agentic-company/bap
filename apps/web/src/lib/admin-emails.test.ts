import { afterEach, describe, expect, it } from "vitest";
import { getAdminEmails, normalizeAdminEmail, shouldGrantAdminRole } from "./admin-emails";

describe("admin-emails", () => {
  afterEach(() => {
    delete process.env.APP_ADMIN_EMAILS;
    delete process.env.APP_DEFAULT_USER_EMAIL;
  });

  it("normalizes emails for admin access checks", () => {
    process.env.APP_ADMIN_EMAILS = "  Admin@Example.com ";

    expect(shouldGrantAdminRole("  ADMIN@EXAMPLE.COM ")).toBe(true);
  });

  it("normalizes emails consistently", () => {
    expect(normalizeAdminEmail("  ADMIN@EXAMPLE.COM ")).toBe("admin@example.com");
  });

  it("returns configured admin emails", () => {
    process.env.APP_ADMIN_EMAILS = "second@example.com, First@Example.com";

    expect(getAdminEmails()).toEqual(["first@example.com", "second@example.com"]);
  });

  it("falls back to the default user email", () => {
    process.env.APP_DEFAULT_USER_EMAIL = "Owner@Example.com";

    expect(getAdminEmails()).toEqual(["owner@example.com"]);
  });

  it("does not grant admin access without configuration", () => {
    expect(shouldGrantAdminRole("admin@example.com")).toBe(false);
  });
});
