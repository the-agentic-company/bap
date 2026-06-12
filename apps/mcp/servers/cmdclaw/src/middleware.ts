import { authenticateHostedMcpRequest, sendUnauthorizedMcpResponse } from "../../../shared/auth";

export default async function cmdclawMiddleware(req: any, res: any, next: () => void) {
  try {
    req.auth = await authenticateHostedMcpRequest({
      req,
      requiredAudience: "bap",
      // Platform MCP Server (ADR-0013): generations authenticate with managed
      // tokens minted per generation; external agents keep using OAuth.
      allowManagedToken: true,
    });
    next();
  } catch (error) {
    sendUnauthorizedMcpResponse({
      req,
      res,
      slug: "bap",
      message: error instanceof Error ? error.message : "Unauthorized",
    });
  }
}
