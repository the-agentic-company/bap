// Barrel re-export for the @bap/db/schema public entrypoint.
// The schema is split by domain under ./schema/* to keep each file under the
// repo-wide 1000-line cap. Every symbol previously exported from this file is
// re-exported here unchanged, so the "@bap/db/schema" import path is stable.
export * from "./schema/enums";
export * from "./schema/types";
export * from "./schema/tables";
export * from "./schema/relations";
