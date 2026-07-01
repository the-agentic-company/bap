// oxlint-disable jsx-a11y/control-has-associated-label

import type { ChangeEvent } from "react";
import { T, useGT } from "gt-react";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type WorkspaceMcpServerFormState = {
  kind: "mcp";
  name: string;
  namespace: string;
  endpoint: string;
  specUrl: string;
  transport: string;
  headersText: string;
  queryParamsText: string;
  defaultHeadersText: string;
  authType: "none" | "api_key" | "bearer" | "oauth2";
  authHeaderName: string;
  authQueryParam: string;
  authPrefix: string;
  secret: string;
  displayName: string;
};

export type WorkspaceMcpServerListItem = {
  id: string;
  name: string;
  namespace: string;
  kind: "mcp";
  internalKey?: string | null;
  endpoint: string;
  enabled: boolean;
  connected: boolean;
  credentialEnabled: boolean;
  credentialDisplayName: string | null;
  credentialExpiresAt: Date | string | null;
  specUrl: string | null;
  transport: string | null;
  headers: Record<string, string> | null;
  queryParams: Record<string, string> | null;
  defaultHeaders: Record<string, string> | null;
  authType: "none" | "api_key" | "bearer" | "oauth2";
  authHeaderName: string | null;
  authQueryParam: string | null;
  authPrefix: string | null;
};

export type WorkspaceMcpServerMutationInput = {
  kind: "mcp";
  name: string;
  namespace: string;
  endpoint: string;
  specUrl?: string | null;
  transport?: string | null;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  defaultHeaders?: Record<string, string>;
  authType?: "none" | "api_key" | "bearer" | "oauth2";
  authHeaderName?: string | null;
  authQueryParam?: string | null;
  authPrefix?: string | null;
  enabled?: boolean;
};

type BuildMutationInputOptions = {
  deriveNamespaceFromName?: boolean;
};

// ─── Constants ──────────────────────────────────────────────────────────────────

export const DEFAULT_EXECUTOR_SOURCE_FORM: WorkspaceMcpServerFormState = {
  kind: "mcp",
  name: "",
  namespace: "",
  endpoint: "",
  specUrl: "",
  transport: "streamable-http",
  headersText: "",
  queryParamsText: "",
  defaultHeadersText: "",
  authType: "oauth2",
  authHeaderName: "Authorization",
  authQueryParam: "",
  authPrefix: "Bearer ",
  secret: "",
  displayName: "",
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function parseStringMap(value: string, label: string): Record<string, string> | undefined {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(trimmedValue);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }

  if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
    throw new Error(`${label} must be a JSON object with string values.`);
  }

  const entries = Object.entries(parsedValue);
  if (
    entries.some(([key, entryValue]) => typeof key !== "string" || typeof entryValue !== "string")
  ) {
    throw new Error(`${label} must be a JSON object with string values.`);
  }

  return Object.fromEntries(entries);
}

export function normalizeWorkspaceMcpServerNamespace(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) {
    throw new Error("Namespace must contain letters or numbers.");
  }

  return normalized;
}

export function buildMutationInputFromForm(
  form: WorkspaceMcpServerFormState,
  options: BuildMutationInputOptions = {},
): WorkspaceMcpServerMutationInput {
  const authPrefix = form.authPrefix.trim().length > 0 ? form.authPrefix : null;
  const rawNamespace = form.namespace.trim();
  const rawName = form.name.trim();
  const namespace =
    options.deriveNamespaceFromName && rawNamespace.length === 0 && rawName.length > 0
      ? normalizeWorkspaceMcpServerNamespace(rawName)
      : rawNamespace;

  return {
    kind: form.kind,
    name: rawName,
    namespace,
    endpoint: form.endpoint.trim(),
    specUrl: null,
    transport: form.transport.trim() || null,
    headers: parseStringMap(form.headersText, "Headers"),
    queryParams: parseStringMap(form.queryParamsText, "Query params"),
    defaultHeaders: undefined,
    authType: form.authType,
    authHeaderName:
      form.authType === "none" || form.authType === "oauth2"
        ? null
        : form.authHeaderName.trim() || null,
    authQueryParam: form.authType === "api_key" ? form.authQueryParam.trim() || null : null,
    authPrefix: form.authType === "bearer" ? authPrefix : null,
  };
}

// ─── Components ─────────────────────────────────────────────────────────────────

function JsonMapField({
  id,
  label,
  placeholder,
  value,
  onChange,
  className,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        spellCheck={false}
        className="border-input bg-background mt-2 min-h-28 w-full rounded-md border px-3 py-2 font-mono text-sm outline-none"
      />
    </div>
  );
}

export function WorkspaceMcpServerFields({
  form,
  formIdPrefix,
  onFieldChange,
  disabled = false,
  hideNamespace = false,
  hideMcpTransportFields = false,
  fixedMcpAuthType = null,
}: {
  form: WorkspaceMcpServerFormState;
  formIdPrefix: string;
  onFieldChange: (field: keyof WorkspaceMcpServerFormState, value: string) => void;
  disabled?: boolean;
  hideNamespace?: boolean;
  hideMcpTransportFields?: boolean;
  fixedMcpAuthType?: Extract<WorkspaceMcpServerFormState["authType"], "oauth2"> | null;
}) {
  const t = useGT();

  const handleFieldInputChange = useCallback(
    (field: keyof WorkspaceMcpServerFormState) =>
      (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        onFieldChange(field, event.target.value);
      },
    [onFieldChange],
  );

  const handleKindChange = useCallback(
    (value: string) => {
      if (value === "mcp" && fixedMcpAuthType) {
        onFieldChange("authType", fixedMcpAuthType);
      }
      onFieldChange("kind", "mcp");
    },
    [fixedMcpAuthType, onFieldChange],
  );

  const handleAuthTypeChange = useCallback(
    (value: string) => {
      onFieldChange("authType", value);
    },
    [onFieldChange],
  );

  return (
    <>
      <div className="space-y-2">
        <label htmlFor={`${formIdPrefix}-kind`} className="text-sm font-medium">
          <T>Kind</T>
        </label>
        <Select value={form.kind} onValueChange={handleKindChange}>
          <SelectTrigger id={`${formIdPrefix}-kind`} disabled={disabled}>
            <SelectValue placeholder={t("Select source type")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mcp">
              <T>Remote MCP</T>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label htmlFor={`${formIdPrefix}-auth-type`} className="text-sm font-medium">
          <T>Auth</T>
        </label>
        {form.kind === "mcp" && fixedMcpAuthType ? (
          <Input id={`${formIdPrefix}-auth-type`} value="OAuth 2.0" disabled={true} />
        ) : (
          <Select value={form.authType} onValueChange={handleAuthTypeChange}>
            <SelectTrigger id={`${formIdPrefix}-auth-type`} disabled={disabled}>
              <SelectValue placeholder={t("Select auth")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bearer">
                <T>Bearer token</T>
              </SelectItem>
              <SelectItem value="api_key">
                <T>API key</T>
              </SelectItem>
              {form.kind === "mcp" ? (
                <SelectItem value="oauth2">
                  <T>OAuth 2.0</T>
                </SelectItem>
              ) : null}
              <SelectItem value="none">
                <T>No auth</T>
              </SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor={`${formIdPrefix}-name`} className="text-sm font-medium">
          <T>Name</T>
        </label>
        <Input
          id={`${formIdPrefix}-name`}
          value={form.name}
          onChange={handleFieldInputChange("name")}
          placeholder={t("Display name")}
          disabled={disabled}
        />
      </div>

      {!hideNamespace ? (
        <div className="space-y-2">
          <label htmlFor={`${formIdPrefix}-namespace`} className="text-sm font-medium">
            <T>Namespace</T>
          </label>
          <Input
            id={`${formIdPrefix}-namespace`}
            value={form.namespace}
            onChange={handleFieldInputChange("namespace")}
            placeholder={t("Namespace (for example salesforce-prod)")}
            disabled={disabled}
          />
        </div>
      ) : null}

      <div className="space-y-2 md:col-span-2">
        <label htmlFor={`${formIdPrefix}-endpoint`} className="text-sm font-medium">
          <T>Endpoint</T>
        </label>
        <Input
          id={`${formIdPrefix}-endpoint`}
          value={form.endpoint}
          onChange={handleFieldInputChange("endpoint")}
          placeholder={t("Endpoint URL")}
          disabled={disabled}
        />
      </div>

      {hideMcpTransportFields ? null : (
        <>
          <div className="space-y-2 md:col-span-2">
            <label htmlFor={`${formIdPrefix}-transport`} className="text-sm font-medium">
              <T>Transport</T>
            </label>
            <Input
              id={`${formIdPrefix}-transport`}
              value={form.transport}
              onChange={handleFieldInputChange("transport")}
              placeholder={t("Transport (for example streamable-http)")}
              disabled={disabled}
            />
          </div>
          <JsonMapField
            id={`${formIdPrefix}-headers`}
            label={t("Headers")}
            value={form.headersText}
            onChange={handleFieldInputChange("headersText")}
            placeholder={`{\n  "X-Team": "sales"\n}`}
          />
          <JsonMapField
            id={`${formIdPrefix}-query-params`}
            label={t("Query params")}
            value={form.queryParamsText}
            onChange={handleFieldInputChange("queryParamsText")}
            placeholder={`{\n  "region": "eu"\n}`}
          />
        </>
      )}

      {form.authType !== "none" && form.authType !== "oauth2" ? (
        <>
          <div className="space-y-2">
            <label htmlFor={`${formIdPrefix}-auth-header-name`} className="text-sm font-medium">
              <T>Auth header name</T>
            </label>
            <Input
              id={`${formIdPrefix}-auth-header-name`}
              value={form.authHeaderName}
              onChange={handleFieldInputChange("authHeaderName")}
              placeholder={t("Auth header name")}
              disabled={disabled}
            />
          </div>

          {form.kind === "mcp" && form.authType === "api_key" ? (
            <div className="space-y-2">
              <label htmlFor={`${formIdPrefix}-auth-query-param`} className="text-sm font-medium">
                <T>Auth query param</T>
              </label>
              <Input
                id={`${formIdPrefix}-auth-query-param`}
                value={form.authQueryParam}
                onChange={handleFieldInputChange("authQueryParam")}
                placeholder={t("Optional query param name")}
                disabled={disabled}
              />
            </div>
          ) : (
            <div />
          )}

          <div className="space-y-2 md:col-span-2">
            <label htmlFor={`${formIdPrefix}-auth-prefix`} className="text-sm font-medium">
              <T>Auth prefix</T>
            </label>
            <Input
              id={`${formIdPrefix}-auth-prefix`}
              value={form.authType === "bearer" ? form.authPrefix : ""}
              onChange={handleFieldInputChange("authPrefix")}
              placeholder={t("Auth prefix")}
              disabled={disabled || form.authType !== "bearer"}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
