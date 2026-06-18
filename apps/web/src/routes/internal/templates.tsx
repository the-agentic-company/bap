import type { TemplateCatalogTemplate, TemplateIntegrationType } from "@bap/db/template-catalog";
import type { ChangeEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Loader2, Star, Trash2, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { INTEGRATION_DISPLAY_NAMES, INTEGRATION_LOGOS } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import {
  useAdminDeleteTemplateCatalogEntry,
  useAdminExportTemplateCatalog,
  useAdminImportTemplateCatalog,
  useAdminSetTemplateCatalogFeatured,
  useAdminTemplateCatalogList,
} from "@/orpc/hooks/admin";
import { AppImage } from "./-lib/app-image";

export const Route = createFileRoute("/internal/templates")({
  head: () => ({ meta: [{ title: "Template Catalog - Bap" }] }),
  component: AdminTemplatesPage,
});

const TEMPLATE_INTEGRATION_DISPLAY_NAMES: Record<TemplateIntegrationType, string> = {
  ...INTEGRATION_DISPLAY_NAMES,
  linear: "Linear",
};

const TEMPLATE_INTEGRATION_LOGOS: Record<TemplateIntegrationType, string> = {
  ...INTEGRATION_LOGOS,
  linear: "/integrations/linear.svg",
};

function downloadTemplateCatalog(filename: string, json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function getTriggerLabel(triggerType: string) {
  const map: Record<string, string> = {
    manual: "Manual",
    schedule: "Scheduled",
    email: "Email",
    webhook: "Webhook",
  };
  return map[triggerType] ?? triggerType;
}

function TemplateRow({
  template,
  isDeleting,
  isUpdatingFeatured,
  onDelete,
  onFeaturedChange,
}: {
  template: TemplateCatalogTemplate;
  isDeleting: boolean;
  isUpdatingFeatured: boolean;
  onDelete: (id: string) => void;
  onFeaturedChange: (id: string, featured: boolean) => void;
}) {
  const handleFeaturedChange = useCallback(
    (checked: boolean) => {
      onFeaturedChange(template.id, checked);
    },
    [onFeaturedChange, template.id],
  );

  const handleDelete = useCallback(() => {
    onDelete(template.id);
  }, [onDelete, template.id]);

  return (
    <div className="border-border/60 bg-muted/20 flex h-full flex-col rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{template.title}</h3>
        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          {getTriggerLabel(template.triggerType)}
        </span>
        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          {template.industry}
        </span>
        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          {template.useCase}
        </span>
      </div>
      <p className="text-muted-foreground mt-2 line-clamp-2 text-sm leading-relaxed">
        {template.description}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {template.integrations.map((integration) => (
          <span
            key={integration}
            className="border-border/50 bg-background inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
          >
            <AppImage
              src={TEMPLATE_INTEGRATION_LOGOS[integration]}
              alt={TEMPLATE_INTEGRATION_DISPLAY_NAMES[integration]}
              width={14}
              height={14}
              className="size-3.5"
            />
            {TEMPLATE_INTEGRATION_DISPLAY_NAMES[integration]}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Star
              className={cn(
                "size-4",
                template.featured ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
              )}
            />
            <span className="text-sm">Featured</span>
          </div>
          <Switch
            checked={template.featured}
            onCheckedChange={handleFeaturedChange}
            disabled={isUpdatingFeatured || isDeleting}
            aria-label={`Toggle featured for ${template.title}`}
          />
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={handleDelete}
          disabled={isDeleting || isUpdatingFeatured}
        >
          {isDeleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
          Delete
        </Button>
      </div>
    </div>
  );
}

function AdminTemplatesPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data, isLoading, error } = useAdminTemplateCatalogList();
  const exportCatalog = useAdminExportTemplateCatalog();
  const importCatalog = useAdminImportTemplateCatalog();
  const deleteTemplate = useAdminDeleteTemplateCatalogEntry();
  const setFeatured = useAdminSetTemplateCatalogFeatured();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [updatingFeaturedId, setUpdatingFeaturedId] = useState<string | null>(null);

  const templates = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const featuredCount = templates.filter((template) => template.featured).length;

  const handleExport = useCallback(async () => {
    setActionError(null);
    setActionMessage(null);

    try {
      const catalog = await exportCatalog.mutateAsync();
      downloadTemplateCatalog("template-catalog.json", JSON.stringify(catalog, null, 2));
      setActionMessage(`Exported ${catalog.templates.length} templates.`);
    } catch (err) {
      setActionError(toErrorMessage(err, "Failed to export templates."));
    }
  }, [exportCatalog]);

  const handleImportClick = useCallback(() => {
    if (!importCatalog.isPending) {
      fileInputRef.current?.click();
    }
  }, [importCatalog.isPending]);

  const handleImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }
      if (!file.name.toLowerCase().endsWith(".json")) {
        setActionError("Select a .json template catalog export.");
        setActionMessage(null);
        return;
      }

      setActionError(null);
      setActionMessage(null);

      try {
        const definitionJson = await file.text();
        const result = await importCatalog.mutateAsync({ definitionJson });
        setActionMessage(
          `Imported ${result.importedCount} templates (${result.createdCount} created, ${result.updatedCount} updated).`,
        );
      } catch (err) {
        setActionError(toErrorMessage(err, "Failed to import templates."));
      }
    },
    [importCatalog],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingTemplateId(id);
      setActionError(null);
      setActionMessage(null);

      try {
        await deleteTemplate.mutateAsync({ id });
        setActionMessage("Template deleted.");
      } catch (err) {
        setActionError(toErrorMessage(err, "Failed to delete template."));
      } finally {
        setDeletingTemplateId(null);
      }
    },
    [deleteTemplate],
  );

  const handleFeaturedChange = useCallback(
    async (id: string, featured: boolean) => {
      setUpdatingFeaturedId(id);
      setActionError(null);
      setActionMessage(null);

      try {
        await setFeatured.mutateAsync({ id, featured });
        setActionMessage(
          featured ? "Template marked as featured." : "Template removed from featured.",
        );
      } catch (err) {
        setActionError(toErrorMessage(err, "Failed to update featured state."));
      } finally {
        setUpdatingFeaturedId(null);
      }
    },
    [setFeatured],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Template Catalog</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage the global template library with bulk JSON import/export, featured flags, and
            deletes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Import template catalog JSON file"
            onChange={handleImportChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleImportClick}
            disabled={importCatalog.isPending}
          >
            {importCatalog.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            Import JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={handleExport}
            disabled={exportCatalog.isPending}
          >
            {exportCatalog.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Export JSON
          </Button>
        </div>
      </div>

      {actionError || actionMessage ? (
        <div
          className={cn(
            "rounded-lg border p-3 text-sm",
            actionError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
          )}
        >
          {actionError ?? actionMessage}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
          {templates.length} templates
        </span>
        <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
          {featuredCount} featured
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
          Failed to load templates.
        </div>
      ) : templates.length === 0 ? (
        <div className="border-border/60 bg-muted/20 rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-medium">No templates in the catalog.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Import a versioned JSON file to populate the library.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              isDeleting={deletingTemplateId === template.id}
              isUpdatingFeatured={updatingFeaturedId === template.id}
              onDelete={handleDelete}
              onFeaturedChange={handleFeaturedChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
