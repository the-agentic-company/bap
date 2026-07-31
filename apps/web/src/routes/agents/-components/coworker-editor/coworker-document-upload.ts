import { MAX_DOCUMENTS_PER_COWORKER } from "@/lib/coworker-document-constraints";

export function getCoworkerDocumentUploadLimitError(
  currentDocumentCount: number,
  filesToUploadCount: number,
): string | null {
  const remainingDocumentCount = Math.max(0, MAX_DOCUMENTS_PER_COWORKER - currentDocumentCount);
  if (filesToUploadCount <= remainingDocumentCount) {
    return null;
  }

  if (remainingDocumentCount === 0) {
    return `This Coworker already has ${MAX_DOCUMENTS_PER_COWORKER} documents, the maximum allowed. Remove a document before uploading another.`;
  }

  return `You can add up to ${MAX_DOCUMENTS_PER_COWORKER} documents. This Coworker already has ${currentDocumentCount}, so you can upload ${remainingDocumentCount} more.`;
}

export async function uploadCoworkerDocumentFiles<TResult>(
  files: File[],
  uploadFile: (file: File) => Promise<TResult>,
): Promise<TResult[]> {
  return await files.reduce<Promise<TResult[]>>(
    (resultsPromise, file) =>
      resultsPromise.then(async (results) => [...results, await uploadFile(file)]),
    Promise.resolve([]),
  );
}
