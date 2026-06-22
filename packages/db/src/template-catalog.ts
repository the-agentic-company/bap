import { z } from "zod";

export const templateTriggerTypeSchema = z.enum(["manual", "schedule", "email", "webhook"]);

export const templateIntegrationTypeSchema = z.enum([
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
]);

export const templateCatalogSummaryBlockSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(1_000),
  integrations: z.array(templateIntegrationTypeSchema).max(8),
});

export const templateCatalogConnectedAppSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    tools: z.number().int().min(0).max(999),
    integration: templateIntegrationTypeSchema.optional(),
    fallbackLabel: z.string().trim().min(1).max(12).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.integration && !value.fallbackLabel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Connected app entries must include integration or fallbackLabel.",
        path: ["fallbackLabel"],
      });
    }
  });

export const templateCatalogTemplateSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Template ids must be lowercase kebab-case."),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  triggerType: templateTriggerTypeSchema,
  industry: z.string().trim().min(1).max(120),
  useCase: z.string().trim().min(1).max(120),
  integrations: z.array(templateIntegrationTypeSchema).min(1).max(12),
  triggerTitle: z.string().trim().min(1).max(160),
  triggerDescription: z.string().trim().min(1).max(1_000),
  agentInstructions: z.array(z.string().trim().min(1).max(2_000)).min(1).max(32),
  heroCta: z.string().trim().min(1).max(80),
  summaryBlocks: z.array(templateCatalogSummaryBlockSchema).min(1).max(12),
  mermaid: z.string().trim().min(1).max(20_000),
  connectedApps: z.array(templateCatalogConnectedAppSchema).min(1).max(16),
  featured: z.boolean().default(false),
});

export const templateCatalogSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().trim().min(1),
  templates: z.array(templateCatalogTemplateSchema),
});

export type TemplateTriggerType = z.infer<typeof templateTriggerTypeSchema>;
export type TemplateIntegrationType = z.infer<typeof templateIntegrationTypeSchema>;
export type TemplateCatalogSummaryBlock = z.infer<typeof templateCatalogSummaryBlockSchema>;
export type TemplateCatalogConnectedApp = z.infer<typeof templateCatalogConnectedAppSchema>;
export type TemplateCatalogTemplate = z.infer<typeof templateCatalogTemplateSchema>;
export type TemplateCatalog = z.infer<typeof templateCatalogSchema>;

export function parseTemplateCatalogJson(definitionJson: string): TemplateCatalog {
  let parsedDefinition: unknown;

  try {
    parsedDefinition = JSON.parse(definitionJson);
  } catch {
    throw new Error("Template catalog JSON is not valid JSON.");
  }

  return templateCatalogSchema.parse(parsedDefinition);
}
