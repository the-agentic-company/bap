"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useState } from "react";
import { AppImage } from "@/components/app-image";

export function MermaidDiagram({
  imageUrl,
  source: _source,
}: {
  imageUrl: string;
  source: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const handleToggle = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  return (
    <div className="mx-auto max-w-xl">
      <div className="border-border/40 bg-muted/30 overflow-hidden rounded-xl border">
        {/* Diagram area */}
        <div className="relative">
          <div
            className={`flex justify-center px-6 pt-5 transition-all duration-300 ease-in-out ${
              expanded ? "max-h-[800px] pb-2" : "max-h-[220px] pb-0"
            } overflow-hidden`}
          >
            <AppImage
              src={imageUrl}
              alt="Coworker diagram"
              width={460}
              height={400}
              className="h-auto w-auto max-w-full object-contain"
            />
          </div>

          {/* Fade overlay when collapsed */}
          {!expanded && (
            <div className="from-muted/0 via-muted/60 to-muted/90 pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b" />
          )}
        </div>

        {/* Toggle button */}
        <button
          type="button"
          onClick={handleToggle}
          className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3.5" />
              Collapse diagram
            </>
          ) : (
            <>
              <ChevronDown className="size-3.5" />
              Show full diagram
            </>
          )}
        </button>
      </div>
    </div>
  );
}
