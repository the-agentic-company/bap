import { and, eq, sql } from "drizzle-orm";
import { Resend } from "resend";
import {
  buildCoworkerForwardingAddress,
  EMAIL_FORWARDED_TRIGGER_TYPE,
  extractEmailAddress,
  generateCoworkerAliasLocalPart,
  parseForwardingTargetFromEmail,
} from "../../lib/email-forwarding";
import { db } from "@bap/db/client";
import { user, coworker, coworkerEmailAlias, coworkerRun } from "@bap/db/schema";
import { triggerCoworkerRun } from "./coworker-service";
import { ORPCError } from "@orpc/server";

const RESEND_EMAIL_RECEIVED_EVENT = "email.received";
const COWORKER_ALIAS_GENERATION_MAX_ATTEMPTS = 32;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  return apiKey ? new Resend(apiKey) : null;
}

export type ResendEmailReceivedEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    from?: string;
    to?: string[];
    message_id?: string;
    subject?: string;
    attachments?: Array<unknown>;
  };
};

export type ForwardedEmailQueuePayload = {
  webhookId?: string;
  event: ResendEmailReceivedEvent;
};

function getReceivingDomain(): string | null {
  const value = process.env.RESEND_RECEIVING_DOMAIN?.trim().toLowerCase();
  return value && value.length > 0 ? value : null;
}

type CoworkerAliasDatabase = {
  query: {
    coworkerEmailAlias: {
      findFirst: (args: unknown) => Promise<{
        id: string;
        localPart?: string;
        domain?: string;
        status?: "active" | "disabled" | "rotated" | "deleted";
        createdAt?: Date;
      } | null>;
    };
  };
  insert: (table: typeof coworkerEmailAlias) => {
    values: (values: Partial<typeof coworkerEmailAlias.$inferInsert>) => {
      onConflictDoNothing: (args: unknown) => {
        returning: (fields: unknown) => Promise<
          Array<{
            id: string;
            localPart: string;
            domain: string;
            status: "active" | "disabled" | "rotated" | "deleted";
            createdAt: Date;
          }>
        >;
      };
    };
  };
  update: (table: typeof coworkerEmailAlias) => {
    set: (values: Partial<typeof coworkerEmailAlias.$inferInsert>) => {
      where: (clause: unknown) => Promise<unknown>;
    };
  };
  transaction: <T>(callback: (tx: CoworkerAliasDatabase) => Promise<T>) => Promise<T>;
};

type CoworkerAliasRow = {
  id: string;
  triggerType: string;
};

type CoworkerAliasRecord = {
  id: string;
  localPart: string;
  domain: string;
  status: "active" | "disabled" | "rotated" | "deleted";
  createdAt: Date;
};

type CoworkerAliasOrderHelpers = {
  desc: (column: unknown) => unknown;
};

async function insertUniqueCoworkerAlias(params: {
  database: CoworkerAliasDatabase;
  coworkerId: string;
  domain: string;
  attempt?: number;
}): Promise<CoworkerAliasRecord | null> {
  const attempt = params.attempt ?? 0;
  if (attempt >= COWORKER_ALIAS_GENERATION_MAX_ATTEMPTS) {
    return null;
  }

  const localPart =
    attempt < COWORKER_ALIAS_GENERATION_MAX_ATTEMPTS / 2
      ? generateCoworkerAliasLocalPart()
      : `${generateCoworkerAliasLocalPart()}-${crypto.randomUUID().slice(0, 6)}`;
  const created = await params.database
    .insert(coworkerEmailAlias)
    .values({
      coworkerId: params.coworkerId,
      localPart,
      domain: params.domain,
      status: "active" as const,
    })
    .onConflictDoNothing({
      target: [coworkerEmailAlias.localPart, coworkerEmailAlias.domain],
    })
    .returning({
      id: coworkerEmailAlias.id,
      localPart: coworkerEmailAlias.localPart,
      domain: coworkerEmailAlias.domain,
      status: coworkerEmailAlias.status,
      createdAt: coworkerEmailAlias.createdAt,
    });

  if (created[0]) {
    return created[0];
  }

  return insertUniqueCoworkerAlias({
    ...params,
    attempt: attempt + 1,
  });
}

export async function getCoworkerForwardingAlias(input: {
  database: CoworkerAliasDatabase;
  coworker: CoworkerAliasRow;
}) {
  const receivingDomain = getReceivingDomain();
  if (!receivingDomain || input.coworker.triggerType !== EMAIL_FORWARDED_TRIGGER_TYPE) {
    return {
      receivingDomain,
      activeAlias: null,
      forwardingAddress: null,
    };
  }

  const activeAlias = await input.database.query.coworkerEmailAlias.findFirst({
    where: and(
      eq(coworkerEmailAlias.coworkerId, input.coworker.id),
      eq(coworkerEmailAlias.domain, receivingDomain),
      eq(coworkerEmailAlias.status, "active"),
    ),
    columns: {
      id: true,
      localPart: true,
      domain: true,
      status: true,
      createdAt: true,
    },
    orderBy: (
      row: typeof coworkerEmailAlias,
      { desc }: CoworkerAliasOrderHelpers,
    ) => [desc(row.createdAt)],
  });

  return {
    receivingDomain,
    activeAlias,
    forwardingAddress: activeAlias?.localPart
      ? buildCoworkerForwardingAddress(activeAlias.localPart, receivingDomain)
      : null,
  };
}

export async function createCoworkerForwardingAlias(input: {
  database: CoworkerAliasDatabase;
  coworker: CoworkerAliasRow;
}) {
  const receivingDomain = getReceivingDomain();
  if (!receivingDomain) {
    throw new ORPCError("BAD_REQUEST", {
      message: "RESEND_RECEIVING_DOMAIN is not configured",
    });
  }

  if (input.coworker.triggerType !== EMAIL_FORWARDED_TRIGGER_TYPE) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Coworker trigger must be email.forwarded to create an email alias",
    });
  }

  const existing = await input.database.query.coworkerEmailAlias.findFirst({
    where: and(
      eq(coworkerEmailAlias.coworkerId, input.coworker.id),
      eq(coworkerEmailAlias.domain, receivingDomain),
      eq(coworkerEmailAlias.status, "active"),
    ),
    columns: {
      id: true,
      localPart: true,
      domain: true,
      status: true,
      createdAt: true,
    },
    orderBy: (
      row: typeof coworkerEmailAlias,
      { desc }: CoworkerAliasOrderHelpers,
    ) => [desc(row.createdAt)],
  });

  if (existing?.localPart) {
    return {
      alias: existing,
      forwardingAddress: buildCoworkerForwardingAddress(existing.localPart, receivingDomain),
    };
  }

  const created = await insertUniqueCoworkerAlias({
    database: input.database,
    coworkerId: input.coworker.id,
    domain: receivingDomain,
  });

  if (created) {
    return {
      alias: created,
      forwardingAddress: buildCoworkerForwardingAddress(created.localPart, receivingDomain),
    };
  }

  throw new ORPCError("INTERNAL_SERVER_ERROR", {
    message: "Failed to create unique forwarding alias",
  });
}

export async function disableCoworkerForwardingAlias(input: {
  database: CoworkerAliasDatabase;
  coworker: CoworkerAliasRow;
}) {
  const activeAlias = await input.database.query.coworkerEmailAlias.findFirst({
    where: and(eq(coworkerEmailAlias.coworkerId, input.coworker.id), eq(coworkerEmailAlias.status, "active")),
    columns: { id: true },
    orderBy: (
      row: typeof coworkerEmailAlias,
      { desc }: CoworkerAliasOrderHelpers,
    ) => [desc(row.createdAt)],
  });

  if (!activeAlias) {
    return { success: true as const, disabled: false };
  }

  await input.database
    .update(coworkerEmailAlias)
    .set({
      status: "disabled",
      disabledAt: new Date(),
      disabledReason: "manual_disable",
    })
    .where(eq(coworkerEmailAlias.id, activeAlias.id));

  return { success: true as const, disabled: true };
}

export async function rotateCoworkerForwardingAlias(input: {
  database: CoworkerAliasDatabase;
  coworker: CoworkerAliasRow;
}) {
  const receivingDomain = getReceivingDomain();
  if (!receivingDomain) {
    throw new ORPCError("BAD_REQUEST", {
      message: "RESEND_RECEIVING_DOMAIN is not configured",
    });
  }

  if (input.coworker.triggerType !== EMAIL_FORWARDED_TRIGGER_TYPE) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Coworker trigger must be email.forwarded to rotate an email alias",
    });
  }

  const result = await input.database.transaction(async (tx) => {
    const currentActive = await tx.query.coworkerEmailAlias.findFirst({
      where: and(
        eq(coworkerEmailAlias.coworkerId, input.coworker.id),
        eq(coworkerEmailAlias.domain, receivingDomain),
        eq(coworkerEmailAlias.status, "active"),
      ),
      columns: { id: true, localPart: true },
      orderBy: (
        row: typeof coworkerEmailAlias,
        { desc }: CoworkerAliasOrderHelpers,
      ) => [desc(row.createdAt)],
    });

    const created = await insertUniqueCoworkerAlias({
      database: tx,
      coworkerId: input.coworker.id,
      domain: receivingDomain,
    });

    if (!created) {
      return null;
    }

    if (currentActive) {
      await tx
        .update(coworkerEmailAlias)
        .set({
          status: "rotated",
          disabledAt: new Date(),
          disabledReason: "rotated",
          replacedByAliasId: created.id,
        })
        .where(eq(coworkerEmailAlias.id, currentActive.id));
    }

    return created;
  });

  if (!result) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Failed to rotate forwarding alias",
    });
  }

  return {
    alias: result,
    forwardingAddress: buildCoworkerForwardingAddress(result.localPart, receivingDomain),
  };
}

function extractRecipientEmails(to: string[] | undefined): string[] {
  if (!Array.isArray(to)) {
    return [];
  }

  return to
    .map((entry) => extractEmailAddress(entry))
    .filter((email): email is string => typeof email === "string");
}

async function hasRunForEmailId(coworkerId: string, emailId: string): Promise<boolean> {
  const rows = await db
    .select({ id: coworkerRun.id })
    .from(coworkerRun)
    .where(
      and(
        eq(coworkerRun.coworkerId, coworkerId),
        sql`${coworkerRun.triggerPayload} ->> 'emailId' = ${emailId}`,
      ),
    )
    .limit(1);

  return rows.length > 0;
}

async function resolveCoworkerForUserAlias(userId: string): Promise<string | null> {
  const owner = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {
      id: true,
      defaultForwardedCoworkerId: true,
    },
  });

  if (!owner) {
    return null;
  }

  if (owner.defaultForwardedCoworkerId) {
    const selected = await db.query.coworker.findFirst({
      where: and(
        eq(coworker.id, owner.defaultForwardedCoworkerId),
        eq(coworker.ownerId, owner.id),
        eq(coworker.status, "on"),
        eq(coworker.triggerType, EMAIL_FORWARDED_TRIGGER_TYPE),
      ),
      columns: { id: true },
    });

    if (selected) {
      return selected.id;
    }
  }

  const candidates = await db.query.coworker.findMany({
    where: and(
      eq(coworker.ownerId, owner.id),
      eq(coworker.status, "on"),
      eq(coworker.triggerType, EMAIL_FORWARDED_TRIGGER_TYPE),
    ),
    columns: { id: true },
  });

  if (candidates.length !== 1) {
    return null;
  }

  return candidates[0].id;
}

async function resolveTargetCoworker(params: {
  recipients: string[];
  receivingDomain: string;
}): Promise<{ coworkerId: string; routingMode: "coworker_alias" | "user_alias" } | null> {
  const aliasTargets = new Set<string>();
  const userTargets = new Set<string>();

  for (const recipient of params.recipients) {
    const target = parseForwardingTargetFromEmail(recipient, params.receivingDomain);
    if (!target) {
      continue;
    }

    if (target.kind === "coworker_alias") {
      aliasTargets.add(target.localPart);
      continue;
    }

    userTargets.add(target.id);
  }

  const aliasMatches = await Promise.all(
    [...aliasTargets].map(async (localPart) => {
      const row = await db
        .select({ coworkerId: coworkerEmailAlias.coworkerId })
        .from(coworkerEmailAlias)
        .innerJoin(coworker, eq(coworker.id, coworkerEmailAlias.coworkerId))
        .where(
          and(
            eq(coworkerEmailAlias.localPart, localPart),
            eq(coworkerEmailAlias.domain, params.receivingDomain),
            eq(coworkerEmailAlias.status, "active"),
            eq(coworker.status, "on"),
            eq(coworker.triggerType, EMAIL_FORWARDED_TRIGGER_TYPE),
          ),
        )
        .limit(1);

      return row[0]?.coworkerId ?? null;
    }),
  );

  const resolvedCoworker = aliasMatches.find((id): id is string => typeof id === "string");
  if (resolvedCoworker) {
    return { coworkerId: resolvedCoworker, routingMode: "coworker_alias" };
  }

  const userMatches = await Promise.all(
    [...userTargets].map(async (userId) => {
      return resolveCoworkerForUserAlias(userId);
    }),
  );
  const resolvedFromUserAlias = userMatches.find((id): id is string => typeof id === "string");
  if (resolvedFromUserAlias) {
    return { coworkerId: resolvedFromUserAlias, routingMode: "user_alias" };
  }

  return null;
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!Array.isArray(headers)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const header of headers) {
    if (!header || typeof header !== "object") {
      continue;
    }

    const key =
      "name" in header && typeof (header as { name?: unknown }).name === "string"
        ? (header as { name: string }).name.toLowerCase()
        : null;
    const value =
      "value" in header && typeof (header as { value?: unknown }).value === "string"
        ? (header as { value: string }).value
        : null;

    if (!key || value === null) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

async function getReceivedEmailContent(emailId: string): Promise<{
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  attachmentCount: number;
}> {
  const resend = getResendClient();
  if (!resend) {
    throw new Error("Missing RESEND_API_KEY for receiving emails");
  }

  const { data, error } = await resend.emails.receiving.get(emailId);
  if (error) {
    throw new Error(error.message || "Failed to fetch received email body");
  }

  const text = typeof data?.text === "string" ? data.text : null;
  const html = typeof data?.html === "string" ? data.html : null;
  const headers = normalizeHeaders(data?.headers);
  const attachmentCount = Array.isArray(data?.attachments) ? data.attachments.length : 0;

  return { text, html, headers, attachmentCount };
}

export async function processForwardedEmailEvent(
  payload: ForwardedEmailQueuePayload,
): Promise<void> {
  const svixId = payload.webhookId ?? null;
  const eventType = payload.event.type;
  const emailId = payload.event.data?.email_id ?? null;
  console.info("[coworker-email-forwarding] processing event", {
    svixId,
    eventType,
    emailId,
  });

  if (payload.event.type !== RESEND_EMAIL_RECEIVED_EVENT) {
    console.info("[coworker-email-forwarding] ignored non-email.received event", {
      svixId,
      eventType,
    });
    return;
  }

  const receivedEmailId = payload.event.data?.email_id;
  if (!receivedEmailId) {
    console.warn("[coworker-email-forwarding] missing email_id", {
      svixId,
      eventType,
    });
    return;
  }

  const receivingDomain = getReceivingDomain();
  if (!receivingDomain) {
    console.error("[coworker-email-forwarding] missing RESEND_RECEIVING_DOMAIN");
    return;
  }

  const recipients = extractRecipientEmails(payload.event.data?.to);
  if (recipients.length === 0) {
    console.info("[coworker-email-forwarding] no recipient emails extracted", {
      svixId,
      emailId: receivedEmailId,
    });
    return;
  }

  const sender = extractEmailAddress(payload.event.data?.from);
  if (!sender) {
    console.info("[coworker-email-forwarding] missing sender email", {
      svixId,
      emailId: receivedEmailId,
    });
    return;
  }

  const target = await resolveTargetCoworker({ recipients, receivingDomain });
  if (!target) {
    console.info("[coworker-email-forwarding] no matching target coworker", {
      svixId,
      emailId: receivedEmailId,
      recipientCount: recipients.length,
      receivingDomain,
    });
    return;
  }

  const alreadyHandled = await hasRunForEmailId(target.coworkerId, receivedEmailId);
  if (alreadyHandled) {
    console.info("[coworker-email-forwarding] duplicate email ignored", {
      svixId,
      emailId: receivedEmailId,
      coworkerId: target.coworkerId,
    });
    return;
  }

  const content = await getReceivedEmailContent(receivedEmailId);
  console.info("[coworker-email-forwarding] triggering coworker run", {
    svixId,
    emailId: receivedEmailId,
    coworkerId: target.coworkerId,
    routingMode: target.routingMode,
  });

  await triggerCoworkerRun({
    coworkerId: target.coworkerId,
    startKind: "external_trigger",
    triggerPayload: {
      source: EMAIL_FORWARDED_TRIGGER_TYPE,
      routingMode: target.routingMode,
      coworkerId: target.coworkerId,
      emailId: receivedEmailId,
      messageId: payload.event.data?.message_id ?? null,
      from: sender,
      to: recipients,
      subject: payload.event.data?.subject ?? null,
      createdAt:
        payload.event.data?.created_at ?? payload.event.created_at ?? new Date().toISOString(),
      text: content.text,
      html: content.html,
      headers: content.headers,
      attachmentCount: content.attachmentCount,
      resendWebhookId: payload.webhookId ?? null,
    },
  });
  console.info("[coworker-email-forwarding] coworker run trigger completed", {
    svixId,
    emailId: receivedEmailId,
    coworkerId: target.coworkerId,
  });
}
