import { getEditionCapabilities } from "@cmdclaw/core/lib/edition";
import { env } from "@/env";

const clientEdition = env.VITE_CMDCLAW_EDITION ?? "cloud";
export const clientEditionCapabilities = getEditionCapabilities(clientEdition);
