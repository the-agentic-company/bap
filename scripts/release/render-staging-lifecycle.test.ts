import { describe, expect, it } from "vitest";
import {
  isRenderResumeNotUserSuspendedError,
  RenderRequestError,
} from "./render-staging-lifecycle";

describe("render staging lifecycle", () => {
  it("detects Render resume errors for services that were not user-suspended", () => {
    expect(
      isRenderResumeNotUserSuspendedError(
        new RenderRequestError({
          method: "POST",
          path: "/services/srv-1/resume",
          status: 400,
          apiMessage: "only services suspended by a user can be resumed",
        }),
      ),
    ).toBe(true);

    expect(
      isRenderResumeNotUserSuspendedError(
        new RenderRequestError({
          method: "POST",
          path: "/services/srv-1/resume",
          status: 500,
          apiMessage: "only services suspended by a user can be resumed",
        }),
      ),
    ).toBe(false);
  });
});
