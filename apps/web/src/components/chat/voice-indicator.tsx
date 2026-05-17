"use client";

import { Mic, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  isRecording: boolean;
  isProcessing: boolean;
  error?: string | null;
  variant?: "default" | "hero";
  recordingLabel?: string;
};

export function VoiceIndicator({
  isRecording,
  isProcessing,
  error,
  variant = "default",
  recordingLabel = "Recording... Release to send",
}: Props) {
  const isHero = variant === "hero";

  if (error) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
          isHero
            ? "border border-rose-300/20 bg-slate-950/82 text-rose-100 shadow-[0_18px_40px_-22px_rgba(15,23,42,0.95)] backdrop-blur-xl"
            : "bg-destructive/10 text-destructive",
        )}
      >
        <Mic className="h-4 w-4" />
        <span>{error}</span>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
          isHero
            ? "border border-cyan-300/16 bg-slate-950/82 text-slate-100 shadow-[0_18px_40px_-22px_rgba(8,47,73,0.95)] backdrop-blur-xl"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Transcribing...</span>
      </div>
    );
  }

  if (isRecording) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
          isHero
            ? "border border-red-300/20 bg-slate-950/82 text-red-100 shadow-[0_18px_40px_-22px_rgba(127,29,29,0.95)] backdrop-blur-xl"
            : "bg-red-500/10 text-red-500",
        )}
      >
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500"></span>
        </span>
        <span>{recordingLabel}</span>
      </div>
    );
  }

  return null;
}
