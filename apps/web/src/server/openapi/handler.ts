import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { appRouter } from "@/server/orpc";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

/**
 * Framework-neutral OpenAPI spec endpoint. Generates the OpenAPI document for the
 * oRPC `appRouter` and returns it as a standard JSON `Response`. The `/api/rpc` server
 * URL is preserved so generated clients keep targeting the product API. No request
 * input is needed, so the handler takes no arguments.
 */
export async function handleOpenApi(): Promise<Response> {
  const spec = await generator.generate(appRouter, {
    info: {
      title: "CmdClaw API",
      version: "0.1.0",
      description: "API for CmdClaw server",
    },
    servers: [{ url: "/api/rpc" }],
  });

  return Response.json(spec);
}
