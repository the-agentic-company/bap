import { describe, expect, it } from "vitest";
import { resolveS3Endpoints } from "./s3-client";

describe("resolveS3Endpoints", () => {
  it("uses the internal endpoint for server operations and the public endpoint for presigning", () => {
    expect(
      resolveS3Endpoints({
        publicEndpointUrl: "https://bap-s3-staging.onrender.com",
        internalEndpointUrl: "http://bap-s3-staging:10000",
      }),
    ).toEqual({
      operationEndpointUrl: "http://bap-s3-staging:10000",
      presignEndpointUrl: "https://bap-s3-staging.onrender.com",
    });
  });

  it("falls back to the public endpoint when no internal endpoint is configured", () => {
    expect(
      resolveS3Endpoints({
        publicEndpointUrl: "http://localhost:9000",
      }),
    ).toEqual({
      operationEndpointUrl: "http://localhost:9000",
      presignEndpointUrl: "http://localhost:9000",
    });
  });
});
