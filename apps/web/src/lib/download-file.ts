export async function triggerBrowserDownload(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(objectUrl);
}

type SandboxFileDownloader = (fileId: string) => Promise<{ url: string }>;
type DownloadableSandboxFile = {
  fileId: string;
  filename: string;
};

export async function downloadSandboxFileToBrowser(
  downloadSandboxFile: SandboxFileDownloader,
  file: DownloadableSandboxFile,
) {
  const result = await downloadSandboxFile(file.fileId);
  await triggerBrowserDownload(result.url, file.filename);
}
