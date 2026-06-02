"use client";

import { cn } from "@/lib/utils";

const brickMaskStyle = {
  mask: "url('/tools/brick.svg') center / contain no-repeat",
  WebkitMask: "url('/tools/brick.svg') center / contain no-repeat",
};

export function BrickIcon({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("block bg-current", className)} style={brickMaskStyle} />
  );
}
