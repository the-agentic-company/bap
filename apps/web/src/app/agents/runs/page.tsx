"use client";

export default function CoworkerRunsIndexPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 items-center border-b px-3 sm:px-4">
        <span className="text-sm font-medium">Coworker runs</span>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
          <h2 className="text-lg font-semibold">Select a coworker run</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Open a run from the recent runs list or a coworker page to view it here.
          </p>
        </div>
      </div>
    </div>
  );
}
