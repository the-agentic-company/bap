import { T } from "gt-react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CoworkerInfoEmptyOutput({
  coworkerDescription,
  onRunNow,
  isRunning,
}: {
  coworkerDescription?: string;
  onRunNow: () => void;
  isRunning: boolean;
}) {
  return (
    <div className="flex h-full min-h-[34rem] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="bg-muted mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Play className="text-muted-foreground h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold">
          <T>Ready for the first Coworker Run</T>
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {coworkerDescription || (
            <T>This Coworker is configured, but it has not produced run output yet.</T>
          )}
        </p>
        <Button
          type="button"
          variant="brand"
          className="mt-5"
          onClick={onRunNow}
          disabled={isRunning}
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          <T>Run now</T>
        </Button>
      </div>
    </div>
  );
}
