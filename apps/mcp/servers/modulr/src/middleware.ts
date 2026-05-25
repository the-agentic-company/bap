import {
  authenticateHostedMcpRequest,
  sendUnauthorizedMcpResponse,
} from "../../../shared/auth";

export default async function modulrMiddleware(req: any, res: any, next: () => void) {
  try {
    req.auth = await authenticateHostedMcpRequest({
      req,
      requiredAudience: "modulr",
      allowManagedToken: true,
    });
    next();
  } catch (error) {
    sendUnauthorizedMcpResponse({
      req,
      res,
      slug: "modulr",
      message: error instanceof Error ? error.message : "Unauthorized",
    });
  }
}
