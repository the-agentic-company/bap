import type { RuntimeEvent } from "../core/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toRuntimeEvent(event: unknown): RuntimeEvent | null {
  if (!isRecord(event) || typeof event.type !== "string") {
    return null;
  }

  const properties = isRecord(event.properties) ? event.properties : {};

  switch (event.type) {
    case "server.connected":
    case "session.idle":
      return { type: event.type, properties };
    case "session.status":
      return {
        type: "session.status",
        properties: properties as RuntimeEvent["properties"],
      };
    case "session.error":
      return {
        type: "session.error",
        properties: properties as RuntimeEvent["properties"],
      };
    case "session.updated":
    case "message.updated":
    case "message.part.updated":
    case "permission.asked":
    case "question.asked":
      return {
        type: event.type,
        properties: properties as RuntimeEvent["properties"],
      } as RuntimeEvent;
    default:
      return null;
  }
}

export async function* mapRuntimeEventStream(
  stream: AsyncIterable<unknown>,
): AsyncIterable<RuntimeEvent> {
  for await (const event of stream) {
    const mapped = toRuntimeEvent(event);
    if (mapped) {
      yield mapped;
    }
  }
}
