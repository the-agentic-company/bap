import { describe, expect, it } from "vitest";
import { redirectResponse } from "./redirect";

describe("redirectResponse", () => {
  it("preserves the 307 status the old NextResponse.redirect contract used", () => {
    const response = redirectResponse(new URL("https://app.example.com/login"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.com/login");
  });

  it("accepts a string target and an explicit status", () => {
    const response = redirectResponse("https://provider.example.com/oauth?x=1", 302);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://provider.example.com/oauth?x=1");
  });
});
