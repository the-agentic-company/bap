import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { and, eq, ne } from "drizzle-orm";
import { coworker } from "@bap/db/schema";

const COWORKER_USERNAME_MAX_LENGTH = 64;
const COWORKER_DESCRIPTION_MAX_LENGTH = 280;

type CoworkerQueryLike = {
  findFirst: (...args: any[]) => Promise<unknown>;
};

type DatabaseLike = {
  query: {
    coworker: CoworkerQueryLike;
  };
};

export type CoworkerMetadataState = {
  id: string;
  name: string | null;
  description: string | null;
  username: string | null;
  prompt: string;
  triggerType: string;
  allowedIntegrations: string[];
  allowedCustomIntegrations: string[];
  schedule: unknown;
  autoApprove: boolean;
};

export type CoworkerMetadataUpdate = Partial<Record<"name" | "description" | "username", string>>;

type GeneratedCoworkerMetadata = {
  name: string | null;
  description: string | null;
  username: string | null;
};

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function buildFallbackCoworkerName(agentDescription: string): string {
  const firstSentence = agentDescription
    .split(/[\n.!?]/)[0]
    ?.replace(/\s+/g, " ")
    .trim();

  if (firstSentence) {
    return firstSentence.slice(0, 128);
  }

  return "New Coworker";
}

function buildFallbackCoworkerDescription(agentDescription: string): string | null {
  const cleaned = agentDescription.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }
  return cleaned.slice(0, COWORKER_DESCRIPTION_MAX_LENGTH);
}

function normalizeCoworkerName(text: string | null | undefined): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const firstLine = text.split("\n")[0] ?? "";
  const cleaned = firstLine
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.:;!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, 128);
}

function normalizeCoworkerDescription(text: string | null | undefined): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const cleaned = text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, COWORKER_DESCRIPTION_MAX_LENGTH);
}

export function normalizeCoworkerUsername(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, COWORKER_USERNAME_MAX_LENGTH);
}

async function findCoworkerByUsername(params: {
  database: DatabaseLike;
  username: string;
  excludeCoworkerId: string;
}): Promise<{ id: string } | null> {
  const rowUnknown = await params.database.query.coworker.findFirst({
    where: and(
      eq(coworker.username, params.username),
      ne(coworker.id, params.excludeCoworkerId),
    ),
    columns: { id: true },
  });

  if (!rowUnknown || typeof rowUnknown !== "object" || !("id" in rowUnknown)) {
    return null;
  }

  const id = (rowUnknown as { id?: unknown }).id;
  return typeof id === "string" ? { id } : null;
}

export async function normalizeAndEnsureUniqueCoworkerUsername(params: {
  database: DatabaseLike;
  coworkerId: string;
  username: string | null | undefined;
}): Promise<string | null> {
  if (typeof params.username !== "string") {
    return null;
  }

  const trimmed = params.username.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeCoworkerUsername(trimmed);
  if (!normalized) {
    return null;
  }

  const existing = await findCoworkerByUsername({
    database: params.database,
    username: normalized,
    excludeCoworkerId: params.coworkerId,
  });
  if (!existing) {
    return normalized;
  }

  const suffix = params.coworkerId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "cw";
  const base = normalized.slice(0, Math.max(1, COWORKER_USERNAME_MAX_LENGTH - suffix.length - 1));
  return `${base}-${suffix}`;
}

async function generateCoworkerMetadataWithGemini(params: {
  current: CoworkerMetadataState;
  next: CoworkerMetadataState;
  missingFields: Array<keyof GeneratedCoworkerMetadata>;
}): Promise<GeneratedCoworkerMetadata | null> {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      console.warn("[CoworkerMetadata] No GEMINI_API_KEY, skipping coworker metadata generation");
      return null;
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            name: {
              type: SchemaType.STRING,
              description: "3-7 words, concise, no quotes.",
              nullable: true,
            },
            description: {
              type: SchemaType.STRING,
              description: `One sentence, max ${COWORKER_DESCRIPTION_MAX_LENGTH} chars.`,
              nullable: true,
            },
            username: {
              type: SchemaType.STRING,
              description:
                'A personified handle — pick a first name and describe the role/specialty, e.g. "sam-from-hr", "lucie-the-linkedin-geek", "max-the-data-cruncher". Lowercase, letters/numbers/hyphens only, no leading @.',
              nullable: true,
            },
          },
        },
      },
    });

    const prompt = [
      "Generate missing metadata for a coworker.",
      "Use null for any field you cannot infer.",
      "IMPORTANT: The username MUST be a personified handle with a human first name followed by the role or specialty. Examples: sam-from-hr, lucie-the-linkedin-geek, max-the-data-cruncher, emma-the-sales-whisperer. NEVER use a generic slug like friendly-greeter or sales-follow-up.",
      "",
      `Missing fields: ${params.missingFields.join(", ")}`,
      "",
      "Current coworker JSON:",
      JSON.stringify(
        {
          name: params.current.name,
          description: params.current.description,
          username: params.current.username,
          prompt: params.current.prompt,
          triggerType: params.current.triggerType,
          allowedIntegrations: params.current.allowedIntegrations,
          allowedCustomIntegrations: params.current.allowedCustomIntegrations,
          schedule: params.current.schedule,
          autoApprove: params.current.autoApprove,
        },
        null,
        2,
      ),
      "",
      "Next coworker JSON:",
      JSON.stringify(
        {
          prompt: params.next.prompt,
          triggerType: params.next.triggerType,
          allowedIntegrations: params.next.allowedIntegrations,
          allowedCustomIntegrations: params.next.allowedCustomIntegrations,
          schedule: params.next.schedule,
          autoApprove: params.next.autoApprove,
        },
        null,
        2,
      ),
    ].join("\n");

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text) {
      return null;
    }

    const parsed = JSON.parse(text) as Partial<GeneratedCoworkerMetadata>;
    return {
      name: normalizeCoworkerName(parsed.name ?? null),
      description: normalizeCoworkerDescription(parsed.description ?? null),
      username:
        typeof parsed.username === "string"
          ? normalizeCoworkerUsername(parsed.username)
          : null,
    };
  } catch (error) {
    console.error("[CoworkerMetadata] Error generating coworker metadata:", error);
    return null;
  }
}

export async function generateCoworkerMetadataOnFirstPromptFill(params: {
  database: DatabaseLike;
  current: CoworkerMetadataState;
  next: CoworkerMetadataState;
}): Promise<CoworkerMetadataUpdate> {
  if (!isBlank(params.current.prompt) || isBlank(params.next.prompt)) {
    return {};
  }

  const missingFields = (["name", "description", "username"] as const).filter((field) =>
    isBlank(params.next[field]),
  );
  if (missingFields.length === 0) {
    return {};
  }

  const generated = await generateCoworkerMetadataWithGemini({
    current: params.current,
    next: params.next,
    missingFields: [...missingFields],
  });

  const fallbackName = buildFallbackCoworkerName(params.next.prompt);
  const resolvedName =
    !isBlank(params.next.name) || !missingFields.includes("name")
      ? null
      : normalizeCoworkerName(generated?.name) ?? fallbackName;
  const resolvedDescription =
    !isBlank(params.next.description) || !missingFields.includes("description")
      ? null
      : normalizeCoworkerDescription(generated?.description) ??
        buildFallbackCoworkerDescription(params.next.prompt);
  const usernameSeed =
    !isBlank(params.next.username) || !missingFields.includes("username")
      ? null
      : generated?.username ?? generated?.name ?? resolvedName ?? fallbackName;
  const resolvedUsername = usernameSeed
    ? await normalizeAndEnsureUniqueCoworkerUsername({
        database: params.database,
        coworkerId: params.next.id,
        username: usernameSeed,
      })
    : null;

  return {
    ...(resolvedName ? { name: resolvedName } : {}),
    ...(resolvedDescription ? { description: resolvedDescription } : {}),
    ...(resolvedUsername ? { username: resolvedUsername } : {}),
  };
}
