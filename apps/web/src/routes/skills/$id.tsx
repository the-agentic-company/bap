// oxlint-disable jsx-a11y/control-has-associated-label unicorn/consistent-function-scoping

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { Loader2 } from "lucide-react";
import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type MarkdownEditorMode } from "@/components/ui/markdown-editor-mode-toggle";
import { parseSkillContent, serializeSkillContent } from "@/lib/skill-markdown";
import {
  useSkill,
  useUpdateSkill,
  useDeleteSkill,
  useAddSkillFile,
  useUpdateSkillFile,
  useDeleteSkillFile,
  useUploadSkillDocument,
  useDeleteSkillDocument,
  useGetDocumentUrl,
  useSaveSharedSkill,
} from "@/orpc/hooks/skills";
import { DeleteDocumentDialog, DeleteFileDialog } from "./-skill/dialogs";
import { SkillEditorArea } from "./-skill/editor-area";
import { SkillFileTabs } from "./-skill/file-tabs";
import { SkillEditorHeader, SkillEditorMetadata } from "./-skill/header";
import {
  generateDisplayName,
  generateSlug,
  isViewableDocument,
  type SkillMarkdownViewMode,
} from "./-skill/helpers";

/**
 * /skills/$id — user skill editor (was src/app/skills/[id]/page.tsx).
 * Protected by the parent /skills layout `beforeLoad` guard.
 */
export const Route = createFileRoute("/skills/$id")({
  component: SkillEditorPage,
});

function SkillEditorPageFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

const skillEditorPageFallbackNode = <SkillEditorPageFallback />;

function SkillEditorPageContent() {
  const t = useGT();

  const { id: skillId } = Route.useParams();
  const navigate = useNavigate();

  const { data: skill, isLoading, refetch } = useSkill(skillId);
  const updateSkill = useUpdateSkill();
  const deleteSkill = useDeleteSkill();
  const addFile = useAddSkillFile();
  const updateFile = useUpdateSkillFile();
  const deleteFile = useDeleteSkillFile();
  const uploadDocument = useUploadSkillDocument();
  const deleteDocument = useDeleteSkillDocument();
  const getDocumentUrl = useGetDocumentUrl();
  const saveSharedSkill = useSaveSharedSkill();

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [skillMarkdownViewMode, setSkillMarkdownViewMode] =
    useState<SkillMarkdownViewMode>("wysiwyg");
  const [isSaving, setIsSaving] = useState(false);
  const [showAddFile, setShowAddFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingShared, setIsSavingShared] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<{
    id: string;
    filename: string;
  } | null>(null);
  const [fileToDelete, setFileToDelete] = useState<{
    id: string;
    path: string;
  } | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [isLoadingDocumentUrl, setIsLoadingDocumentUrl] = useState(false);

  // Inline editing states
  const [isEditingSlug, setIsEditingSlug] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // For SKILL.md - separate state for metadata and body
  const [skillDisplayName, setSkillDisplayName] = useState("");
  const [skillSlug, setSkillSlug] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillIcon, setSkillIcon] = useState<string | null>(null);
  const [skillBody, setSkillBody] = useState("");
  const [skillFrontmatter, setSkillFrontmatter] = useState("");
  const [skillMarkdownSource, setSkillMarkdownSource] = useState("");

  // For other files - raw content
  const [editedContent, setEditedContent] = useState("");

  const syncSkillMarkdownState = useCallback(
    (content: string) => {
      const parsed = parseSkillContent(content);
      setSkillFrontmatter(parsed.frontmatter);
      setSkillMarkdownSource(content);
      setSkillBody(parsed.body);
      if (parsed.name) {
        setSkillSlug(parsed.name);
      }
      if (parsed.description) {
        setSkillDescription(parsed.description);
      }
      return parsed;
    },
    [setSkillBody, setSkillDescription, setSkillFrontmatter, setSkillMarkdownSource, setSkillSlug],
  );

  // Set initial selected file and content when skill loads
  useEffect(() => {
    if (skill?.files && skill.files.length > 0) {
      // Set display name and slug from skill metadata
      setSkillDisplayName(skill.displayName);
      setSkillSlug(skill.name);
      setSkillDescription(skill.description);
      setSkillIcon(skill.icon ?? null);

      const skillMd = skill.files.find((f) => f.path === "SKILL.md");
      const initialFile = skillMd || skill.files[0];
      // Only auto-select if nothing is selected (not a file, not a document)
      if (initialFile && !selectedFileId && !selectedDocumentId) {
        setSelectedFileId(initialFile.id);
        if (initialFile.path === "SKILL.md") {
          syncSkillMarkdownState(initialFile.content);
        } else {
          setEditedContent(initialFile.content);
        }
      }
    }
  }, [selectedDocumentId, selectedFileId, skill, syncSkillMarkdownState]);

  const handleDisplayNameChange = useCallback(
    (value: string) => {
      setSkillDisplayName(value);
      // Auto-generate slug if user hasn't manually edited it
      if (!isEditingSlug) {
        const nextSlug = generateSlug(value);
        setSkillSlug(nextSlug);
        setSkillMarkdownSource(
          serializeSkillContent(nextSlug, skillDescription, skillBody, skillFrontmatter),
        );
      }
    },
    [isEditingSlug, skillBody, skillDescription, skillFrontmatter],
  );

  const handleSaveFile = useCallback(
    async (showNotificationIfNoChanges = false) => {
      if (!skill?.canEdit) {
        return;
      }
      if (!selectedFileId) {
        return;
      }

      const selectedFile = skill?.files.find((f) => f.id === selectedFileId);
      if (!selectedFile) {
        return;
      }

      const content =
        selectedFile.path === "SKILL.md"
          ? skillMarkdownViewMode === "source"
            ? skillMarkdownSource
            : serializeSkillContent(skillSlug, skillDescription, skillBody, skillFrontmatter)
          : editedContent;

      // Check if there are actual changes
      const hasFileChanges = content !== selectedFile.content;
      const hasMetadataChanges =
        skillSlug !== skill?.name ||
        skillDisplayName !== skill?.displayName ||
        skillDescription !== skill?.description ||
        skillIcon !== (skill?.icon ?? null);

      // Skip save if nothing changed
      if (!hasFileChanges && !hasMetadataChanges) {
        if (showNotificationIfNoChanges) {
          setNotification({ type: "success", message: "Saved" });
        }
        return;
      }

      setIsSaving(true);
      try {
        if (hasFileChanges) {
          await updateFile.mutateAsync({
            id: selectedFileId,
            content,
          });
        }

        if (hasMetadataChanges) {
          // Also update skill metadata
          await updateSkill.mutateAsync({
            id: skillId,
            name: skillSlug,
            displayName: skillDisplayName,
            description: skillDescription,
            icon: skillIcon,
          });
        }

        setNotification({ type: "success", message: "Saved" });
        refetch();
      } catch {
        setNotification({ type: "error", message: "Failed to save" });
      } finally {
        setIsSaving(false);
      }
    },
    [
      selectedFileId,
      skill?.files,
      skill?.canEdit,
      skill?.name,
      skill?.displayName,
      skill?.description,
      skill?.icon,
      skillSlug,
      skillDescription,
      skillBody,
      skillFrontmatter,
      skillMarkdownSource,
      skillMarkdownViewMode,
      editedContent,
      skillDisplayName,
      skillIcon,
      updateFile,
      updateSkill,
      skillId,
      refetch,
    ],
  );

  const handleSelectFile = useCallback(
    (fileId: string) => {
      if (selectedFileId) {
        // Auto-save current file before switching
        void handleSaveFile();
      }
      const file = skill?.files.find((f) => f.id === fileId);
      if (file) {
        setSelectedFileId(fileId);
        setSelectedDocumentId(null);
        setDocumentUrl(null);
        if (file.path === "SKILL.md") {
          syncSkillMarkdownState(file.content);
          setSkillMarkdownViewMode("wysiwyg");
        } else {
          setEditedContent(file.content);
        }
      }
    },
    [handleSaveFile, selectedFileId, skill?.files, syncSkillMarkdownState],
  );

  const handleSelectDocument = useCallback(
    async (docId: string) => {
      if (selectedFileId) {
        // Auto-save current file before switching
        await handleSaveFile();
      }
      setSelectedFileId(null);
      setSelectedDocumentId(docId);
      setDocumentUrl(null);

      const doc = skill?.documents?.find((d) => d.id === docId);
      if (doc && isViewableDocument(doc.mimeType)) {
        setIsLoadingDocumentUrl(true);
        try {
          const { url } = await getDocumentUrl.mutateAsync(docId);
          setDocumentUrl(url);
        } catch {
          setNotification({ type: "error", message: "Failed to load document" });
        } finally {
          setIsLoadingDocumentUrl(false);
        }
      }
    },
    [getDocumentUrl, handleSaveFile, selectedFileId, skill?.documents],
  );

  const handleAddFile = useCallback(async () => {
    if (!skill?.canEdit) {
      return;
    }
    if (!newFilePath.trim()) {
      return;
    }

    try {
      await addFile.mutateAsync({
        skillId,
        path: newFilePath,
        content: `# ${newFilePath}\n\nAdd content here...`,
      });
      setShowAddFile(false);
      setNewFilePath("");
      setNotification({ type: "success", message: "File added" });
      refetch();
    } catch {
      setNotification({ type: "error", message: "Failed to add file" });
    }
  }, [addFile, newFilePath, refetch, skill?.canEdit, skillId]);

  const handleDeleteFile = useCallback(async () => {
    if (!skill?.canEdit || !fileToDelete) {
      return;
    }
    try {
      await deleteFile.mutateAsync(fileToDelete.id);
      if (selectedFileId === fileToDelete.id) {
        const skillMd = skill?.files.find((f) => f.path === "SKILL.md");
        if (skillMd) {
          setSelectedFileId(skillMd.id);
          syncSkillMarkdownState(skillMd.content);
        }
      }
      setNotification({ type: "success", message: "File deleted" });
      setFileToDelete(null);
      refetch();
    } catch {
      setNotification({ type: "error", message: "Failed to delete file" });
    }
  }, [
    deleteFile,
    fileToDelete,
    refetch,
    selectedFileId,
    skill?.canEdit,
    skill?.files,
    syncSkillMarkdownState,
  ]);

  const handleDeleteSkill = useCallback(async () => {
    if (!skill?.canEdit) {
      return;
    }
    if (!confirm(`Delete skill "${skillDisplayName}"? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteSkill.mutateAsync(skillId);
      void navigate({ to: "/toolbox" });
    } catch {
      setNotification({ type: "error", message: "Failed to delete skill" });
    }
  }, [deleteSkill, navigate, skill?.canEdit, skillDisplayName, skillId]);

  const handleSaveSharedSkill = useCallback(async () => {
    if (skill?.canEdit) {
      return;
    }

    setIsSavingShared(true);
    try {
      const saved = await saveSharedSkill.mutateAsync(skillId);
      void navigate({ to: "/skills/$id", params: { id: saved.id } });
    } catch {
      setNotification({ type: "error", message: "Failed to save a copy" });
    } finally {
      setIsSavingShared(false);
    }
  }, [navigate, saveSharedSkill, skill?.canEdit, skillId]);

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!skill?.canEdit) {
        return;
      }

      setIsSaving(true);
      try {
        await updateSkill.mutateAsync({
          id: skillId,
          enabled,
        });
        setNotification({
          type: "success",
          message: enabled ? "Skill enabled" : "Skill disabled",
        });
        await refetch();
      } catch {
        setNotification({ type: "error", message: "Failed to update skill status" });
      } finally {
        setIsSaving(false);
      }
    },
    [refetch, skill?.canEdit, skillId, updateSkill],
  );

  // Document handlers
  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!skill?.canEdit) {
        return;
      }
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }

      setIsUploading(true);
      try {
        const buffer = await file.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");

        await uploadDocument.mutateAsync({
          skillId,
          filename: file.name,
          mimeType: file.type,
          content: base64,
        });

        setNotification({ type: "success", message: "Document uploaded" });
        refetch();
      } catch (error) {
        setNotification({
          type: "error",
          message: error instanceof Error ? error.message : "Upload failed",
        });
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [refetch, skill?.canEdit, skillId, uploadDocument],
  );

  const handleDownloadDocument = useCallback(
    async (docId: string) => {
      try {
        const { url, filename } = await getDocumentUrl.mutateAsync(docId);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch {
        setNotification({ type: "error", message: "Failed to get download URL" });
      }
    },
    [getDocumentUrl],
  );

  const handleDeleteDocument = useCallback(async () => {
    if (!skill?.canEdit || !documentToDelete) {
      return;
    }

    try {
      await deleteDocument.mutateAsync(documentToDelete.id);
      if (selectedDocumentId === documentToDelete.id) {
        // Switch back to SKILL.md
        const skillMd = skill?.files.find((f) => f.path === "SKILL.md");
        if (skillMd) {
          setSelectedFileId(skillMd.id);
          setSelectedDocumentId(null);
          setDocumentUrl(null);
          syncSkillMarkdownState(skillMd.content);
        }
      }
      setNotification({ type: "success", message: "Document deleted" });
      setDocumentToDelete(null);
      refetch();
    } catch {
      setNotification({ type: "error", message: "Failed to delete document" });
    }
  }, [
    deleteDocument,
    documentToDelete,
    refetch,
    selectedDocumentId,
    skill?.canEdit,
    skill?.files,
    syncSkillMarkdownState,
  ]);

  // Auto-dismiss notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Auto-save with debounce
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    // Skip auto-save on initial load
    if (!hasInitializedRef.current) {
      if (skill?.files && skill.files.length > 0) {
        hasInitializedRef.current = true;
      }
      return;
    }

    // Don't auto-save if no file is selected
    if (!selectedFileId) {
      return;
    }

    if (!skill?.canEdit) {
      return;
    }

    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Set new timeout for auto-save (debounce 1 second)
    autoSaveTimeoutRef.current = setTimeout(() => {
      handleSaveFile();
    }, 1000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [
    skillBody,
    editedContent,
    skillDisplayName,
    skillSlug,
    skillDescription,
    skillIcon,
    selectedFileId,
    handleSaveFile,
    skill?.canEdit,
    skill?.files,
  ]);

  // Cmd+S / Ctrl+S to save immediately
  useHotkeys(
    "mod+s",
    (e) => {
      e.preventDefault();
      handleSaveFile(true);
    },
    { enableOnFormTags: ["INPUT", "TEXTAREA"] },
    [handleSaveFile],
  );

  const handleDisplayNameInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      handleDisplayNameChange(event.target.value);
    },
    [handleDisplayNameChange],
  );

  const handleSlugInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextSlug = event.target.value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-");
      setSkillSlug(nextSlug);
      setSkillMarkdownSource(
        serializeSkillContent(nextSlug, skillDescription, skillBody, skillFrontmatter),
      );
    },
    [skillBody, skillDescription, skillFrontmatter],
  );

  const handleStopEditingSlug = useCallback(() => {
    setIsEditingSlug(false);
  }, []);

  const handleSlugInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Escape") {
      setIsEditingSlug(false);
    }
  }, []);

  const handleStartEditingSlug = useCallback(() => {
    setIsEditingSlug(true);
  }, []);

  const handleDescriptionInputChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextDescription = event.target.value;
      setSkillDescription(nextDescription);
      setSkillMarkdownSource(
        serializeSkillContent(skillSlug, nextDescription, skillBody, skillFrontmatter),
      );
    },
    [skillBody, skillFrontmatter, skillSlug],
  );

  const handleStopEditingDescription = useCallback(() => {
    setIsEditingDescription(false);
  }, []);

  const handleDescriptionInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        setIsEditingDescription(false);
      }
    },
    [],
  );

  const handleStartEditingDescription = useCallback(() => {
    setIsEditingDescription(true);
  }, []);

  const handleFileTabClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const fileId = event.currentTarget.dataset.fileId;
      if (fileId) {
        handleSelectFile(fileId);
      }
    },
    [handleSelectFile],
  );

  const handlePromptDeleteFile = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const fileId = event.currentTarget.dataset.fileId;
    const filePath = event.currentTarget.dataset.filePath;
    if (fileId && filePath) {
      setFileToDelete({ id: fileId, path: filePath });
    }
  }, []);

  const handleDocumentTabClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const docId = event.currentTarget.dataset.docId;
      if (docId) {
        void handleSelectDocument(docId);
      }
    },
    [handleSelectDocument],
  );

  const handlePromptDeleteDocument = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const docId = event.currentTarget.dataset.docId;
    const filename = event.currentTarget.dataset.docFilename;
    if (docId && filename) {
      setDocumentToDelete({ id: docId, filename });
    }
  }, []);

  const handlePromptDownloadDocument = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const docId = event.currentTarget.dataset.docId;
      if (docId) {
        void handleDownloadDocument(docId);
      }
    },
    [handleDownloadDocument],
  );

  const handleShowAddFile = useCallback(() => {
    setShowAddFile(true);
  }, []);

  const handleTriggerDocumentUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleMarkdownViewModeChange = useCallback(
    (nextMode: MarkdownEditorMode) => {
      if (nextMode === "wysiwyg" && skillMarkdownViewMode === "source") {
        syncSkillMarkdownState(skillMarkdownSource);
      }
      if (nextMode === "source" && skillMarkdownViewMode === "wysiwyg") {
        setSkillMarkdownSource(
          serializeSkillContent(skillSlug, skillDescription, skillBody, skillFrontmatter),
        );
      }
      setSkillMarkdownViewMode(nextMode);
    },
    [
      skillMarkdownViewMode,
      skillMarkdownSource,
      skillSlug,
      skillDescription,
      skillBody,
      skillFrontmatter,
      syncSkillMarkdownState,
    ],
  );

  const handleNewFilePathChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setNewFilePath(event.target.value);
  }, []);

  const handleCancelAddFile = useCallback(() => {
    setShowAddFile(false);
    setNewFilePath("");
  }, []);

  const handleNewFilePathKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        void handleAddFile();
      }
      if (event.key === "Escape") {
        handleCancelAddFile();
      }
    },
    [handleAddFile, handleCancelAddFile],
  );

  const handleMarkdownSourceChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextContent = event.target.value;
      const parsed = parseSkillContent(nextContent);
      setSkillMarkdownSource(nextContent);
      setSkillFrontmatter(parsed.frontmatter);
      setSkillSlug(parsed.name);
      setSkillDescription(parsed.description);
      setSkillBody(parsed.body);
      if (parsed.name !== skillSlug) {
        setSkillDisplayName(generateDisplayName(parsed.name));
      }
    },
    [skillSlug],
  );

  const handleSkillBodyChange = useCallback(
    (nextBody: string) => {
      setSkillBody(nextBody);
      setSkillMarkdownSource(
        serializeSkillContent(skillSlug, skillDescription, nextBody, skillFrontmatter),
      );
    },
    [skillSlug, skillDescription, skillFrontmatter],
  );

  const handleNonSkillFileContentChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setEditedContent(event.target.value);
    },
    [],
  );

  const handleCancelDeleteDocument = useCallback(() => {
    setDocumentToDelete(null);
  }, []);

  const handleCancelDeleteFile = useCallback(() => {
    setFileToDelete(null);
  }, []);

  const handleDownloadSelectedDocument = useCallback(() => {
    if (selectedDocumentId) {
      void handleDownloadDocument(selectedDocumentId);
    }
  }, [handleDownloadDocument, selectedDocumentId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">
          <T>Skill not found</T>
        </p>
        <Button asChild className="mt-4">
          <Link to="/toolbox">
            <T>Back to Skills</T>
          </Link>
        </Button>
      </div>
    );
  }

  const selectedFile = skill.files.find((f) => f.id === selectedFileId);
  const isSkillMd = selectedFile?.path === "SKILL.md";
  const canEdit = skill.canEdit;
  const isEnabled = skill.enabled;
  const toolIntegrations = (skill.toolIntegrations ?? []) as DisplayIntegrationType[];

  return (
    <div className="h-[calc(100dvh-5rem)]">
      {/* Skill copilot dual panel is disabled until it is ready. */}
      <div className="flex h-full min-h-0 flex-col">
        {/* Header with back button and delete */}
        <SkillEditorHeader
          canEdit={canEdit}
          owner={skill.owner}
          isSaving={isSaving}
          isSavingShared={isSavingShared}
          notification={notification}
          onDeleteSkill={handleDeleteSkill}
          onSaveSharedSkill={handleSaveSharedSkill}
        />

        {/* Notion-style inline editable metadata */}
        <SkillEditorMetadata
          canEdit={canEdit}
          isEnabled={isEnabled}
          isSaving={isSaving}
          skillIcon={skillIcon}
          setSkillIcon={setSkillIcon}
          skillDisplayName={skillDisplayName}
          skillSlug={skillSlug}
          skillDescription={skillDescription}
          isEditingSlug={isEditingSlug}
          isEditingDescription={isEditingDescription}
          toolIntegrations={toolIntegrations}
          t={t}
          displayNameRef={displayNameRef}
          slugRef={slugRef}
          descriptionRef={descriptionRef}
          onToggleEnabled={handleToggleEnabled}
          onDisplayNameInputChange={handleDisplayNameInputChange}
          onSlugInputChange={handleSlugInputChange}
          onStopEditingSlug={handleStopEditingSlug}
          onSlugInputKeyDown={handleSlugInputKeyDown}
          onStartEditingSlug={handleStartEditingSlug}
          onDescriptionInputChange={handleDescriptionInputChange}
          onStopEditingDescription={handleStopEditingDescription}
          onDescriptionInputKeyDown={handleDescriptionInputKeyDown}
          onStartEditingDescription={handleStartEditingDescription}
        />

        {/* File tabs - subtle style, above editor */}
        <SkillFileTabs
          files={skill.files}
          documents={skill.documents}
          selectedFileId={selectedFileId}
          selectedDocumentId={selectedDocumentId}
          canEdit={canEdit}
          isSkillMd={isSkillMd}
          skillMarkdownViewMode={skillMarkdownViewMode}
          isUploading={isUploading}
          t={t}
          fileInputRef={fileInputRef}
          onFileTabClick={handleFileTabClick}
          onPromptDeleteFile={handlePromptDeleteFile}
          onDocumentTabClick={handleDocumentTabClick}
          onPromptDownloadDocument={handlePromptDownloadDocument}
          onPromptDeleteDocument={handlePromptDeleteDocument}
          onShowAddFile={handleShowAddFile}
          onTriggerDocumentUpload={handleTriggerDocumentUpload}
          onFileSelect={handleFileSelect}
          onMarkdownViewModeChange={handleMarkdownViewModeChange}
        />

        {/* Add file input */}
        {canEdit && showAddFile && (
          <div className="mb-4 flex shrink-0 items-center gap-2">
            <Input
              placeholder={t("filename.md")}
              value={newFilePath}
              onChange={handleNewFilePathChange}
              className="h-8 flex-1 text-sm"
              autoFocus
              onKeyDown={handleNewFilePathKeyDown}
            />
            <Button size="sm" onClick={handleAddFile} disabled={!newFilePath.trim()}>
              <T>Add</T>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCancelAddFile}>
              <T>Cancel</T>
            </Button>
          </div>
        )}

        {/* Editor/Content area */}
        <SkillEditorArea
          selectedFile={selectedFile}
          selectedDocumentId={selectedDocumentId}
          documents={skill.documents}
          isSkillMd={isSkillMd}
          skillMarkdownViewMode={skillMarkdownViewMode}
          canEdit={canEdit}
          skillBody={skillBody}
          skillMarkdownSource={skillMarkdownSource}
          editedContent={editedContent}
          isLoadingDocumentUrl={isLoadingDocumentUrl}
          documentUrl={documentUrl}
          t={t}
          onSkillBodyChange={handleSkillBodyChange}
          onMarkdownSourceChange={handleMarkdownSourceChange}
          onNonSkillFileContentChange={handleNonSkillFileContentChange}
          onDownloadSelectedDocument={handleDownloadSelectedDocument}
        />

        {/* Delete document confirmation modal */}
        {documentToDelete && (
          <DeleteDocumentDialog
            filename={documentToDelete.filename}
            onCancel={handleCancelDeleteDocument}
            onConfirm={handleDeleteDocument}
          />
        )}

        {/* Delete file confirmation modal */}
        {fileToDelete && (
          <DeleteFileDialog
            path={fileToDelete.path}
            onCancel={handleCancelDeleteFile}
            onConfirm={handleDeleteFile}
          />
        )}
      </div>
    </div>
  );
}

function SkillEditorPage() {
  return (
    <Suspense fallback={skillEditorPageFallbackNode}>
      <SkillEditorPageContent />
    </Suspense>
  );
}
