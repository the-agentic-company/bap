import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModulrClient } from "./modulr-client";

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  };
}

function jsonErrorResponse(status: number, statusText: string, payload: unknown) {
  return {
    ok: false,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => payload,
  };
}

function createClient(clientSecret: string = crypto.randomUUID()) {
  return new ModulrClient({
    database: "assurhelium",
    clientId: "api",
    clientSecret,
    locale: "fr",
    baseUrl: "https://app.modulr-courtage.fr",
  });
}

function expectFormEncodedTokenRequest(init: RequestInit | undefined) {
  expect(init?.headers).toEqual(
    expect.objectContaining({
      "content-type": "application/x-www-form-urlencoded",
      Database: "assurhelium",
    }),
  );
  expect(String(init?.body)).toBe(
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "api",
      client_secret: "test-secret",
    }).toString(),
  );
}

describe("ModulrClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticates with Modulr using form-encoded client credentials", async () => {
    const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/tokens/users")) {
        expectFormEncodedTokenRequest(init);
        return jsonResponse({ data: { access_token: "token", expires_in: 3600 } });
      }
      if (pathname.endsWith("/documents/42")) {
        return jsonResponse({
          data: {
            document: {
              id: 42,
              filename: "contract.pdf",
              file: "JVBERi0x",
            },
          },
        });
      }
      throw new Error(`Unexpected request to ${pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient("test-secret").getDocument("42");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
        }),
      }),
    );
  });

  it("finds a customer by email and returns GED document resource links", async () => {
    const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(String(url)).pathname;

      if (pathname.endsWith("/tokens/users")) {
        return jsonResponse({ access_token: "token", expires_in: 3600 });
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (pathname.endsWith("/clients/search") && body.filters.email) {
        return jsonResponse({
          data: {
            clients: {
              "123": { client_id: 123, name: "Jane Client", email: "jane@example.com" },
            },
          },
        });
      }
      if (pathname.endsWith("/clients/search") && body.filters.email_2) {
        return jsonResponse({ data: { clients: [] } });
      }
      if (pathname.endsWith("/tags/search")) {
        return jsonResponse({ data: { tags: { "456": { tag_id: 456, label: "client:123" } } } });
      }
      if (pathname.endsWith("/documents/search")) {
        expect(body.specific_filters).toEqual({ entity_tag_id_list: [456] });
        return jsonResponse({
          data: {
            documents: {
              "789": {
                document_id: 789,
                title: "Attestation",
                filename: "attestation.pdf",
                type: "unknown",
              },
            },
          },
        });
      }
      throw new Error(`Unexpected request to ${pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createClient().listCustomerDocumentsByEmail({
      email: "jane@example.com",
      includeRelatedRecords: false,
    });

    expect(result).toMatchObject({
      status: "matched",
      customer: { id: "123", name: "Jane Client" },
      documents: [
        {
          id: "789",
          title: "Attestation",
          filename: "attestation.pdf",
          mimeType: "application/pdf",
          resourceUri: "modulr://documents/789",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          Database: "assurhelium",
          Authorization: "Bearer token",
        }),
      }),
    );
  });

  it("paginates Modulr search results when listing documents", async () => {
    const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(String(url)).pathname;

      if (pathname.endsWith("/tokens/users")) {
        return jsonResponse({ access_token: "token", expires_in: 3600 });
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (pathname.endsWith("/tags/search")) {
        return jsonResponse({ data: { tags: { "456": { tag_id: 456, label: "client:123" } } } });
      }
      if (pathname.endsWith("/documents/search") && body.page === 1) {
        return jsonResponse({
          data: {
            number_of_pages: 2,
            documents: Object.fromEntries(
              Array.from({ length: 100 }, (_, index) => [
                String(index + 1),
                {
                  document_id: index + 1,
                  title: `Document ${index + 1}`,
                  filename: `document-${index + 1}.pdf`,
                  type: "unknown",
                },
              ]),
            ),
          },
        });
      }
      if (pathname.endsWith("/documents/search") && body.page === 2) {
        return jsonResponse({
          data: {
            number_of_pages: 2,
            documents: {
              "101": {
                document_id: 101,
                title: "Document 101",
                filename: "document-101.msg",
                type: "unknown",
              },
            },
          },
        });
      }
      throw new Error(`Unexpected request to ${pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createClient().listDocumentsForRecord({
      recordType: "client",
      recordId: "123",
    });

    expect(result).toHaveLength(101);
    expect(result.at(0)).toMatchObject({ id: "1", mimeType: "application/pdf" });
    expect(result.at(-1)).toMatchObject({ id: "101", mimeType: "application/vnd.ms-outlook" });
  });

  it("returns ambiguous candidates instead of guessing a customer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;

        if (pathname.endsWith("/tokens/users")) {
          return jsonResponse({ access_token: "token", expires_in: 3600 });
        }
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (pathname.endsWith("/clients/search") && body.filters.email) {
          return jsonResponse({
            data: {
              clients: [
                { id: 1, name: "First" },
                { id: 2, name: "Second" },
              ],
            },
          });
        }
        if (pathname.endsWith("/clients/search") && body.filters.email_2) {
          return jsonResponse({ data: { clients: [] } });
        }
        throw new Error(`Unexpected request to ${pathname}`);
      }),
    );

    await expect(
      createClient().listCustomerDocumentsByEmail({ email: "shared@example.com" }),
    ).resolves.toMatchObject({
      status: "ambiguous",
      candidates: [{ id: "1" }, { id: "2" }],
    });
  });

  it("downloads a document file as a base64 resource payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname.endsWith("/tokens/users")) {
          return jsonResponse({ access_token: "token", expires_in: 3600 });
        }
        if (pathname.endsWith("/documents/42")) {
          return jsonResponse({
            data: {
              document: {
                id: 42,
                title: "Contract",
                filename: "contract.pdf",
                file: "data:application/pdf;base64,JVBERi0x",
              },
            },
          });
        }
        throw new Error(`Unexpected request to ${pathname}`);
      }),
    );

    await expect(createClient().getDocument("42")).resolves.toMatchObject({
      id: "42",
      filename: "contract.pdf",
      mimeType: "application/pdf",
      resourceUri: "modulr://documents/42",
      blob: "JVBERi0x",
    });
  });

  it("accepts Modulr token responses nested under data", async () => {
    const fetchMock = vi.fn(async (url: URL | string) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/tokens/users")) {
        return jsonResponse({ data: { access_token: "nested-token", expires_in: 3600 } });
      }
      if (pathname.endsWith("/documents/42")) {
        return jsonResponse({
          data: {
            document: {
              id: 42,
              filename: "contract.pdf",
              file: "JVBERi0x",
            },
          },
        });
      }
      throw new Error(`Unexpected request to ${pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createClient().getDocument("42");

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer nested-token",
        }),
      }),
    );
  });

  it("includes Modulr authentication error details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname.endsWith("/tokens/users")) {
          return jsonErrorResponse(400, "Bad Request", {
            status: "fail",
            data: {
              error: "invalid_client",
              error_description: "The client credentials are invalid",
            },
          });
        }
        throw new Error(`Unexpected request to ${pathname}`);
      }),
    );

    await expect(createClient().getDocument("42")).rejects.toThrow(
      /Modulr authentication failed \(400 Bad Request\).*invalid_client/,
    );
  });
});
