import { File, FileSpreadsheet, Image } from "lucide-react";
import type { MarkdownEditorMode } from "@/components/ui/markdown-editor-mode-toggle";
import remarkGfm from "remark-gfm";

export type SkillMarkdownViewMode = MarkdownEditorMode;
export const markdownRemarkPlugins = [remarkGfm];

export function generateSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function generateDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function isViewableDocument(mimeType: string) {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getDocumentIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return Image;
  }
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) {
    return FileSpreadsheet;
  }
  return File;
}
