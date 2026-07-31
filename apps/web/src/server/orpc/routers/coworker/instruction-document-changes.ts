export type CoworkerDocumentHistoryEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export type CoworkerInstructionDocumentChange = {
  type: "added" | "removed";
  filename: string;
};

export function summarizeCoworkerInstructionDocumentChanges(
  events: CoworkerDocumentHistoryEvent[],
): CoworkerInstructionDocumentChange[] {
  const changesByFilename = new Map<string, CoworkerInstructionDocumentChange>();

  for (const event of events) {
    if (event.type === "document_updated") {
      const before = event.payload.before;
      const after = event.payload.after;
      const beforeFilename =
        typeof before === "object" &&
        before !== null &&
        typeof (before as Record<string, unknown>).filename === "string"
          ? ((before as Record<string, unknown>).filename as string)
          : null;
      const afterFilename =
        typeof after === "object" &&
        after !== null &&
        typeof (after as Record<string, unknown>).filename === "string"
          ? ((after as Record<string, unknown>).filename as string)
          : null;
      if (beforeFilename && afterFilename && beforeFilename !== afterFilename) {
        changesByFilename.set(beforeFilename, { type: "removed", filename: beforeFilename });
        changesByFilename.set(afterFilename, { type: "added", filename: afterFilename });
      }
      continue;
    }

    const filename = event.payload.filename;
    if (typeof filename !== "string" || filename.trim().length === 0) {
      continue;
    }

    if (event.type === "document_added") {
      changesByFilename.set(filename, { type: "added", filename });
    } else if (event.type === "document_removed") {
      changesByFilename.set(filename, { type: "removed", filename });
    }
  }

  return [...changesByFilename.values()];
}
