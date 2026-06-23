import { useMutation } from "@tanstack/react-query";
import { client } from "../client";

export type FileAssetUploadResult = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "ready";
};

type UploadFileAssetOptions = {
  onProgress?: (progress: { loaded: number; total: number; percent: number }) => void;
};

function putFileToSignedUrl(
  uploadUrl: string,
  file: File,
  mimeType: string,
  options?: UploadFileAssetOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", mimeType);

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        return;
      }
      options?.onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      });
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`Upload failed with status ${request.status}`));
    });
    request.addEventListener("error", () => reject(new Error("Upload failed")));
    request.addEventListener("abort", () => reject(new Error("Upload aborted")));
    request.send(file);
  });
}

export async function uploadFileAsset(
  file: File,
  options?: UploadFileAssetOptions,
): Promise<FileAssetUploadResult> {
  const mimeType = file.type || "application/octet-stream";
  const session = await client.fileAsset.createUpload({
    filename: file.name,
    mimeType,
    sizeBytes: file.size,
  });

  await putFileToSignedUrl(session.uploadUrl, file, mimeType, options);
  return await client.fileAsset.completeUpload({ uploadSessionId: session.uploadSessionId });
}

export function useUploadFileAsset() {
  return useMutation({
    mutationFn: ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress?: UploadFileAssetOptions["onProgress"];
    }) => uploadFileAsset(file, { onProgress }),
  });
}
