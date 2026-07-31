import { T } from "gt-react";
import { LockKeyhole } from "lucide-react";

export function CoworkerInfoPrivateRun() {
  return (
    <section className="bg-card flex min-h-0 flex-1 items-center justify-center rounded-xl border p-6 text-center">
      <div className="max-w-md">
        <span className="bg-muted mx-auto flex size-11 items-center justify-center rounded-full">
          <LockKeyhole className="text-muted-foreground size-5" />
        </span>
        <h2 className="mt-4 text-base font-semibold">
          <T>Run details are private</T>
        </h2>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          <T>
            This Coworker was run by another workspace member. Only that person can view its
            conversation and generated output.
          </T>
        </p>
      </div>
    </section>
  );
}
