// oxlint-disable jsx-a11y/control-has-associated-label

import { T } from "gt-react";
import { Download, FileText, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { MilkdownEditor } from "@/components/ui/milkdown-editor";
import { Button } from "@/components/ui/button";
import {
  getDocumentIcon,
  isViewableDocument,
  formatFileSize,
  markdownRemarkPlugins,
} from "./helpers";

type SkillFile = { id: string; path: string; content: string };
type SkillDocument = {
  id: string;
  mimeType: string;
  filename: string;
  path?: string | null;
  sizeBytes: number;
};

export function SkillEditorArea({
  selectedFile,
  selectedDocumentId,
  documents,
  isSkillMd,
  skillMarkdownViewMode,
  canEdit,
  skillBody,
  skillMarkdownSource,
  editedContent,
  isLoadingDocumentUrl,
  documentUrl,
  t,
  onSkillBodyChange,
  onMarkdownSourceChange,
  onNonSkillFileContentChange,
  onDownloadSelectedDocument,
}: {
  selectedFile: SkillFile | undefined;
  selectedDocumentId: string | null;
  documents: SkillDocument[] | undefined;
  isSkillMd: boolean;
  skillMarkdownViewMode: string;
  canEdit: boolean;
  skillBody: string;
  skillMarkdownSource: string;
  editedContent: string;
  isLoadingDocumentUrl: boolean;
  documentUrl: string | null;
  t: (s: string) => string;
  onSkillBodyChange: (nextBody: string) => void;
  onMarkdownSourceChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onNonSkillFileContentChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onDownloadSelectedDocument: () => void;
}) {
  return (
    <div className="min-h-0 flex-1">
      {selectedFile && !selectedDocumentId && (
        <>
          {isSkillMd && skillMarkdownViewMode === "wysiwyg" ? (
            canEdit ? (
              <div className="h-full overflow-hidden rounded-lg border">
                <MilkdownEditor
                  value={skillBody}
                  onChange={onSkillBodyChange}
                  placeholder={t("Add your skill instructions here...")}
                  className="h-full"
                />
              </div>
            ) : (
              <div className="h-full overflow-y-auto rounded-lg border p-4">
                <article className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={markdownRemarkPlugins}>{skillBody}</ReactMarkdown>
                </article>
              </div>
            )
          ) : isSkillMd && skillMarkdownViewMode === "source" ? (
            <textarea
              value={skillMarkdownSource}
              onChange={onMarkdownSourceChange}
              readOnly={!canEdit}
              className="bg-background focus:ring-ring h-full w-full resize-none rounded-lg border p-4 font-mono text-sm focus:ring-2 focus:outline-none"
              placeholder="---
name: skill-name
description: What this skill does
---

# Instructions

Add your skill instructions here..."
            />
          ) : (
            <textarea
              value={editedContent}
              onChange={onNonSkillFileContentChange}
              readOnly={!canEdit}
              className="bg-background focus:ring-ring h-full w-full resize-none rounded-lg border p-4 font-mono text-sm focus:ring-2 focus:outline-none"
            />
          )}
        </>
      )}
      {selectedDocumentId &&
        (() => {
          const selectedDoc = documents?.find((d) => d.id === selectedDocumentId);
          if (!selectedDoc) {
            return null;
          }

          const isViewable = isViewableDocument(selectedDoc.mimeType);

          if (isLoadingDocumentUrl) {
            return (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            );
          }

          if (isViewable && documentUrl) {
            if (selectedDoc.mimeType === "application/pdf") {
              return (
                <object
                  data={documentUrl}
                  type="application/pdf"
                  className="h-full w-full rounded-lg border"
                  aria-label={selectedDoc.filename}
                >
                  <div className="bg-muted/30 flex h-full flex-col items-center justify-center gap-4 rounded-lg border">
                    <FileText className="text-muted-foreground h-16 w-16" />
                    <p className="text-muted-foreground text-sm">
                      <T>Preview unavailable in this browser.</T>
                    </p>
                    <Button onClick={onDownloadSelectedDocument}>
                      <Download className="mr-2 h-4 w-4" />
                      <T>Download</T>
                    </Button>
                  </div>
                </object>
              );
            }
            if (selectedDoc.mimeType.startsWith("image/")) {
              return (
                <div className="bg-muted/30 flex h-full items-center justify-center overflow-auto rounded-lg border p-4">
                  <img
                    src={documentUrl}
                    alt={selectedDoc.filename}
                    width={1200}
                    height={1200}
                    loading="lazy"
                    decoding="async"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              );
            }
          }

          // Non-viewable document - show download prompt
          const Icon = getDocumentIcon(selectedDoc.mimeType);
          return (
            <div className="bg-muted/30 flex h-full flex-col items-center justify-center gap-4 rounded-lg border">
              <Icon className="text-muted-foreground h-16 w-16" />
              <div className="text-center">
                <p className="font-medium">{selectedDoc.filename}</p>
                <p className="text-muted-foreground text-sm">
                  {formatFileSize(selectedDoc.sizeBytes)}
                </p>
              </div>
              <Button onClick={onDownloadSelectedDocument}>
                <Download className="mr-2 h-4 w-4" />
                <T>Download</T>
              </Button>
            </div>
          );
        })()}
    </div>
  );
}
