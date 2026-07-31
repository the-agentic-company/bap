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
