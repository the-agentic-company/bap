import { describe, expect, it } from "vitest";
import {
  GenerationStartError,
  isGenerationStartError,
} from "./generation-start-error";

describe("isGenerationStartError", () => {
  it("recognizes structural errors from separate module graphs", () => {
    const error = new Error("Selected model is unavailable") as Error & {
      generationErrorCode: string;
      rpcCode: string;
    };
    error.name = "GenerationStartError";
    error.generationErrorCode = "model_access_denied";
    error.rpcCode = "BAD_REQUEST";

    expect(isGenerationStartError(error)).toBe(true);
  });

  it("recognizes local GenerationStartError instances", () => {
    expect(
      isGenerationStartError(
        new GenerationStartError({
          generationErrorCode: "model_access_denied",
          rpcCode: "BAD_REQUEST",
          message: "Selected model is unavailable",
        }),
      ),
    ).toBe(true);
  });
});
