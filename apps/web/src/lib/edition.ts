import { getEditionCapabilities } from "@cmdclaw/core/lib/edition";
import { env } from "@/env";

const clientEdition = env.VITE_APP_EDITION ?? "cloud";
export const clientEditionCapabilities = getEditionCapabilities(clientEdition);
