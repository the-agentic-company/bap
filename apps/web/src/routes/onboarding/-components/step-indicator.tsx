"use client";

import { cn } from "@/lib/utils";

export function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-8 flex justify-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-1.5 w-8 rounded-full transition-colors",
            i + 1 <= current ? "bg-primary" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}
