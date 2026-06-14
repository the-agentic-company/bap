import { T } from "gt-react";
import { Button } from "@/components/ui/button";

export function DeleteDocumentDialog({
  filename,
  onCancel,
  onConfirm,
}: {
  filename: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background mx-4 w-full max-w-sm rounded-lg border p-6 shadow-lg">
        <h3 className="text-lg font-semibold">
          <T>Delete document</T>
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          <T>Are you sure you want to delete &quot;</T>
          {filename}
          <T>&quot;? This action cannot be undone.</T>
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            <T>Cancel</T>
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <T>Delete</T>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DeleteFileDialog({
  path,
  onCancel,
  onConfirm,
}: {
  path: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background mx-4 w-full max-w-sm rounded-lg border p-6 shadow-lg">
        <h3 className="text-lg font-semibold">
          <T>Delete file</T>
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          <T>Are you sure you want to delete &quot;</T>
          {path}
          <T>&quot;? This action cannot be undone.</T>
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            <T>Cancel</T>
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            <T>Delete</T>
          </Button>
        </div>
      </div>
    </div>
  );
}
