import { describe, expect, it } from "vitest";
import { getSessionCookieHeaders, normalizeSessionCookieHeaders } from "./session-auth";

describe("normalizeSessionCookieHeaders", () => {
  it("keeps the latest Better Auth session cookie when duplicate session cookies exist", () => {
    const headers = new Headers({
      cookie:
        "theme=light; better-auth.session_token=stale; other=value; better-auth.session_token=current",
    });

    const normalized = normalizeSessionCookieHeaders(headers);

    expect(normalized.get("cookie")).toBe(
      "theme=light; other=value; better-auth.session_token=current",
    );
  });

  it("normalizes mixed regular and secure Better Auth session cookies to the rightmost session cookie", () => {
    const headers = new Headers({
      cookie:
        "better-auth.session_token=stale; locale=en; __Secure-better-auth.session_token=current",
    });

    const normalized = normalizeSessionCookieHeaders(headers);

    expect(normalized.get("cookie")).toBe("locale=en; better-auth.session_token=current");
  });

  it("returns the original headers when there is no session cookie", () => {
    const headers = new Headers({ cookie: "theme=light" });

    expect(normalizeSessionCookieHeaders(headers)).toBe(headers);
  });

  it("extracts every unique Better Auth session cookie as server-readable headers in newest-first resolution order", () => {
    const headers = new Headers({
      cookie:
        "better-auth.session_token=stale; theme=light; __Secure-better-auth.session_token=current; better-auth.session_token=current",
    });

    const sessionHeaders = getSessionCookieHeaders(headers);

    expect(sessionHeaders.map((header) => header.get("cookie"))).toEqual([
      "better-auth.session_token=current",
      "__Secure-better-auth.session_token=current",
      "better-auth.session_token=stale",
      "__Secure-better-auth.session_token=stale",
    ]);
  });
});

describe("getSessionCookieHeaders", () => {
  it("preserves secure session cookie candidates before trying regular-cookie compatibility", () => {
    const headers = new Headers({
      cookie: "__Secure-better-auth.session_token=current",
    });

    const sessionHeaders = getSessionCookieHeaders(headers);

    expect(sessionHeaders.map((header) => header.get("cookie"))).toEqual([
      "__Secure-better-auth.session_token=current",
      "better-auth.session_token=current",
    ]);
  });
});
