import { createFileRoute, useRouter } from "@tanstack/react-router";
import { T } from "gt-react";
import { ArrowLeft } from "lucide-react";
import { useCallback } from "react";
import { BugReportForm } from "@/components/bug-report-form";

export const Route = createFileRoute("/_public/bug-report")({
  head: () => ({
    meta: [
      { title: "Bug report · Bap" },
      { name: "description", content: "Send a message to the Bap team." },
    ],
  }),
  component: BugReportPage,
});

function BugReportPage() {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.history.back();
  }, [router]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-4 pt-6 pb-8">
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="text-muted-foreground hover:text-foreground -ml-1 rounded-full p-1 transition-colors"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold">
            <T>Bug report</T>
          </h1>
          <p className="text-muted-foreground text-sm">
            <T>Send a message to the Bap team.</T>
          </p>
        </div>
      </div>
      <BugReportForm onSuccess={handleBack} />
    </div>
  );
}
