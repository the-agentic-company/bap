const GALIEN_BASE_URL = "https://api.frontline.galien.preprod.webhelpmedica.com";
const GALIEN_LOGIN_PATH = "/api/v1/tokens/login";

export type GalienScalar = string | number | boolean;
export type GalienQueryValue = GalienScalar | GalienScalar[];

export type GalienPathParams = Record<string, GalienScalar>;
export type GalienQuery = Record<string, GalienQueryValue>;
export type GalienCurrentUser = {
  id: number;
  role?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  iat?: number;
  exp?: number;
};
type GalienAuthenticatedRequestParams = GalienRequestParams & {
  bearerToken: string;
};
export type GalienCredentials = {
  username: string;
  password: string;
};
type CreateVisitReportPayload = {
  clientId?: number;
  contactPersonId?: number;
  contactOutcomeId?: number;
  visitDate?: string;
  duration?: number;
  contactTypeId?: number;
  numberOfPersons?: number;
  training1?: number;
  training2?: number;
  otherTraining?: string;
  otherTrainingComment?: string;
  comment?: string;
  qualification1?: number;
  qualification2?: number;
  retrocession?: boolean;
  promotion?: boolean;
  promotionMonth?: string;
  previousSellOut?: boolean | number;
  currentSellOut?: boolean | number;
  plvOptions?: Array<{
    plvLabel?: string;
    optionsIds?: number[];
  }>;
};

type GalienRequestParams = {
  method: "GET" | "POST";
  path: string;
  pathParams?: GalienPathParams;
  query?: GalienQuery;
  body?: CreateVisitReportPayload;
};

function getGalienCredentials(): GalienCredentials {
  const email = process.env.GALIEN_EMAIL?.trim();
  const password = process.env.GALIEN_PASSWORD?.trim();

  if (!email || !password) {
    throw new Error("GALIEN_EMAIL and GALIEN_PASSWORD must be configured.");
  }

  return { username: email, password };
}

export function buildGalienUrl(
  pathTemplate: string,
  pathParams?: GalienPathParams,
  query?: GalienQuery,
) {
  const resolvedPath = pathTemplate.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = pathParams?.[key];
    if (value === undefined) {
      throw new Error(`Missing required Galien path parameter "${key}" for ${pathTemplate}.`);
    }
    return encodeURIComponent(String(value));
  });

  const url = new URL(resolvedPath, GALIEN_BASE_URL);

  if (query) {
    for (const [key, rawValue] of Object.entries(query)) {
      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          url.searchParams.append(key, String(item));
        }
        continue;
      }

      url.searchParams.set(key, String(rawValue));
    }
  }

  return url;
}

export function splitGalienRequestParts(
  pathTemplate: string,
  params: Record<string, GalienQueryValue | undefined>,
) {
  const placeholders = new Set(
    Array.from(pathTemplate.matchAll(/\{([^}]+)\}/g), (match) => match[1] ?? ""),
  );
  const pathParams: GalienPathParams = {};
  const query: GalienQuery = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    if (placeholders.has(key)) {
      if (Array.isArray(value)) {
        throw new Error(`Galien path parameter "${key}" cannot be an array.`);
      }
      pathParams[key] = value;
      continue;
    }

    query[key] = value;
  }

  return {
    pathParams: Object.keys(pathParams).length > 0 ? pathParams : undefined,
    query: Object.keys(query).length > 0 ? query : undefined,
  };
}

export function extractBearerTokenFromLoginResponse(response: Response) {
  const authorization = response.headers.get("authorization")?.trim();
  if (authorization?.startsWith("Bearer ")) {
    return authorization;
  }

  throw new Error("Galien login succeeded but did not return a bearer token.");
}

function decodeJwtPayload(bearerToken: string) {
  const token = bearerToken.replace(/^Bearer\s+/i, "");
  const [, payload] = token.split(".");
  if (!payload) {
    throw new Error("Galien login returned a bearer token that is not a JWT.");
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Galien login returned a JWT with an unreadable payload.");
  }
}

export function decodeGalienCurrentUserFromBearerToken(bearerToken: string): GalienCurrentUser {
  const payload = decodeJwtPayload(bearerToken);
  const rawId = payload.id;
  const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId) : NaN;

  if (!Number.isInteger(id)) {
    throw new Error("Galien login JWT did not include a valid numeric user id claim.");
  }

  return {
    id,
    role: typeof payload.role === "string" ? payload.role : undefined,
    firstName: typeof payload.firstName === "string" ? payload.firstName : undefined,
    lastName: typeof payload.lastName === "string" ? payload.lastName : undefined,
    username: typeof payload.username === "string" ? payload.username : undefined,
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
  };
}

async function parseResponseBody(response: Response) {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  if (
    contentType.startsWith("text/") ||
    contentType.includes("application/xml") ||
    contentType.includes("application/xhtml+xml")
  ) {
    return response.text();
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    mimeType: contentType || "application/octet-stream",
    base64: buffer.toString("base64"),
  };
}

function formatErrorBody(body: unknown) {
  if (body === null || body === undefined) {
    return "";
  }

  if (typeof body === "string") {
    return body;
  }

  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

async function loginToGalien(credentials?: GalienCredentials) {
  const { username, password } = credentials ?? getGalienCredentials();
  const response = await fetch(new URL(GALIEN_LOGIN_PATH, GALIEN_BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      username,
      password,
    }),
  });

  if (!response.ok) {
    const errorBody = await parseResponseBody(response);
    throw new Error(
      `Galien login failed (${response.status} ${response.statusText}): ${formatErrorBody(errorBody)}`,
    );
  }

  return extractBearerTokenFromLoginResponse(response);
}

export async function getCurrentGalienUser(credentials?: GalienCredentials) {
  const bearerToken = await loginToGalien(credentials);
  return decodeGalienCurrentUserFromBearerToken(bearerToken);
}

async function requestGalienWithBearerToken(params: GalienAuthenticatedRequestParams) {
  const url = buildGalienUrl(params.path, params.pathParams, params.query);
  const response = await fetch(url, {
    method: params.method,
    headers: {
      authorization: params.bearerToken,
      accept: "application/json",
      ...(params.body ? { "content-type": "application/json" } : {}),
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });

  const data = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(
      `Galien ${params.method} ${params.path} failed (${response.status} ${response.statusText}): ${formatErrorBody(data)}`,
    );
  }

  return {
    method: params.method,
    path: params.path,
    url: url.toString(),
    status: response.status,
    contentType: response.headers.get("content-type"),
    data,
  };
}

export async function requestGalien(params: GalienRequestParams, credentials?: GalienCredentials) {
  const bearerToken = await loginToGalien(credentials);
  return requestGalienWithBearerToken({
    ...params,
    bearerToken,
  });
}

export async function requestGalienForCurrentUser(
  params: GalienRequestParams,
  credentials?: GalienCredentials,
) {
  const bearerToken = await loginToGalien(credentials);
  const currentUser = decodeGalienCurrentUserFromBearerToken(bearerToken);
  const pathUsesUserId = /\{userId\}/.test(params.path);

  return requestGalienWithBearerToken({
    ...params,
    bearerToken,
    pathParams: pathUsesUserId
      ? {
          ...params.pathParams,
          userId: currentUser.id,
        }
      : params.pathParams,
    query: pathUsesUserId
      ? params.query
      : {
          ...params.query,
          userId: currentUser.id,
        },
  });
}

export async function requestGalienForCurrentUserPathParam(
  params: GalienRequestParams,
  pathParamName: string,
  credentials?: GalienCredentials,
) {
  const bearerToken = await loginToGalien(credentials);
  const currentUser = decodeGalienCurrentUserFromBearerToken(bearerToken);

  return requestGalienWithBearerToken({
    ...params,
    bearerToken,
    pathParams: {
      ...params.pathParams,
      [pathParamName]: currentUser.id,
    },
  });
}
