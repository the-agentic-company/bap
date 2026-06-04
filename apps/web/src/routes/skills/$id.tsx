// oxlint-disable jsx-a11y/control-has-associated-label unicorn/consistent-function-scoping

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Loader2,
  Trash2,
  Plus,
  FileText,
  CheckCircle2,
  XCircle,
  Pencil,
  FileUp,
  Download,
  File,
  Image,
  FileSpreadsheet,
} from "lucide-react";
import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { IntegrationBadges } from "@/components/chat/integration-badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconPicker } from "@/components/ui/icon-picker";
import { Input } from "@/components/ui/input";
import {
  MarkdownEditorModeToggle,
  type MarkdownEditorMode,
} from "@/components/ui/markdown-editor-mode-toggle";
import { MilkdownEditor } from "@/components/ui/milkdown-editor";
import { Switch } from "@/components/ui/switch";
import { parseSkillContent, serializeSkillContent } from "@/lib/skill-markdown";
import { cn } from "@/lib/utils";
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

/**
 * /skills/$id — user skill editor (was src/app/skills/[id]/page.tsx).
 * Protected by the parent /skills layout `beforeLoad` guard.
 */
export const Route = createFileRoute("/skills/$id")({
  component: SkillEditorPage,
});

type SkillMarkdownViewMode = MarkdownEditorMode;
const markdownRemarkPlugins = [remarkGfm];

function generateSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function generateDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isViewableDocument(mimeType: string) {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SkillEditorPageFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

const skillEditorPageFallbackNode = <SkillEditorPageFallback />;

function SkillEditorPageContent() {
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

  const getDocumentIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) {
      return Image;
    }
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) {
      return FileSpreadsheet;
    }
    return File;
  };

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
        <p className="text-muted-foreground">Skill not found</p>
        <Button asChild className="mt-4">
          <Link to="/toolbox">Back to Skills</Link>
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
        <div className="mb-6 flex shrink-0 items-center justify-between">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/toolbox">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            {!canEdit ? (
              <span className="text-muted-foreground text-xs">
                Shared by {skill.owner.name ?? skill.owner.email ?? "workspace"}
              </span>
            ) : null}
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs transition-opacity",
                isSaving
                  ? "opacity-100 text-muted-foreground"
                  : notification?.type === "success"
                    ? "opacity-100 text-green-600 dark:text-green-400"
                    : notification?.type === "error"
                      ? "opacity-100 text-red-600 dark:text-red-400"
                      : "opacity-0 text-muted-foreground",
              )}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving...
                </>
              ) : notification?.type === "success" ? (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  Saved
                </>
              ) : notification?.type === "error" ? (
                <>
                  <XCircle className="h-3 w-3" />
                  {notification.message}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  Saved
                </>
              )}
            </span>
            {canEdit ? (
              <Button variant="ghost" size="sm" onClick={handleDeleteSkill}>
                <Trash2 className="h-3 w-3" />
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleSaveSharedSkill}>
                {isSavingShared ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                Save to my skills
              </Button>
            )}
          </div>
        </div>

        {/* Notion-style inline editable metadata */}
        <div className="mb-6 shrink-0 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "size-2 rounded-full",
                  isEnabled ? "bg-green-500" : "bg-muted-foreground/30",
                )}
              />
              <span className="text-muted-foreground text-sm">
                {isEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs font-medium">
                {isEnabled ? "On" : "Off"}
              </span>
              <Switch
                checked={isEnabled}
                onCheckedChange={handleToggleEnabled}
                disabled={!canEdit || isSaving}
                aria-label="Toggle skill enabled"
              />
            </div>
          </div>

          {/* Icon and Display Name */}
          <div className="flex items-start gap-3">
            {canEdit ? (
              <IconPicker value={skillIcon} onChange={setSkillIcon}>
                <button
                  type="button"
                  className="bg-muted hover:bg-muted/80 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border transition-colors"
                >
                  {skillIcon ? (
                    <span className="text-2xl">{skillIcon}</span>
                  ) : (
                    <FileText className="text-muted-foreground h-6 w-6" />
                  )}
                </button>
              </IconPicker>
            ) : (
              <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border">
                {skillIcon ? (
                  <span className="text-2xl">{skillIcon}</span>
                ) : (
                  <FileText className="text-muted-foreground h-6 w-6" />
                )}
              </div>
            )}
            <input
              ref={displayNameRef}
              type="text"
              value={skillDisplayName}
              onChange={handleDisplayNameInputChange}
              placeholder="Untitled Skill"
              readOnly={!canEdit}
              className="placeholder:text-muted-foreground/50 w-full bg-transparent pt-1 text-3xl font-bold outline-none focus:outline-none"
            />
          </div>

          {/* Slug - Small monospace, editable on click */}
          <div className="flex items-center gap-1.5">
            {isEditingSlug ? (
              <input
                ref={slugRef}
                type="text"
                value={skillSlug}
                onChange={handleSlugInputChange}
                onBlur={handleStopEditingSlug}
                onKeyDown={handleSlugInputKeyDown}
                className="text-muted-foreground h-6 bg-transparent font-mono text-xs outline-none"
                autoFocus
              />
            ) : (
              <button
                onClick={handleStartEditingSlug}
                disabled={!canEdit}
                className="group text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
              >
                <span className="font-mono">{skillSlug || "skill-slug"}</span>
                {canEdit ? <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100" /> : null}
              </button>
            )}
          </div>

          {/* Description - Muted text, expands to input on click */}
          {isEditingDescription ? (
            <textarea
              ref={descriptionRef}
              value={skillDescription}
              onChange={handleDescriptionInputChange}
              onBlur={handleStopEditingDescription}
              onKeyDown={handleDescriptionInputKeyDown}
              placeholder="Add a description..."
              className="text-muted-foreground placeholder:text-muted-foreground/50 min-h-20 w-full resize-y bg-transparent text-sm outline-none"
              autoFocus
            />
          ) : (
            <button
              onClick={handleStartEditingDescription}
              disabled={!canEdit}
              className="text-muted-foreground hover:text-foreground text-left text-sm whitespace-pre-wrap"
            >
              {skillDescription || (
                <span className="text-muted-foreground/50">Add a description...</span>
              )}
            </button>
          )}

          {toolIntegrations.length > 0 ? (
            <div className="pt-2">
              <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-widest uppercase">
                Tool Integrations
              </p>
              <IntegrationBadges integrations={toolIntegrations} size="md" />
            </div>
          ) : null}
        </div>

        {/* File tabs - subtle style, above editor */}
        <div className="border-border/50 mb-3 flex shrink-0 items-center gap-1 overflow-x-auto border-b">
          {/* Text files */}
          {skill.files
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
                onClick={handleFileTabClick}
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
                    onClick={handlePromptDeleteFile}
                    className="hover:bg-muted ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                )}
              </button>
            ))}
          {/* Document tabs */}
          {skill.documents?.map((doc) => {
            const Icon = getDocumentIcon(doc.mimeType);
            return (
              <div
                key={doc.id}
                data-doc-id={doc.id}
                onClick={handleDocumentTabClick}
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
                  onClick={handlePromptDownloadDocument}
                  className="hover:bg-muted ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100"
                  title="Download document"
                >
                  <Download className="h-2.5 w-2.5" />
                </button>
                {canEdit ? (
                  <button
                    data-doc-id={doc.id}
                    data-doc-filename={doc.path ?? doc.filename}
                    onClick={handlePromptDeleteDocument}
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
                <DropdownMenuItem onClick={handleShowAddFile}>
                  <FileText className="h-4 w-4" />
                  Text file
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleTriggerDocumentUpload} disabled={isUploading}>
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
            onChange={handleFileSelect}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.svg"
            className="hidden"
          />

          {/* Mode toggle - far right */}
          {isSkillMd && (
            <div className="ml-auto">
              <MarkdownEditorModeToggle
                mode={skillMarkdownViewMode}
                onModeChange={handleMarkdownViewModeChange}
              />
            </div>
          )}
        </div>

        {/* Add file input */}
        {canEdit && showAddFile && (
          <div className="mb-4 flex shrink-0 items-center gap-2">
            <Input
              placeholder="filename.md"
              value={newFilePath}
              onChange={handleNewFilePathChange}
              className="h-8 flex-1 text-sm"
              autoFocus
              onKeyDown={handleNewFilePathKeyDown}
            />
            <Button size="sm" onClick={handleAddFile} disabled={!newFilePath.trim()}>
              Add
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCancelAddFile}>
              Cancel
            </Button>
          </div>
        )}

        {/* Editor/Content area */}
        <div className="min-h-0 flex-1">
          {selectedFile && !selectedDocumentId && (
            <>
              {isSkillMd && skillMarkdownViewMode === "wysiwyg" ? (
                canEdit ? (
                  <div className="h-full overflow-hidden rounded-lg border">
                    <MilkdownEditor
                      value={skillBody}
                      onChange={handleSkillBodyChange}
                      placeholder="Add your skill instructions here..."
                      className="h-full"
                    />
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto rounded-lg border p-4">
                    <article className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={markdownRemarkPlugins}>
                        {skillBody}
                      </ReactMarkdown>
                    </article>
                  </div>
                )
              ) : isSkillMd && skillMarkdownViewMode === "source" ? (
                <textarea
                  value={skillMarkdownSource}
                  onChange={handleMarkdownSourceChange}
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
                  onChange={handleNonSkillFileContentChange}
                  readOnly={!canEdit}
                  className="bg-background focus:ring-ring h-full w-full resize-none rounded-lg border p-4 font-mono text-sm focus:ring-2 focus:outline-none"
                />
              )}
            </>
          )}
          {selectedDocumentId &&
            (() => {
              const selectedDoc = skill.documents?.find((d) => d.id === selectedDocumentId);
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
                          Preview unavailable in this browser.
                        </p>
                        <Button onClick={handleDownloadSelectedDocument}>
                          <Download className="mr-2 h-4 w-4" />
                          Download
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
                  <Button onClick={handleDownloadSelectedDocument}>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>
              );
            })()}
        </div>

        {/* Delete document confirmation modal */}
        {documentToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background mx-4 w-full max-w-sm rounded-lg border p-6 shadow-lg">
              <h3 className="text-lg font-semibold">Delete document</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                Are you sure you want to delete &quot;{documentToDelete.filename}&quot;? This action
                cannot be undone.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={handleCancelDeleteDocument}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDeleteDocument}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Delete file confirmation modal */}
        {fileToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background mx-4 w-full max-w-sm rounded-lg border p-6 shadow-lg">
              <h3 className="text-lg font-semibold">Delete file</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                Are you sure you want to delete &quot;{fileToDelete.path}
                &quot;? This action cannot be undone.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={handleCancelDeleteFile}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDeleteFile}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
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
