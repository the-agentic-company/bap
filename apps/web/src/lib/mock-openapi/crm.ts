import { createHash } from "node:crypto";
import { z } from "zod";

const contactStatusSchema = z.enum(["lead", "customer", "inactive"]);
const dealStageSchema = z.enum(["prospecting", "qualified", "won", "lost"]);

const contactSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  company: z.string().min(1).nullable(),
  status: contactStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const dealSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  contactId: z.string(),
  stage: dealStageSchema,
  value: z.number().nonnegative(),
  currency: z.string().length(3),
  createdAt: z.string(),
});

export const contactsListQuerySchema = z.object({
  email: z.string().trim().min(1).optional(),
  status: contactStatusSchema.optional(),
});

export const dealsListQuerySchema = z.object({
  contactId: z.string().trim().min(1).optional(),
  stage: dealStageSchema.optional(),
});

export const contactsListResponseSchema = z.object({
  data: z.array(contactSchema),
  count: z.number().int().nonnegative(),
});

export const dealsListResponseSchema = z.object({
  data: z.array(dealSchema),
  count: z.number().int().nonnegative(),
});

export const createContactInputSchema = z.object({
  email: z.string().email(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  company: z.string().trim().min(1).nullable().optional().default(null),
  status: contactStatusSchema.optional().default("lead"),
});

export const updateContactInputSchema = z
  .object({
    email: z.string().email().optional(),
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    company: z.string().trim().min(1).nullable().optional(),
    status: contactStatusSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "At least one field must be provided.",
    path: ["body"],
  });

export const createDealInputSchema = z.object({
  name: z.string().trim().min(1),
  contactId: z.string().trim().min(1),
  stage: dealStageSchema.optional().default("prospecting"),
  value: z.number().nonnegative(),
  currency: z.string().trim().length(3).optional().default("USD"),
});

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});

const validationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});

const validationErrorResponseSchema = z.object({
  error: z.literal("validation_error"),
  issues: z.array(validationIssueSchema),
});

const mockContacts = [
  contactSchema.parse({
    id: "contact_ava_stone",
    email: "ava.stone@acme.test",
    firstName: "Ava",
    lastName: "Stone",
    company: "Acme Inc",
    status: "lead",
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T10:00:00.000Z",
  }),
  contactSchema.parse({
    id: "contact_liam_hart",
    email: "liam.hart@northwind.test",
    firstName: "Liam",
    lastName: "Hart",
    company: "Northwind",
    status: "customer",
    createdAt: "2026-02-02T09:30:00.000Z",
    updatedAt: "2026-02-20T14:45:00.000Z",
  }),
  contactSchema.parse({
    id: "contact_mia_chen",
    email: "mia.chen@globex.test",
    firstName: "Mia",
    lastName: "Chen",
    company: null,
    status: "inactive",
    createdAt: "2026-03-01T08:15:00.000Z",
    updatedAt: "2026-03-10T16:20:00.000Z",
  }),
] as const;

const mockDeals = [
  dealSchema.parse({
    id: "deal_acme_expansion",
    name: "Acme Expansion",
    contactId: "contact_ava_stone",
    stage: "prospecting",
    value: 12000,
    currency: "USD",
    createdAt: "2026-02-18T11:00:00.000Z",
  }),
  dealSchema.parse({
    id: "deal_northwind_renewal",
    name: "Northwind Renewal",
    contactId: "contact_liam_hart",
    stage: "qualified",
    value: 28500,
    currency: "EUR",
    createdAt: "2026-03-04T13:10:00.000Z",
  }),
] as const;

type MockValidationIssue = z.infer<typeof validationIssueSchema>;

const SYNTHETIC_CREATED_AT = "2026-03-30T09:00:00.000Z";
const SYNTHETIC_UPDATED_AT = "2026-03-30T12:00:00.000Z";

function toOpenApiSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = structuredClone(z.toJSONSchema(schema) as Record<string, unknown>) as Record<
    string,
    unknown
  >;
  delete jsonSchema.$schema;
  return jsonSchema;
}

function buildSyntheticId(prefix: "contact" | "deal", seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 10)}`;
}

export function notFoundResponse(resource: "contact" | "deal", id: string): Response {
  return Response.json(
    errorResponseSchema.parse({
      error: "not_found",
      message: `The ${resource} "${id}" was not found.`,
    }),
    { status: 404 },
  );
}

export function validationErrorResponse(
  errorOrIssues: z.ZodError | MockValidationIssue[],
): Response {
  const issues =
    errorOrIssues instanceof z.ZodError
      ? errorOrIssues.issues.map((issue) => ({
          path: issue.path.join(".") || "body",
          message: issue.message,
        }))
      : errorOrIssues;

  return Response.json(validationErrorResponseSchema.parse({ error: "validation_error", issues }), {
    status: 422,
  });
}

export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      response: validationErrorResponse([
        {
          path: "body",
          message: "Request body must be valid JSON.",
        },
      ]),
    };
  }
}

export function listContacts(filters: z.infer<typeof contactsListQuerySchema>) {
  return mockContacts.filter((contact) => {
    if (
      filters.email &&
      !contact.email.toLowerCase().includes(filters.email.trim().toLowerCase())
    ) {
      return false;
    }

    if (filters.status && contact.status !== filters.status) {
      return false;
    }

    return true;
  });
}

export function listDeals(filters: z.infer<typeof dealsListQuerySchema>) {
  return mockDeals.filter((deal) => {
    if (filters.contactId && deal.contactId !== filters.contactId.trim()) {
      return false;
    }

    if (filters.stage && deal.stage !== filters.stage) {
      return false;
    }

    return true;
  });
}

export function findContactById(id: string) {
  return mockContacts.find((contact) => contact.id === id) ?? null;
}

export function buildSyntheticContact(input: z.infer<typeof createContactInputSchema>) {
  return contactSchema.parse({
    id: buildSyntheticId("contact", `${input.email}:${input.firstName}:${input.lastName}`),
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company ?? null,
    status: input.status,
    createdAt: SYNTHETIC_CREATED_AT,
    updatedAt: SYNTHETIC_CREATED_AT,
  });
}

export function buildPatchedContact(
  existing: z.infer<typeof contactSchema>,
  input: z.infer<typeof updateContactInputSchema>,
) {
  return contactSchema.parse({
    ...existing,
    ...input,
    company: input.company === undefined ? existing.company : input.company,
    updatedAt: SYNTHETIC_UPDATED_AT,
  });
}

export function buildSyntheticDeal(input: z.infer<typeof createDealInputSchema>) {
  return dealSchema.parse({
    id: buildSyntheticId("deal", `${input.contactId}:${input.name}:${input.value}`),
    name: input.name,
    contactId: input.contactId,
    stage: input.stage,
    value: input.value,
    currency: input.currency.toUpperCase(),
    createdAt: SYNTHETIC_CREATED_AT,
  });
}

export function buildMockCrmOpenApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "CmdClaw Mock CRM API",
      version: "1.0.0",
      description: "Fixture-backed CRM API used to test executor OpenAPI imports and calls.",
    },
    servers: [{ url: `${origin}/api/mock/crm` }],
    components: {
      schemas: {
        Contact: toOpenApiSchema(contactSchema),
        Deal: toOpenApiSchema(dealSchema),
        ContactsListResponse: toOpenApiSchema(contactsListResponseSchema),
        DealsListResponse: toOpenApiSchema(dealsListResponseSchema),
        CreateContactInput: toOpenApiSchema(createContactInputSchema),
        UpdateContactInput: toOpenApiSchema(updateContactInputSchema),
        CreateDealInput: toOpenApiSchema(createDealInputSchema),
        ErrorResponse: toOpenApiSchema(errorResponseSchema),
        ValidationErrorResponse: toOpenApiSchema(validationErrorResponseSchema),
      },
    },
    paths: {
      "/contacts": {
        get: {
          operationId: "listContacts",
          summary: "List contacts",
          parameters: [
            {
              name: "email",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "status",
              in: "query",
              required: false,
              schema: { type: "string", enum: contactStatusSchema.options },
            },
          ],
          responses: {
            200: {
              description: "Contacts list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ContactsListResponse" },
                },
              },
            },
            422: {
              description: "Invalid filters",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
                },
              },
            },
          },
        },
        post: {
          operationId: "createContact",
          summary: "Create a contact",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateContactInput" },
              },
            },
          },
          responses: {
            200: {
              description: "Created contact",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Contact" },
                },
              },
            },
            422: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/contacts/{id}": {
        get: {
          operationId: "getContact",
          summary: "Get a contact by id",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Contact",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Contact" },
                },
              },
            },
            404: {
              description: "Not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
        patch: {
          operationId: "updateContact",
          summary: "Update a contact by id",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateContactInput" },
              },
            },
          },
          responses: {
            200: {
              description: "Updated contact",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Contact" },
                },
              },
            },
            404: {
              description: "Not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            422: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/deals": {
        get: {
          operationId: "listDeals",
          summary: "List deals",
          parameters: [
            {
              name: "contactId",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "stage",
              in: "query",
              required: false,
              schema: { type: "string", enum: dealStageSchema.options },
            },
          ],
          responses: {
            200: {
              description: "Deals list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DealsListResponse" },
                },
              },
            },
            422: {
              description: "Invalid filters",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
                },
              },
            },
          },
        },
        post: {
          operationId: "createDeal",
          summary: "Create a deal",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateDealInput" },
              },
            },
          },
          responses: {
            200: {
              description: "Created deal",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Deal" },
                },
              },
            },
            422: {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ValidationErrorResponse" },
                },
              },
            },
          },
        },
      },
    },
  };
}
