import type { Directory } from "./directory";
import type { UnipileClient } from "./unipile-client";

/**
 * Parsed CLI flag values shared by every operation. Mirrors the `parseArgs` options
 * declared in `cli.ts`; kept as a structural type so handlers depend on the flags they
 * read, not on the parser.
 */
export type CliValues = {
  help?: boolean;
  limit?: string;
  text?: string;
  query?: string;
  message?: string;
  profile?: string;
  type?: string;
  visibility?: string;
  cursor?: string;
  "comment-id"?: string;
  "sort-by"?: string;
};

/**
 * The single dependency bundle threaded into every operation handler. Replacing the
 * old module-level globals (`api`, `LINKEDIN_ACCOUNT_ID`, `values`, the cache) with one
 * explicit context is what lets the operations live in cohesive files without hidden
 * coupling — the seam the previous single-file layout lacked.
 */
export type OperationContext = {
  client: UnipileClient;
  directory: Directory;
  values: CliValues;
};

/** Parse `--limit` with the given fallback, matching the legacy `parseInt` behaviour. */
export function limitOf(values: CliValues, fallback: string): number {
  return parseInt(values.limit || fallback);
}
