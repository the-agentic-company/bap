"use client";

import type { TemplateCatalogTemplate } from "@cmdclaw/db/template-catalog";
import { Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { AppLink } from "@/components/app-link";
import { useRouter } from "@/components/next-navigation-compat";
import { TemplateDetailContent } from "@/components/template-detail-content";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export function TemplatePreviewModal({
  template,
  closeHref = "/templates",
}: {
  template: TemplateCatalogTemplate | null;
  closeHref?: string;
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    router.push(closeHref);
  }, [closeHref, router]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        close();
      }
    },
    [close],
  );

  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
  }, []);

  useEffect(() => {
    if (template && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [template]);

  if (!template) {
    return null;
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={handleOpenAutoFocus}
        className="border-border/60 bg-background top-1/2 flex h-[min(92dvh,960px)] w-[min(96vw,1400px)] max-w-none -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-2xl border p-0 shadow-2xl sm:w-[min(92vw,1400px)]"
      >
        <div className="border-border/40 bg-muted/30 flex shrink-0 items-center justify-between border-b px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="bg-muted size-2.5 rounded-full" />
            <DialogTitle className="text-muted-foreground max-w-[400px] truncate text-xs font-medium">
              {template.title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Preview the full template details before opening the standalone template page.
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button
              asChild
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <AppLink href={`/template/${template.id}`} aria-label="Open full page">
                <Maximize2 className="size-4" />
              </AppLink>
            </Button>
            <DialogClose asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground hover:bg-muted -mr-1.5 flex size-7 items-center justify-center rounded-lg transition-colors"
                aria-label="Close preview"
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overscroll-contain px-6 pt-8 pb-16 md:px-8 md:pt-10"
        >
          <TemplateDetailContent template={template} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
