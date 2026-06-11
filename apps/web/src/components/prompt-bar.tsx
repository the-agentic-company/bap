// oxlint-disable jsx-a11y/control-has-associated-label

import { T, useGT } from "gt-react";
import { ArrowUp, Loader2, Mic, Paperclip, Plus, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PromptSegment } from "@/lib/prompt-segments";
import { AppImage } from "@/components/app-image";
import { getChatDraftKey, useChatDraftStore } from "@/components/chat/chat-draft-store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AttachmentData = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

type PromptBarProps = {
  onSubmit: (
    text: string,
    attachments?: AttachmentData[],
  ) => void | boolean | Promise<void | boolean>;
  onStop?: () => void;
  isSubmitting?: boolean;
  isStreaming?: boolean;
  disabled?: boolean;

  variant?: "hero" | "default";

  placeholder?: string;
  animatedPlaceholders?: string[];
  richAnimatedPlaceholders?: PromptSegment[][];
  onAnimatedPlaceholderIndexChange?: (index: number) => void;
  shouldAnimatePlaceholder?: boolean;
  submitOnEnter?: boolean;

  isRecording?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  voiceInteractionMode?: "press-to-talk" | "toggle";

  conversationId?: string;
  prefillRequest?: { id: string; text: string; mode?: "replace" | "append" } | null;

  renderSkills?: React.ReactNode;
  renderModelSelector?: React.ReactNode;
  renderAutoApproval?: React.ReactNode;
  renderDebugControls?: React.ReactNode;

  className?: string;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;
const HERO_PROMPT_MIN_HEIGHT_CLASS = "min-h-[4.6rem]";
const DEFAULT_PROMPT_MIN_HEIGHT_CLASS = "min-h-[2.8rem]";
const PROMPT_MAX_HEIGHT_CLASS = "max-h-[min(40dvh,18rem)]";
// ─── Rich Placeholder Overlay ───────────────────────────────────────────────

function totalSegmentLength(segments: PromptSegment[]): number {
  return segments.reduce(
    (acc, seg) => acc + (seg.type === "text" ? seg.content.length : seg.name.length),
    0,
  );
}

function RichPlaceholderOverlay({
  segments,
  charPos,
}: {
  segments: PromptSegment[];
  charPos: number;
}) {
  let consumed = 0;
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segLen = seg.type === "text" ? seg.content.length : seg.name.length;

    if (consumed >= charPos) {
      break;
    }

    const charsAvailable = Math.min(segLen, charPos - consumed);
    consumed += segLen;

    if (seg.type === "text") {
      elements.push(<span key={i}>{seg.content.slice(0, charsAvailable)}</span>);
    } else {
      const fullyTyped = charsAvailable >= seg.name.length;
      if (fullyTyped) {
        elements.push(
          <span
            key={i}
            className="mx-0.5 inline-flex animate-[badge-in_150ms_ease-out] items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 align-middle text-xs font-medium text-slate-600"
          >
            {/* oxlint-disable-next-line nextjs/no-img-element */}
            <img src={seg.icon} alt="" className="size-3.5 shrink-0 rounded-sm object-contain" />
            {seg.name}
          </span>,
        );
      } else {
        elements.push(<span key={i}>{seg.name.slice(0, charsAvailable)}</span>);
      }
    }
  }

  return <span className="inline">{elements}</span>;
}

// ─── File helpers ───────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string), { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsDataURL(file);
  });
}

// ─── PromptBar ──────────────────────────────────────────────────────────────

export function PromptBar({
  onSubmit,
  onStop,
  isSubmitting = false,
  isStreaming = false,
  disabled = false,
  variant = "default",
  placeholder,
  animatedPlaceholders,
  richAnimatedPlaceholders,
  onAnimatedPlaceholderIndexChange,
  shouldAnimatePlaceholder = false,
  submitOnEnter = false,
  isRecording = false,
  onStartRecording,
  onStopRecording,
  voiceInteractionMode = "press-to-talk",
  conversationId,
  prefillRequest,
  renderSkills,
  renderModelSelector,
  renderAutoApproval,
  renderDebugControls,
  className,
}: PromptBarProps) {
  const t = useGT();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<AttachmentData[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [attachPopoverOpen, setAttachPopoverOpen] = useState(false);

  // ── Draft persistence ──
  const draftKey = getChatDraftKey(conversationId);
  const readDraft = useChatDraftStore((s) => s.readDraft);
  const upsertDraft = useChatDraftStore((s) => s.upsertDraft);
  const isDraftHydrated = useChatDraftStore((s) => s.hasHydrated);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isDraftHydrated || variant === "hero") {
      return;
    }
    const draft = readDraft(draftKey);
    setText(draft?.text ?? "");
    setAttachments([]);
    setLoadedDraftKey(draftKey);
  }, [draftKey, isDraftHydrated, readDraft, variant]);

  useEffect(() => {
    if (!isDraftHydrated || variant === "hero" || loadedDraftKey !== draftKey) {
      return;
    }
    upsertDraft(draftKey, text);
  }, [draftKey, isDraftHydrated, loadedDraftKey, upsertDraft, text, variant]);

  // ── Prefill ──
  useEffect(() => {
    if (!prefillRequest) {
      return;
    }
    setText((prev) => {
      const next =
        prefillRequest.mode === "append"
          ? `${prev}${prev && !/\s$/.test(prev) ? " " : ""}${prefillRequest.text}`
          : prefillRequest.text;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(next.length, next.length);
      });
      return next;
    });
  }, [prefillRequest]);

  // ── Plain placeholder animation ──
  const [placeholderText, setPlaceholderText] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isDeletingPlaceholder, setIsDeletingPlaceholder] = useState(false);

  // ── Rich placeholder animation ──
  const [richCharPos, setRichCharPos] = useState(0);
  const [richIndex, setRichIndex] = useState(0);
  const [isRichDeleting, setIsRichDeleting] = useState(false);

  const useRichMode = Boolean(richAnimatedPlaceholders?.length);
  const resolvedPlaceholder = placeholder ?? "Describe what you want to automate...";
  const placeholderPool = useMemo(
    () => (animatedPlaceholders?.length ? animatedPlaceholders : [resolvedPlaceholder]),
    [animatedPlaceholders, resolvedPlaceholder],
  );

  const shouldAnimate = (variant === "hero" || shouldAnimatePlaceholder) && text.length === 0;
  const shouldAnimatePlain = shouldAnimate && !useRichMode && placeholderPool.length > 1;
  const shouldAnimateRich = shouldAnimate && useRichMode;

  // Sync index to parent
  useEffect(() => {
    if (!shouldAnimate || !onAnimatedPlaceholderIndexChange) {
      return;
    }
    onAnimatedPlaceholderIndexChange(useRichMode ? richIndex : placeholderIndex);
  }, [onAnimatedPlaceholderIndexChange, placeholderIndex, richIndex, shouldAnimate, useRichMode]);

  // Plain typing animation
  useEffect(() => {
    if (!shouldAnimatePlain) {
      setPlaceholderText("");
      setPlaceholderIndex(0);
      setIsDeletingPlaceholder(false);
      return;
    }
    const currentPhrase = placeholderPool[placeholderIndex % placeholderPool.length];
    const isFullyTyped = placeholderText === currentPhrase;
    const isCleared = placeholderText.length === 0;
    const delay = isDeletingPlaceholder ? 35 : 50;

    let tid: ReturnType<typeof setTimeout>;
    if (!isDeletingPlaceholder && isFullyTyped) {
      tid = setTimeout(() => setIsDeletingPlaceholder(true), 1450);
    } else if (isDeletingPlaceholder && isCleared) {
      tid = setTimeout(() => {
        setIsDeletingPlaceholder(false);
        setPlaceholderIndex((p) => (p + 1) % placeholderPool.length);
      }, 250);
    } else {
      tid = setTimeout(() => {
        setPlaceholderText(
          isDeletingPlaceholder
            ? currentPhrase.slice(0, Math.max(0, placeholderText.length - 1))
            : currentPhrase.slice(0, placeholderText.length + 1),
        );
      }, delay);
    }
    return () => clearTimeout(tid);
  }, [
    isDeletingPlaceholder,
    placeholderIndex,
    placeholderPool,
    placeholderText,
    shouldAnimatePlain,
  ]);

  // Rich typing animation
  useEffect(() => {
    if (!shouldAnimateRich || !richAnimatedPlaceholders?.length) {
      setRichCharPos(0);
      setRichIndex(0);
      setIsRichDeleting(false);
      return;
    }
    const segs = richAnimatedPlaceholders[richIndex % richAnimatedPlaceholders.length];
    const total = totalSegmentLength(segs);
    const isFullyTyped = richCharPos >= total;
    const isCleared = richCharPos <= 0;

    let tid: ReturnType<typeof setTimeout>;
    if (!isRichDeleting && isFullyTyped) {
      tid = setTimeout(() => setIsRichDeleting(true), 1800);
    } else if (isRichDeleting && isCleared) {
      tid = setTimeout(() => {
        setIsRichDeleting(false);
        setRichIndex((p) => (p + 1) % richAnimatedPlaceholders.length);
      }, 250);
    } else {
      const delay = isRichDeleting ? 20 : 40;
      tid = setTimeout(() => setRichCharPos((p) => p + (isRichDeleting ? -1 : 1)), delay);
    }
    return () => clearTimeout(tid);
  }, [shouldAnimateRich, richAnimatedPlaceholders, richIndex, richCharPos, isRichDeleting]);

  useEffect(() => {
    setRichCharPos(0);
  }, [richIndex]);

  const activePlaceholder = shouldAnimatePlain
    ? placeholderText || placeholderPool[placeholderIndex] || resolvedPlaceholder
    : resolvedPlaceholder;

  const currentRichSegments =
    richAnimatedPlaceholders?.[richIndex % (richAnimatedPlaceholders?.length || 1)];
  const richPlaceholderMeasureCharPos = currentRichSegments
    ? totalSegmentLength(currentRichSegments)
    : 0;

  // ── File handling ──
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const slots = Math.max(0, MAX_FILES - attachments.length);
      const toRead = Array.from(files)
        .slice(0, slots)
        .filter((f) => f.size <= MAX_FILE_SIZE);
      const added = await Promise.all(
        toRead.map(async (f) => ({
          name: f.name,
          mimeType: f.type,
          dataUrl: await readFileAsDataUrl(f),
        })),
      );
      if (added.length) {
        setAttachments((prev) => [...prev, ...added]);
      }
    },
    [attachments.length],
  );

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);
  const handleRemoveAttachmentClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const attachmentUrl = event.currentTarget.dataset.attachmentUrl;
      if (!attachmentUrl) {
        return;
      }
      const index = attachments.findIndex((attachment) => attachment.dataUrl === attachmentUrl);
      if (index >= 0) {
        removeAttachment(index);
      }
    },
    [attachments, removeAttachment],
  );

  const handleOpenFilePicker = useCallback(() => {
    setAttachPopoverOpen(false);
    requestAnimationFrame(() => fileInputRef.current?.click());
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        void addFiles(e.target.files);
      }
      e.target.value = "";
    },
    [addFiles],
  );

  // ── Drag & drop ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        void addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  // ── Submit ──
  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || disabled || isSubmitting) {
      return;
    }
    try {
      const result = await onSubmit(trimmed, attachments.length > 0 ? attachments : undefined);
      if (result === false) {
        return;
      }
    } catch (error) {
      console.error("Prompt submit failed:", error);
      return;
    }
    setAttachments([]);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, attachments, disabled, isSubmitting, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const shouldSubmit =
        e.key === "Enter" &&
        ((submitOnEnter && !e.shiftKey && !e.metaKey && !e.ctrlKey) || e.metaKey || e.ctrlKey);
      if (shouldSubmit) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit, submitOnEnter],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  }, []);

  const handleSendClick = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  // ── Voice ──
  const handleRecordMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!disabled && !isStreaming) {
        onStartRecording?.();
      }
    },
    [disabled, isStreaming, onStartRecording],
  );
  const handleRecordMouseUp = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isRecording) {
        onStopRecording?.();
      }
    },
    [isRecording, onStopRecording],
  );
  const handleRecordMouseLeave = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isRecording) {
        onStopRecording?.();
      }
    },
    [isRecording, onStopRecording],
  );
  const handleRecordTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (!disabled && !isStreaming) {
        onStartRecording?.();
      }
    },
    [disabled, isStreaming, onStartRecording],
  );
  const handleRecordTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (isRecording) {
        onStopRecording?.();
      }
    },
    [isRecording, onStopRecording],
  );
  const handleRecordToggle = useCallback(() => {
    if (disabled && !isRecording) {
      return;
    }

    if (isRecording) {
      onStopRecording?.();
      return;
    }

    if (!isStreaming) {
      onStartRecording?.();
    }
  }, [disabled, isRecording, isStreaming, onStartRecording, onStopRecording]);

  // ── Derived ──
  const isHero = variant === "hero";
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !isSubmitting;
  const showVoice = Boolean(onStartRecording && onStopRecording);
  const isToggleVoice = voiceInteractionMode === "toggle";

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "overflow-hidden rounded-2xl transition-all duration-200",
          isHero
            ? "border border-white/25 bg-white/88 shadow-[0_15px_45px_-22px_rgba(15,23,42,0.9)]"
            : "border border-border/60 bg-stone-50/80 shadow-sm",
          isDragging && "ring-2 ring-primary/30",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attachments.map((a) => (
              <div
                key={a.dataUrl}
                className="group border-border/50 relative flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs shadow-sm"
              >
                {a.mimeType.startsWith("image/") ? (
                  <AppImage
                    src={a.dataUrl}
                    alt={a.name}
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded object-cover"
                  />
                ) : (
                  <Paperclip className="text-muted-foreground h-3.5 w-3.5" />
                )}
                <span className="text-foreground/80 max-w-[100px] truncate">{a.name}</span>
                <button
                  type="button"
                  data-attachment-url={a.dataUrl}
                  onClick={handleRemoveAttachmentClick}
                  className="hover:bg-muted ml-0.5 rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea area */}
        <div className="relative px-5 pt-4 pb-2">
          {/* Hidden measurer: keeps layout stable across placeholder and typed states */}
          <div
            className={cn(
              "pointer-events-none invisible overflow-hidden whitespace-pre-wrap break-words text-[15px] leading-relaxed",
              PROMPT_MAX_HEIGHT_CLASS,
              isHero ? HERO_PROMPT_MIN_HEIGHT_CLASS : DEFAULT_PROMPT_MIN_HEIGHT_CLASS,
            )}
            aria-hidden
          >
            {text.length > 0 ? (
              <span>{text.endsWith("\n") ? `${text} ` : text}</span>
            ) : shouldAnimateRich && currentRichSegments ? (
              <RichPlaceholderOverlay
                segments={currentRichSegments}
                charPos={richPlaceholderMeasureCharPos}
              />
            ) : (
              <span>{activePlaceholder || " "}</span>
            )}
          </div>
          {/* Visible placeholder overlay */}
          {shouldAnimateRich && currentRichSegments && (
            <div
              className="pointer-events-none absolute inset-0 px-5 pt-4 text-[15px] leading-relaxed text-slate-700/90"
              aria-hidden
            >
              <RichPlaceholderOverlay segments={currentRichSegments} charPos={richCharPos} />
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={shouldAnimateRich ? undefined : activePlaceholder}
            aria-label={isHero ? "Automation prompt" : "Message"}
            aria-keyshortcuts={
              submitOnEnter
                ? "Enter Shift+Enter Meta+Enter Control+Enter"
                : "Meta+Enter Control+Enter"
            }
            data-testid="prompt-input"
            disabled={disabled}
            rows={2}
            className={cn(
              "absolute inset-0 z-10 h-full w-full resize-none overflow-y-auto bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed outline-none overscroll-contain",
              PROMPT_MAX_HEIGHT_CLASS,
              isHero
                ? cn(HERO_PROMPT_MIN_HEIGHT_CLASS, "placeholder:text-slate-500/80 text-slate-950")
                : cn(
                    DEFAULT_PROMPT_MIN_HEIGHT_CLASS,
                    "placeholder:text-muted-foreground/40 text-foreground",
                  ),
            )}
          />
        </div>

        {/* Bottom controls bar */}
        <div
          className={cn(
            "flex items-center gap-1 px-3 pb-3 pt-0",
            isHero ? "text-slate-500" : "text-muted-foreground",
          )}
        >
          {/* Left group: +, skills, model */}
          <div className="flex items-center gap-0.5">
            {/* Attach popover */}
            <Popover open={attachPopoverOpen} onOpenChange={setAttachPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("Add attachment")}
                  title={t("Add attachment")}
                  data-testid="prompt-attach"
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                    isHero
                      ? "hover:bg-slate-200/60 text-slate-500"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground",
                  )}
                  disabled={disabled || attachments.length >= MAX_FILES}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={8}
                className="w-auto min-w-[200px] p-1.5"
              >
                <button
                  type="button"
                  onClick={handleOpenFilePicker}
                  className="hover:bg-muted flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors"
                >
                  <Paperclip className="text-muted-foreground h-4 w-4" />
                  <span>
                    <T>Add files &amp; photos</T>
                  </span>
                </button>
              </PopoverContent>
            </Popover>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />

            {/* Skills slot */}
            {renderSkills}

            {/* Model selector slot */}
            {renderModelSelector}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right group: auto-approval, voice, send */}
          <div className="flex items-center gap-1">
            {renderAutoApproval}
            {renderDebugControls}

            {/* Voice */}
            {showVoice && (
              <button
                type="button"
                aria-label={isRecording ? "Stop voice recording" : "Start voice recording"}
                aria-pressed={isToggleVoice ? isRecording : undefined}
                onClick={isToggleVoice ? handleRecordToggle : undefined}
                onMouseDown={isToggleVoice ? undefined : handleRecordMouseDown}
                onMouseUp={isToggleVoice ? undefined : handleRecordMouseUp}
                onMouseLeave={isToggleVoice ? undefined : handleRecordMouseLeave}
                onTouchStart={isToggleVoice ? undefined : handleRecordTouchStart}
                onTouchEnd={isToggleVoice ? undefined : handleRecordTouchEnd}
                disabled={disabled && !isRecording}
                className={cn(
                  "flex h-8 w-8 touch-none items-center justify-center rounded-lg transition-colors",
                  isRecording
                    ? "bg-red-100 text-red-500 animate-pulse"
                    : isHero
                      ? "hover:bg-slate-200/60 text-slate-500"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}

            {/* Stop button (streaming) */}
            {isStreaming && onStop && (
              <Button
                onClick={onStop}
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-lg border-black bg-black text-white hover:bg-black/90 hover:text-white"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            )}

            {/* Send */}
            <button
              type="button"
              onClick={handleSendClick}
              disabled={!canSend}
              aria-label={isSubmitting ? "Sending message" : "Send message"}
              title={isSubmitting ? "Sending message" : "Send message"}
              data-testid="prompt-send"
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
                canSend
                  ? isHero
                    ? "bg-slate-800 text-white hover:bg-slate-700"
                    : "bg-stone-800 text-white hover:bg-stone-700"
                  : "bg-muted/60 text-muted-foreground/40 cursor-not-allowed",
              )}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
