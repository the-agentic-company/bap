import type { StartGenerationErrorCode } from "../../lib/generation-errors";

type GenerationStartRpcCode = "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND";

export class GenerationStartError extends Error {
  readonly generationErrorCode: StartGenerationErrorCode;
  readonly rpcCode: GenerationStartRpcCode;

  constructor(options: {
    generationErrorCode: StartGenerationErrorCode;
    rpcCode: GenerationStartRpcCode;
    message: string;
  }) {
    super(options.message);
    this.name = "GenerationStartError";
    this.generationErrorCode = options.generationErrorCode;
    this.rpcCode = options.rpcCode;
  }
}

export function isGenerationStartError(error: unknown): error is GenerationStartError {
  if (error instanceof GenerationStartError) {
    return true;
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    name?: unknown;
    message?: unknown;
    generationErrorCode?: unknown;
    rpcCode?: unknown;
  };

  return (
    candidate.name === "GenerationStartError" &&
    typeof candidate.message === "string" &&
    typeof candidate.generationErrorCode === "string" &&
    (candidate.rpcCode === "BAD_REQUEST" ||
      candidate.rpcCode === "FORBIDDEN" ||
      candidate.rpcCode === "NOT_FOUND")
  );
}
