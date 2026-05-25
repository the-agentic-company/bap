export type ModulrCredentials = {
  database: string;
  clientId: string;
  clientSecret: string;
  locale: "fr" | "en";
  baseUrl: string;
};

export type ModulrRecordType = "client" | "policy" | "estimate" | "claim" | "complaint";

export type ModulrCustomer = {
  id: string;
  name: string | null;
  email: string | null;
  raw: Record<string, unknown>;
};

export type ModulrRecord = {
  id: string;
  type: ModulrRecordType;
  label: string | null;
  raw: Record<string, unknown>;
};

export type ModulrDocumentSummary = {
  id: string;
  title: string | null;
  filename: string | null;
  mimeType: string;
  resourceUri: string;
  raw: Record<string, unknown>;
};

export type ModulrDocumentFile = ModulrDocumentSummary & {
  blob: string;
};

type TokenCacheEntry = {
  accessToken: string;
  expiresAt: number;
};

type ModulrSearchResponse = {
  data?: Record<string, unknown>;
};

const tokenCache = new Map<string, TokenCacheEntry>();

const RECORD_SEARCH_TABLES = {
  policy: "policies",
  estimate: "estimates",
  claim: "claims",
  complaint: "complaints",
} as const;

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  json: "application/json",
  msg: "application/vnd.ms-outlook",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const DEFAULT_SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 100;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readId(record: Record<string, unknown>, fallbackKeys: string[] = []): string | null {
  for (const key of ["id", ...fallbackKeys]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function inferMimeType(filename: string | null): string {
  const extension = filename?.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function readMimeType(record: Record<string, unknown>, filename: string | null): string {
  const explicit = readText(record, ["mime_type", "mimeType"]);
  if (explicit) {
    return explicit;
  }

  const type = readText(record, ["type"]);
  return type && type.includes("/") && type.toLowerCase() !== "unknown"
    ? type
    : inferMimeType(filename);
}

function normalizeBase64(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  const commaIndex = trimmed.indexOf(",");
  return trimmed.startsWith("data:") && commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : trimmed;
}

function readTokenPayload(payload: unknown): {
  accessToken: string | null;
  expiresIn: number;
} {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const accessToken = typeof root.access_token === "string"
    ? root.access_token.trim()
    : typeof data.access_token === "string"
      ? data.access_token.trim()
      : "";
  const expiresIn = typeof root.expires_in === "number"
    ? root.expires_in
    : typeof data.expires_in === "number"
      ? data.expires_in
      : 3600;

  return {
    accessToken: accessToken || null,
    expiresIn,
  };
}

function buildEqualFilter(field: string, value: string | number) {
  return { [field]: { equal: value } };
}

function buildInFilter(field: string, value: Array<string | number>) {
  return { [field]: { in: value } };
}

function mergeUniqueById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function parseList(payload: ModulrSearchResponse, table: string): Record<string, unknown>[] {
  const data = asRecord(payload.data);
  const direct = data[table];
  if (Array.isArray(direct)) {
    return direct.map(asRecord);
  }
  if (direct && typeof direct === "object") {
    return Object.values(direct).map(asRecord);
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      return value.map(asRecord);
    }
    if (value && typeof value === "object") {
      return Object.values(value).map(asRecord);
    }
  }
  return [];
}

function readNumberOfPages(payload: ModulrSearchResponse): number | null {
  const data = asRecord(payload.data);
  for (const key of ["number_of_pages", "numberOfPages", "pages", "total_pages", "totalPages"]) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
  }
  return null;
}

function toCustomer(record: Record<string, unknown>): ModulrCustomer | null {
  const id = readId(record, ["client_id"]);
  if (!id) {
    return null;
  }
  return {
    id,
    name: readText(record, ["name", "company_name", "full_name", "title"]),
    email: readText(record, ["email", "email_2"]),
    raw: record,
  };
}

function toDocument(record: Record<string, unknown>): ModulrDocumentSummary | null {
  const id = readId(record, ["document_id"]);
  if (!id) {
    return null;
  }
  const filename = readText(record, ["filename", "file_name", "name"]);
  return {
    id,
    title: readText(record, ["title", "label", "name"]),
    filename,
    mimeType: readMimeType(record, filename),
    resourceUri: `modulr://documents/${id}`,
    raw: record,
  };
}

function toRecord(type: ModulrRecordType, record: Record<string, unknown>): ModulrRecord | null {
  const id = readId(record, [`${type}_id`]);
  if (!id) {
    return null;
  }
  return {
    id,
    type,
    label: readText(record, ["title", "name", "number", "reference", "label"]),
    raw: record,
  };
}

export class ModulrClient {
  constructor(private readonly credentials: ModulrCredentials) {}

  private get cacheKey() {
    return [
      this.credentials.baseUrl,
      this.credentials.locale,
      this.credentials.database,
      this.credentials.clientId,
      this.credentials.clientSecret,
    ].join("\n");
  }

  private url(path: string): URL {
    return new URL(`/${this.credentials.locale}/api/1.0/${path.replace(/^\/+/, "")}`, this.credentials.baseUrl);
  }

  private async token(): Promise<string> {
    const cached = tokenCache.get(this.cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }

    const response = await fetch(this.url("/tokens/users"), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Database: this.credentials.database,
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Modulr authentication failed (${response.status} ${response.statusText})`);
    }

    const payload = readTokenPayload(await response.json());
    if (!payload.accessToken) {
      throw new Error("Modulr authentication succeeded without an access token.");
    }

    tokenCache.set(this.cacheKey, {
      accessToken: payload.accessToken,
      expiresAt: Date.now() + payload.expiresIn * 1000,
    });
    return payload.accessToken;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.url(path), {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Database: this.credentials.database,
        Authorization: `Bearer ${await this.token()}`,
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `Modulr API request failed (${response.status} ${response.statusText})${
          message ? `: ${message}` : ""
        }`,
      );
    }

    return response.json() as Promise<T>;
  }

  private async search(
    table: string,
    filters: Record<string, unknown>,
    limit = DEFAULT_SEARCH_PAGE_SIZE,
    specificFilters?: Record<string, unknown>,
  ) {
    const results: Record<string, unknown>[] = [];
    let page = 1;
    let numberOfPages: number | null = null;

    while (page <= (numberOfPages ?? MAX_SEARCH_PAGES)) {
      const payload = await this.request<ModulrSearchResponse>(`/${table}/search`, {
        method: "POST",
        body: JSON.stringify({
          page,
          number_per_page: limit,
          filters,
          ...(specificFilters ? { specific_filters: specificFilters } : {}),
        }),
      });
      const pageItems = parseList(payload, table);
      results.push(...pageItems);

      numberOfPages ??= readNumberOfPages(payload);
      if (pageItems.length < limit) {
        break;
      }
      page += 1;
    }

    return results;
  }

  async findCustomerByEmail(email: string): Promise<
    | { status: "matched"; customer: ModulrCustomer }
    | { status: "ambiguous"; candidates: ModulrCustomer[] }
    | { status: "not_found"; candidates: [] }
  > {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      throw new Error("Customer email is required.");
    }

    const directMatches = mergeUniqueById(
      (
        await Promise.all([
          this.search("clients", buildEqualFilter("email", normalizedEmail)),
          this.search("clients", buildEqualFilter("email_2", normalizedEmail)),
        ])
      )
        .flat()
        .map(toCustomer)
        .filter((customer): customer is ModulrCustomer => Boolean(customer)),
    );
    if (directMatches.length === 1) {
      return { status: "matched", customer: directMatches[0] };
    }
    if (directMatches.length > 1) {
      return { status: "ambiguous", candidates: directMatches };
    }

    const contacts = (
      await Promise.all([
        this.search("contacts", buildEqualFilter("email", normalizedEmail)),
        this.search("contacts", buildEqualFilter("email_2", normalizedEmail)),
      ])
    ).flat();
    const contactIds = contacts
      .map((contact) => readId(contact, ["contact_id"]))
      .filter((id): id is string => Boolean(id));
    if (contactIds.length === 0) {
      return { status: "not_found", candidates: [] };
    }

    const associations = await this.search(
      "contacts_associations",
      buildInFilter("contact_id", contactIds),
    );
    const clientIds = Array.from(
      new Set(
        associations
          .map((association) => readId(association, ["client_id"]))
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (clientIds.length === 0) {
      return { status: "not_found", candidates: [] };
    }

    const candidates = mergeUniqueById(
      (await this.search("clients", buildInFilter("id", clientIds)))
        .map(toCustomer)
        .filter((customer): customer is ModulrCustomer => Boolean(customer)),
    );
    if (candidates.length === 1) {
      return { status: "matched", customer: candidates[0] };
    }
    if (candidates.length > 1) {
      return { status: "ambiguous", candidates };
    }

    return { status: "not_found", candidates: [] };
  }

  async listCustomerRecords(clientId: string): Promise<ModulrRecord[]> {
    const policies = (await this.search("policies", buildEqualFilter("client_id", clientId)))
      .map((record) => toRecord("policy", record))
      .filter((record): record is ModulrRecord => Boolean(record));
    const policyIds = policies.map((policy) => policy.id);
    const claims = policyIds.length > 0
      ? (await this.search("claims", buildInFilter("policy_id", policyIds)))
          .map((record) => toRecord("claim", record))
          .filter((record): record is ModulrRecord => Boolean(record))
      : [];
    const [estimates, complaints] = await Promise.all([
      this.search("estimates", buildEqualFilter("client_id", clientId)).then((records) =>
        records
          .map((record) => toRecord("estimate", record))
          .filter((record): record is ModulrRecord => Boolean(record)),
      ),
      this.search("complaints", buildEqualFilter("client_id", clientId)).then((records) =>
        records
          .map((record) => toRecord("complaint", record))
          .filter((record): record is ModulrRecord => Boolean(record)),
      ),
    ]);

    return [...policies, ...estimates, ...claims, ...complaints];
  }

  async listDocumentsForRecord(input: {
    recordType: ModulrRecordType;
    recordId: string;
    extranetOnly?: boolean;
  }): Promise<ModulrDocumentSummary[]> {
    const tags = await this.search("tags", buildEqualFilter("label", `${input.recordType}:${input.recordId}`));
    const tagIds = tags
      .map((tag) => readId(tag, ["tag_id"]))
      .filter((id): id is string => Boolean(id));
    if (tagIds.length === 0) {
      return [];
    }

    const systemTagIds = input.extranetOnly
      ? (await this.search("tags", buildEqualFilter("label", "extranet")))
          .map((tag) => readId(tag, ["tag_id"]))
          .filter((id): id is string => Boolean(id))
      : [];

    if (input.extranetOnly && systemTagIds.length === 0) {
      return [];
    }

    return this.search(
      "documents",
      {},
      DEFAULT_SEARCH_PAGE_SIZE,
      {
        entity_tag_id_list: tagIds.map(Number),
        ...(input.extranetOnly ? { system_tag_id_list: systemTagIds.map(Number) } : {}),
      },
    )
      .then((documents) =>
        documents.map(toDocument).filter((document): document is ModulrDocumentSummary => Boolean(document)),
      );
  }

  async listCustomerDocumentsByEmail(input: {
    email: string;
    includeRelatedRecords?: boolean;
    extranetOnly?: boolean;
  }) {
    const customerMatch = await this.findCustomerByEmail(input.email);
    if (customerMatch.status !== "matched") {
      return customerMatch;
    }

    const recordInputs: Array<{ recordType: ModulrRecordType; recordId: string }> = [
      { recordType: "client", recordId: customerMatch.customer.id },
    ];
    const records = input.includeRelatedRecords
      ? await this.listCustomerRecords(customerMatch.customer.id)
      : [];
    recordInputs.push(
      ...records.map((record) => ({
        recordType: record.type,
        recordId: record.id,
      })),
    );

    const documents = mergeUniqueById(
      (
        await Promise.all(
          recordInputs.map((record) =>
            this.listDocumentsForRecord({
              ...record,
              extranetOnly: input.extranetOnly,
            }),
          ),
        )
      ).flat(),
    );

    return {
      status: "matched" as const,
      customer: customerMatch.customer,
      records,
      documents,
    };
  }

  async getDocument(documentId: string): Promise<ModulrDocumentFile> {
    const payload = await this.request<{ data?: unknown }>(`/documents/${documentId}`, {
      method: "GET",
    });
    const document = asRecord(asRecord(payload.data).document ?? payload.data);
    const summary = toDocument({ ...document, id: documentId });
    const blob = normalizeBase64(document.file);
    if (!summary || !blob) {
      throw new Error("Modulr document response did not include a downloadable file.");
    }
    return {
      ...summary,
      blob,
    };
  }
}
