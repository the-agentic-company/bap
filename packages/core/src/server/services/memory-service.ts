import { MEMORY_BASE_PATH, SESSION_BASE_PATH } from "./memory/format";
import { DEFAULT_SEARCH_LIMIT } from "./memory/embedding";
import { listMemoryFiles, searchMemory } from "./memory/memory-store";
import { listSessionTranscripts, searchSessionTranscripts } from "./memory/transcript-store";
import type { MemorySearchInput, MemorySearchResult } from "./memory/search-types";

export type {
  MemoryFileType,
  MemoryWriteInput,
  MemoryGetInput,
} from "./memory/format";
export type { MemorySearchInput, MemorySearchResult } from "./memory/search-types";

export {
  buildMemorySystemPrompt,
  chunkMarkdown,
} from "./memory/format";
export {
  writeMemoryEntry,
  readMemoryFile,
} from "./memory/memory-store";
export {
  readSessionTranscriptByPath,
  writeSessionTranscriptFromConversation,
} from "./memory/transcript-store";

/**
 * Search a user's memory, then (unless the query is scoped to a specific memory
 * file by type/date) also search their session transcripts, and return the
 * top results across both sources merged by descending score.
 */
export async function searchMemoryWithSessions(
  input: MemorySearchInput,
): Promise<MemorySearchResult[]> {
  const memoryResults = await searchMemory(input);
  if (input.type || input.date) {
    return memoryResults;
  }

  const sessionResults = await searchSessionTranscripts(input);
  const merged = [...memoryResults, ...sessionResults].toSorted((a, b) => b.score - a.score);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, 20));
  return merged.slice(0, limit);
}

/**
 * Materialize a user's memory files and session transcripts onto a sandbox
 * filesystem, creating the memory and sessions directories first, and return
 * the absolute paths written.
 */
export async function syncMemoryToSandbox(
  userId: string,
  writeFile: (path: string, content: string) => Promise<void>,
  ensureDir: (path: string) => Promise<void>,
): Promise<string[]> {
  const files = await listMemoryFiles(userId);
  const transcripts = await listSessionTranscripts(userId);
  if (files.length === 0 && transcripts.length === 0) {
    return [];
  }

  await ensureDir(`${MEMORY_BASE_PATH}/memory`);
  await ensureDir(SESSION_BASE_PATH);

  const memoryWrites = files.map(async (file) => {
    const fullPath = `${MEMORY_BASE_PATH}/${file.path}`;
    await writeFile(fullPath, file.text);
    return fullPath;
  });
  const transcriptWrites = transcripts.map(async (transcript) => {
    const fullPath = `${MEMORY_BASE_PATH}/${transcript.path}`;
    await writeFile(fullPath, transcript.text);
    return fullPath;
  });

  return Promise.all([...memoryWrites, ...transcriptWrites]);
}
