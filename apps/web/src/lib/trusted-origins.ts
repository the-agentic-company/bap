import { env } from "@/env";

const localhostPort = process.env.PORT ?? 3000;
const BAP_ORIGINS = ["https://heybap.com", "https://www.heybap.com", "https://mcp.heybap.com"];

export function getTrustedOrigins(): string[] {
  return Array.from(
    new Set(
      [
        env.APP_URL,
        env.VITE_APP_URL,
        ...BAP_ORIGINS,
        "https://appleid.apple.com",
        "https://cmdclaw.ai",
        "https://www.cmdclaw.ai",
        "http://100.110.245.77:3000",
        `http://localhost:${localhostPort}`,
        `http://127.0.0.1:${localhostPort}`,
        "https://localcan.baptistecolle.com",
        "cmdclaw://",
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}
