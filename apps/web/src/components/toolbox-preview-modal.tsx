"use client";

import { Maximize2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import {
  CommunitySkillDetailContent,
  COMMUNITY_SKILLS_DATA,
} from "@/components/community-skill-detail-content";
import {
  IntegrationDetailContent,
  type IntegrationDetailProps,
} from "@/components/integration-detail-content";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type PreviewTarget =
  | { kind: "integration"; type: string }
  | { kind: "community"; slug: string }
  | null;

function parsePreviewId(previewId: string | null): PreviewTarget {
  if (!previewId) {
    return null;
  }
  if (previewId.startsWith("integration:")) {
    return { kind: "integration", type: previewId.slice("integration:".length) };
  }
  if (previewId.startsWith("community:")) {
    return { kind: "community", slug: previewId.slice("community:".length) };
  }
  return null;
}

function getPreviewTitle(target: PreviewTarget): string {
  if (!target) {
    return "";
  }
  if (target.kind === "community") {
    return COMMUNITY_SKILLS_DATA[target.slug]?.title ?? target.slug;
  }
  return target.type;
}

function getMaximizeHref(target: PreviewTarget): string | null {
  if (!target) {
    return null;
  }
  if (target.kind === "community") {
    return `/skills/community/${target.slug}`;
  }
  if (target.kind === "integration") {
    return `/integrations/${target.type}`;
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ToolboxPreviewModal({
  previewId,
  integrationProps,
  communitySkillProps,
}: {
  previewId: string | null;
  integrationProps?: Omit<
    IntegrationDetailProps,
    "type" | "config" | "integration" | "isWhatsApp" | "connectError" | "showGoogleRequest"
  > & {
    getIntegrationConfig: (
      type: string,
    ) => { name: string; description: string; icon: string } | undefined;
    getIntegration: (type: string) => IntegrationDetailProps["integration"];
    getIntegrations?: (type: string) => NonNullable<IntegrationDetailProps["integrations"]>;
    getConnectError: (type: string) => string | undefined;
    isWhatsApp: (type: string) => boolean;
    showGoogleRequest: (type: string) => boolean;
  };
  communitySkillProps?: {
    getEnabled: (slug: string) => boolean;
    onToggle: (slug: string, value: boolean) => void;
  };
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  const target = parsePreviewId(previewId);

  const close = useCallback(() => {
    router.push("/toolbox", { scroll: false });
  }, [router]);

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
    if (previewId && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [previewId]);

  const handleCommunitySkillToggle = useCallback(
    (value: boolean) => {
      if (!communitySkillProps || target?.kind !== "community") {
        return;
      }

      communitySkillProps.onToggle(target.slug, value);
    },
    [communitySkillProps, target],
  );

  if (!target) {
    return null;
  }

  const title = getPreviewTitle(target);
  const maximizeHref = getMaximizeHref(target);

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
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Preview details before opening the full page.
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1">
            {maximizeHref && (
              <Button
                asChild
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
              >
                <Link href={maximizeHref} aria-label="Open full page">
                  <Maximize2 className="size-4" />
                </Link>
              </Button>
            )}
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
          {target.kind === "community" && COMMUNITY_SKILLS_DATA[target.slug] && (
            <CommunitySkillDetailContent
              skill={COMMUNITY_SKILLS_DATA[target.slug]}
              enabled={communitySkillProps?.getEnabled(target.slug)}
              onToggle={communitySkillProps ? handleCommunitySkillToggle : undefined}
            />
          )}
          {target.kind === "integration" &&
            integrationProps &&
            (() => {
              const config = integrationProps.getIntegrationConfig(target.type);
              if (!config) {
                return null;
              }
              return (
                <IntegrationDetailContent
                  type={target.type}
                  config={config}
                  integration={integrationProps.getIntegration(target.type)}
                  integrations={integrationProps.getIntegrations?.(target.type)}
                  isWhatsApp={integrationProps.isWhatsApp(target.type)}
                  connectError={integrationProps.getConnectError(target.type)}
                  showGoogleRequest={integrationProps.showGoogleRequest(target.type)}
                  isConnecting={integrationProps.isConnecting}
                  onConnect={integrationProps.onConnect}
                  onConnectAnother={integrationProps.onConnectAnother}
                  onToggle={integrationProps.onToggle}
                  onToggleAccount={integrationProps.onToggleAccount}
                  onDisconnect={integrationProps.onDisconnect}
                  onDisconnectAccount={integrationProps.onDisconnectAccount}
                  onRequestGoogleAccess={integrationProps.onRequestGoogleAccess}
                  onRenameAccountLabel={integrationProps.onRenameAccountLabel}
                />
              );
            })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
