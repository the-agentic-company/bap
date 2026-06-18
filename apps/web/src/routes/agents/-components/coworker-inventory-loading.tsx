import { T } from "gt-react";
import { Loader2 } from "lucide-react";

export function CoworkerInventoryLoading({ label }: { label: string }) {
  return (
    <div
      className="text-muted-foreground flex min-h-[320px] items-center justify-center gap-2 text-sm"
      aria-label={label}
    >
      <Loader2 className="size-4 animate-spin" />
      <span>
        <T>Loading</T>
      </span>
    </div>
  );
}
