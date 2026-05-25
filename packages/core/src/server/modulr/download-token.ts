import { createHmac, timingSafeEqual } from "node:crypto";

export type ModulrDocumentDownloadTokenClaims = {
  storageKey: string;
  filename: string;
  mimeType: string;
  workspaceId: string;
  documentId: string;
  sizeBytes: number;
  exp: number;
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseDownloadClaims(value: unknown): ModulrDocumentDownloadTokenClaims {
  const parsed = value as Partial<ModulrDocumentDownloadTokenClaims>;
  if (
    typeof parsed.storageKey !== "string" ||
    !parsed.storageKey.startsWith("modulr-documents/") ||
    typeof parsed.filename !== "string" ||
    parsed.filename.trim().length === 0 ||
    typeof parsed.mimeType !== "string" ||
    parsed.mimeType.trim().length === 0 ||
    typeof parsed.workspaceId !== "string" ||
    parsed.workspaceId.trim().length === 0 ||
    typeof parsed.documentId !== "string" ||
    parsed.documentId.trim().length === 0 ||
    typeof parsed.sizeBytes !== "number" ||
    !Number.isFinite(parsed.sizeBytes) ||
    parsed.sizeBytes < 0 ||
    typeof parsed.exp !== "number"
  ) {
    throw new Error("Invalid Modulr document download token payload.");
  }

  return parsed as ModulrDocumentDownloadTokenClaims;
}

export function signModulrDocumentDownloadToken(
  claims: ModulrDocumentDownloadTokenClaims,
  secret: string,
): string {
  const payload = encodeBase64Url(JSON.stringify(claims));
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function verifyModulrDocumentDownloadToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): ModulrDocumentDownloadTokenClaims {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    throw new Error("Invalid Modulr document download token format.");
  }

  const expectedSignature = signPayload(payload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid Modulr document download token signature.");
  }

  const claims = parseDownloadClaims(JSON.parse(decodeBase64Url(payload)));
  if (claims.exp <= nowSeconds) {
    throw new Error("Modulr document download token has expired.");
  }

  return claims;
}
