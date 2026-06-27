import { T, useGT } from "gt-react";
import { Check, Globe2, Link2, Lock, Share2, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useConversation,
  useShareConversation,
  useUnshareConversation,
} from "@/orpc/hooks/conversation";

type ConversationShape = {
  isShared?: boolean;
  shareToken?: string | null;
};

type Props = {
  conversationId?: string;
  triggerVariant?: "icon" | "button";
  outputLabel?: boolean;
  className?: string;
};

function getShareUrl(token: string): string {
  if (typeof window === "undefined") {
    return `/shared/${token}`;
  }
  return `${window.location.origin}/shared/${token}`;
}

export function ChatShareControls({
  conversationId,
  triggerVariant = "icon",
  outputLabel = false,
  className,
}: Props) {
  const t = useGT();

  const { data: conversation } = useConversation(conversationId);
  const shareConversation = useShareConversation();
  const unshareConversation = useUnshareConversation();
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const conv = conversation as ConversationShape | undefined;
  const isShared = conv?.isShared === true && !!conv?.shareToken;

  const shareUrl = useMemo(() => {
    if (!conv?.shareToken) {
      return null;
    }
    return getShareUrl(conv.shareToken);
  }, [conv?.shareToken]);

  const handleShare = useCallback(async () => {
    if (!conversationId) {
      return;
    }
    const result = await shareConversation.mutateAsync(conversationId);
    if (result.shareToken) {
      await navigator.clipboard.writeText(getShareUrl(result.shareToken));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }, [conversationId, shareConversation]);

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) {
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [shareUrl]);

  const handleUnshare = useCallback(async () => {
    if (!conversationId) {
      return;
    }
    await unshareConversation.mutateAsync(conversationId);
    setIsOpen(false);
  }, [conversationId, unshareConversation]);

  if (!conversationId) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {triggerVariant === "button" ? (
          outputLabel ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className={cn("h-11 rounded-2xl px-5 text-sm font-semibold", className)}
              aria-label={t("Share output")}
            >
              <Share2 className="h-4 w-4" />
              <T>Share output</T>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className={cn("h-11 rounded-2xl px-5 text-sm font-semibold", className)}
              aria-label={t("Share conversation")}
            >
              <Share2 className="h-4 w-4" />
              <T>Share conversation</T>
            </Button>
          )
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              "text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors",
              className,
            )}
            title={t("Share")}
            aria-label={t("Share conversation")}
          >
            <Share2 className="h-4 w-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] rounded-2xl p-0">
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">
                <T>Share conversation</T>
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                <T>Anyone with the link can view this chat.</T>
              </p>
            </div>
            <div
              className={
                isShared
                  ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700"
                  : "text-muted-foreground inline-flex items-center gap-1.5 rounded-full bg-neutral-500/10 px-2 py-1 text-xs font-medium"
              }
            >
              {isShared ? <Globe2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {isShared ? "Public" : "Private"}
            </div>
          </div>

          {isShared && shareUrl ? (
            <div className="space-y-2">
              <label className="text-muted-foreground text-xs">
                <T>Shared link</T>
              </label>
              <div className="bg-muted/40 border-border/70 flex items-center gap-2 rounded-xl border p-1.5 pl-3">
                <div className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                  {shareUrl}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="rounded-lg"
                  onClick={handleCopyLink}
                  disabled={unshareConversation.isPending}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            {isShared ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={handleUnshare}
                disabled={unshareConversation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {unshareConversation.isPending ? "Unsharing..." : "Unshare"}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={handleShare}
                disabled={shareConversation.isPending}
              >
                <Share2 className="h-3.5 w-3.5" />
                {shareConversation.isPending ? "Creating link..." : "Create public link"}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
