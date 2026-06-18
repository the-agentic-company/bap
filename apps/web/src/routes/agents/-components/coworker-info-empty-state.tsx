import { T } from "gt-react";
import { Clock, FileCode2, Loader2, Play, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

function EmptyRunStatusCards() {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="border-border/70 rounded-md border px-3 py-2">
        <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <Play className="h-3 w-3" />
          <T>Status</T>
        </div>
        <p className="mt-0.5 text-sm font-medium">
          <T>Ready to run</T>
        </p>
      </div>
      <div className="border-border/70 rounded-md border px-3 py-2">
        <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <Clock className="h-3 w-3" />
          <T>Last run</T>
        </div>
        <p className="mt-0.5 text-sm font-medium">
          <T>No runs yet</T>
        </p>
      </div>
      <div className="border-border/70 rounded-md border px-3 py-2">
        <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <FileCode2 className="h-3 w-3" />
          <T>Output</T>
        </div>
        <p className="mt-0.5 text-sm font-medium">
          <T>Not created yet</T>
        </p>
      </div>
    </div>
  );
}

function EmptyRunNextSteps() {
  return (
    <div className="space-y-1.5">
      <div className="border-border/70 flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
        <p className="shrink-0 text-sm font-medium">
          <T>Configure</T>
        </p>
        <p className="text-muted-foreground max-w-[28rem] text-right text-xs leading-relaxed">
          <T>Review instructions, trigger, and Toolbox before the first Coworker Run.</T>
        </p>
      </div>
      <div className="border-border/70 flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
        <p className="shrink-0 text-sm font-medium">
          <T>Run now</T>
        </p>
        <p className="text-muted-foreground max-w-[28rem] text-right text-xs leading-relaxed">
          <T>Start the first Coworker Run when you are ready.</T>
        </p>
      </div>
      <div className="border-border/70 flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
        <p className="shrink-0 text-sm font-medium">
          <T>History</T>
        </p>
        <p className="text-muted-foreground max-w-[28rem] text-right text-xs leading-relaxed">
          <T>Completed Coworker Runs will appear here after execution.</T>
        </p>
      </div>
    </div>
  );
}

export function CoworkerInfoEmptySummary() {
  return (
    <div className="space-y-5 p-4">
      <EmptyRunStatusCards />
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Wrench className="text-muted-foreground h-4 w-4" />
          <h2 className="text-sm font-medium">
            <T>Before the first run</T>
          </h2>
        </div>
        <EmptyRunNextSteps />
      </section>
    </div>
  );
}

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
