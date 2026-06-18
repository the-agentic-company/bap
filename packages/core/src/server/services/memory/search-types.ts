import type { MemoryFileType } from "./format";

export interface MemorySearchInput {
  userId: string;
  query: string;
  limit?: number;
  type?: MemoryFileType;
  date?: string;
}

export interface MemorySearchResult {
  id: string;
  path: string;
  score: number;
  snippet: string;
  fileId: string;
  entryId: string | null;
  entryTitle?: string | null;
  source?: "memory" | "session";
}
