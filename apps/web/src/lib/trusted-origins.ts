import { env } from "@/env";

const localhostPort = process.env.PORT ?? 3000;

export function getTrustedOrigins(): string[] {
  return Array.from(
    new Set(
      [
        env.APP_URL,
        env.NEXT_PUBLIC_APP_URL,
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
