// oxlint-disable jsx-a11y/control-has-associated-label

import { T, msg, useMessages } from "gt-react";
import { Check, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getIntegrationDisplayName, getIntegrationLogo } from "@/lib/integration-icons";
import type { ToolApprovalData } from "./types";

type EditableField = {
  key: string;
  label: string;
  type: "text" | "textarea";
};

function getEditableFields(integration: string, operation: string): EditableField[] {
  switch (integration) {
    case "slack":
      if (operation === "send") {
        return [
          { key: "channel", label: msg("Channel"), type: "text" },
          { key: "text", label: msg("Message"), type: "textarea" },
        ];
      }
      return [{ key: "text", label: msg("Text"), type: "textarea" }];

    case "google_gmail":
    case "outlook":
      return [
        { key: "to", label: msg("To"), type: "text" },
        { key: "cc", label: msg("Cc"), type: "text" },
        { key: "subject", label: msg("Subject"), type: "text" },
        { key: "body", label: msg("Body"), type: "textarea" },
      ];

    case "github":
      if (operation === "create-issue") {
        return [
          { key: "title", label: msg("Title"), type: "text" },
          { key: "body", label: msg("Body"), type: "textarea" },
          { key: "labels", label: msg("Labels"), type: "text" },
        ];
      }
      return [{ key: "body", label: msg("Body"), type: "textarea" }];

    case "notion":
      return [
        { key: "title", label: msg("Title"), type: "text" },
        { key: "content", label: msg("Content"), type: "textarea" },
      ];

    default: {
      // Generic: show all string fields from toolInput
      return [];
    }
  }
}

type Props = {
  toolApproval: ToolApprovalData;
  onSave: (updated: ToolApprovalData) => void;
  onCancel: () => void;
};

export function InboxEditForm({ toolApproval, onSave, onCancel }: Props) {
  const fields = useMemo(
    () => getEditableFields(toolApproval.integration, toolApproval.operation),
    [toolApproval.integration, toolApproval.operation],
  );

  const inputObjRef = useRef(
    toolApproval.toolInput && typeof toolApproval.toolInput === "object"
      ? (toolApproval.toolInput as Record<string, unknown>)
      : {},
  );
  const inputObj = inputObjRef.current;

  // For generic integrations with no predefined fields, derive from toolInput
  const effectiveFields = useMemo(() => {
    if (fields.length > 0) {
      return fields;
    }
    return Object.entries(inputObj)
      .filter(([, v]) => typeof v === "string")
      .map(
        ([key]): EditableField => ({
          key,
          label: key.charAt(0).toUpperCase() + key.slice(1).replaceAll("_", " "),
          type:
            typeof inputObj[key] === "string" && String(inputObj[key]).length > 80
              ? "textarea"
              : "text",
        }),
      );
  }, [fields, inputObj]);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of effectiveFields) {
      const val = inputObj[field.key];
      initial[field.key] = typeof val === "string" ? val : "";
    }
    return initial;
  });

  const handleFieldChange = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(() => {
    const updatedInput = { ...inputObj };
    for (const field of effectiveFields) {
      if (values[field.key] !== undefined) {
        updatedInput[field.key] = values[field.key];
      }
    }

    // Rebuild a simplified command string
    const parts = [toolApproval.integration.replaceAll("_", "-"), toolApproval.operation];
    for (const field of effectiveFields) {
      const val = values[field.key];
      if (val) {
        parts.push(`--${field.key} "${val.replaceAll('"', '\\"')}"`);
      }
    }

    onSave({
      ...toolApproval,
      toolInput: updatedInput,
      command: parts.join(" "),
    });
  }, [toolApproval, effectiveFields, values, inputObj, onSave]);

  const logo = getIntegrationLogo(toolApproval.integration);
  const displayName = getIntegrationDisplayName(toolApproval.integration);

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5">
      {/* Header */}
      <div className="border-border/30 flex items-center gap-2 border-b px-3 py-2 text-sm">
        {logo && (
          <img
            src={logo}
            alt={displayName}
            width={16}
            height={16}
            loading="lazy"
            decoding="async"
            className="h-4 w-auto"
          />
        )}
        <span className="font-medium">
          <T>Edit</T> {displayName}
        </span>
        <span className="text-muted-foreground">
          <T>action before approving</T>
        </span>
      </div>

      {/* Fields */}
      <div className="space-y-3 px-3 py-3">
        {effectiveFields.map((field) => (
          <EditField
            key={field.key}
            field={field}
            value={values[field.key] ?? ""}
            onChange={handleFieldChange}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="border-border/30 flex justify-end gap-2 border-t px-3 py-2">
        <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" />
          <T>Cancel</T>
        </Button>
        <Button size="sm" className="h-7 text-[12px]" onClick={handleSave}>
          <Check className="mr-1 h-3.5 w-3.5" />
          <T>Save changes</T>
        </Button>
      </div>
    </div>
  );
}

function EditField({
  field,
  value,
  onChange,
}: {
  field: EditableField;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  const m = useMessages();
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(field.key, e.target.value);
    },
    [field.key, onChange],
  );

  // Skip rendering empty optional fields like cc
  if (!value && (field.key === "cc" || field.key === "bcc")) {
    return null;
  }

  return (
    <div className="space-y-1">
      <label className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {m(field.label)}
      </label>
      {field.type === "textarea" ? (
        <textarea
          value={value}
          onChange={handleChange}
          rows={Math.min(8, Math.max(3, value.split("\n").length + 1))}
          className="border-border/50 bg-background text-foreground placeholder:text-muted-foreground/50 focus:border-ring focus:ring-ring/50 w-full resize-y rounded-md border px-3 py-2 text-[13px] transition-colors outline-none focus:ring-1"
        />
      ) : (
        <Input value={value} onChange={handleChange} className="h-8 text-[13px]" />
      )}
    </div>
  );
}
