type Args = {
  encoded?: string;
};

function usage(): string {
  return `Usage:
  bun run decrypt -- <encrypted-string>
  echo <encrypted-string> | bun run decrypt

Options:
  -h, --help          Show this help text.`;
}

function parseArgs(argv: string[]): Args {
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    }
  }

  if (argv.length > 1) {
    throw new Error("Pass one encrypted string, or pipe it through stdin");
  }

  return { encoded: argv[0] };
}

async function readEncryptedInput(encoded?: string): Promise<string> {
  const input = encoded ?? (await new Response(Bun.stdin.stream()).text());
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Pass an encrypted string or pipe one through stdin");
  }

  return trimmed;
}

async function main(): Promise<void> {
  process.env.SKIP_ENV_VALIDATION = "1";
  const { decrypt } = await import("../packages/core/src/server/utils/encryption");
  const args = parseArgs(process.argv.slice(2));
  const decrypted = decrypt(await readEncryptedInput(args.encoded));

  process.stdout.write(decrypted);
  if (!decrypted.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage());
  process.exit(1);
});
