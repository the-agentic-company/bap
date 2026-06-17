import { createFileRoute } from "@tanstack/react-router";
import { T } from "gt-react";

export const Route = createFileRoute("/_public/upload")({
  head: () => ({
    meta: [{ title: "Upload · Bap" }, { name: "description", content: "Upload tools." }],
  }),
  component: UploadPage,
});

function UploadPage() {
  return (
    <div className="bg-card flex flex-1 flex-col gap-3 rounded-xl border p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">
        <T>Upload</T>
      </h1>
      <p className="text-muted-foreground text-sm">
        <T>Upload tools will live here. It is empty for now.</T>
      </p>
    </div>
  );
}
