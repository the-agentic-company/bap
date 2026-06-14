// oxlint-disable jsx-a11y/control-has-associated-label

import { T } from "gt-react";
import { Download, FileText, FileUp, Loader2, Plus, Trash2 } from "lucide-react";
import type { RefObject } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MarkdownEditorModeToggle,
  type MarkdownEditorMode,
} from "@/components/ui/markdown-editor-mode-toggle";
import { cn } from "@/lib/utils";
import { getDocumentIcon } from "./helpers";

type SkillFile = { id: string; path: string; content: string };
type SkillDocument = {
  id: string;
  mimeType: string;
  filename: string;
  path?: string | null;
};

export function SkillFileTabs({
  files,
  documents,
  selectedFileId,
  selectedDocumentId,
  canEdit,
  isSkillMd,
  skillMarkdownViewMode,
  isUploading,
  t,
  fileInputRef,
  onFileTabClick,
  onPromptDeleteFile,
  onDocumentTabClick,
  onPromptDownloadDocument,
  onPromptDeleteDocument,
  onShowAddFile,
  onTriggerDocumentUpload,
  onFileSelect,
  onMarkdownViewModeChange,
}: {
  files: SkillFile[];
  documents: SkillDocument[] | undefined;
  selectedFileId: string | null;
  selectedDocumentId: string | null;
  canEdit: boolean;
  isSkillMd: boolean;
  skillMarkdownViewMode: MarkdownEditorMode;
  isUploading: boolean;
  t: (s: string) => string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileTabClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onPromptDeleteFile: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDocumentTabClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onPromptDownloadDocument: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onPromptDeleteDocument: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onShowAddFile: () => void;
  onTriggerDocumentUpload: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onMarkdownViewModeChange: (nextMode: MarkdownEditorMode) => void;
}) {
  return (
    <div className="border-border/50 mb-3 flex shrink-0 items-center gap-1 overflow-x-auto border-b">
      {/* Text files */}
      {files
        .toSorted((a, b) => {
          if (a.path === "SKILL.md") {
            return -1;
          }
          if (b.path === "SKILL.md") {
            return 1;
          }
          return a.path.localeCompare(b.path);
        })
        .map((file) => (
          <button
            key={file.id}
            data-file-id={file.id}
            onClick={onFileTabClick}
            className={cn(
              "group flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors",
              selectedFileId === file.id
                ? "border-b-2 border-foreground/70 font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <FileText className="h-3 w-3" />
            {file.path}
            {canEdit && file.path !== "SKILL.md" && (
              <button
                data-file-id={file.id}
                data-file-path={file.path}
                onClick={onPromptDeleteFile}
                className="hover:bg-muted ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            )}
          </button>
        ))}
      {/* Document tabs */}
      {documents?.map((doc) => {
        const Icon = getDocumentIcon(doc.mimeType);
        return (
          <div
            key={doc.id}
            data-doc-id={doc.id}
            onClick={onDocumentTabClick}
            className={cn(
              "group flex cursor-pointer items-center gap-1 px-2.5 py-1.5 text-xs transition-colors",
              selectedDocumentId === doc.id
                ? "border-b-2 border-foreground/70 font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3 w-3" />
            {doc.path ?? doc.filename}
            <button
              data-doc-id={doc.id}
              onClick={onPromptDownloadDocument}
              className="hover:bg-muted ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100"
              title={t("Download document")}
            >
              <Download className="h-2.5 w-2.5" />
            </button>
            {canEdit ? (
              <button
                data-doc-id={doc.id}
                data-doc-filename={doc.path ?? doc.filename}
                onClick={onPromptDeleteDocument}
                className="hover:bg-muted ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </div>
        );
      })}
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1.5 text-xs">
              <Plus className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={onShowAddFile}>
              <FileText className="h-4 w-4" />
              <T>Text file</T>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onTriggerDocumentUpload} disabled={isUploading}>
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
              {isUploading ? "Uploading..." : "Document"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        onChange={onFileSelect}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.svg"
        className="hidden"
      />

      {/* Mode toggle - far right */}
      {isSkillMd && (
        <div className="ml-auto">
          <MarkdownEditorModeToggle
            mode={skillMarkdownViewMode}
            onModeChange={onMarkdownViewModeChange}
          />
        </div>
      )}
    </div>
  );
}
