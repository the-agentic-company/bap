import { beforeEach, describe, expect, it } from "vitest";
import { buildRequestAwareUrl, getRequestAwareOrigin } from "./request-aware-url";

describe("request-aware-url", () => {
  beforeEach(() => {
    delete process.env.APP_URL;
    delete process.env.VITE_APP_URL;
  });

  it("preserves the request origin for public hosts", () => {
    expect(getRequestAwareOrigin("https://app.example.com/toolbox")).toBe(
      "https://app.example.com",
    );
  });

  it("uses APP_URL when the request host is internal", () => {
    process.env.APP_URL = "https://app.example.com";

    expect(getRequestAwareOrigin("https://0.0.0.0:3000/toolbox")).toBe("https://app.example.com");
  });

  it("normalizes absolute internal redirect targets to the configured app origin", () => {
    process.env.APP_URL = "https://app.example.com";

    expect(
      buildRequestAwareUrl("https://0.0.0.0:3000/toolbox?success=true", "https://0.0.0.0:3000/api"),
    ).toEqual(new URL("https://app.example.com/toolbox?success=true"));
  });
});
