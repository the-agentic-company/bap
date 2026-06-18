import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLinkedInArgs, runCommand, showHelp } from "./cli";
import { createDirectory } from "./directory";
import { createUnipileClient } from "./unipile-client";

// Re-exported for the colocated unit tests (the stable pure test surface).
export {
  buildUnipileBaseUrl,
  normalizeLinkedInCompanyIdentifier,
  normalizeLinkedInProfileIdentifier,
} from "./identifiers";

function ensureConfigured(isConfigured: boolean): void {
  if (isConfigured) {
    return;
  }
  console.error(
    "Error: UNIPILE_API_KEY, UNIPILE_DSN, and LINKEDIN_ACCOUNT_ID environment variables required",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const { command, subcommand, args, values } = parseLinkedInArgs(process.argv.slice(2));

  if (values.help || !command) {
    showHelp();
    return;
  }

  const client = createUnipileClient({
    apiKey: process.env.UNIPILE_API_KEY ?? "",
    dsn: process.env.UNIPILE_DSN ?? "",
    accountId: process.env.LINKEDIN_ACCOUNT_ID ?? "",
  });
  ensureConfigured(client.isConfigured());

  const directory = createDirectory(client);

  try {
    await runCommand({ client, directory, values }, command, subcommand, args);
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          error: true,
          message: error instanceof Error ? error.message : "Unknown error",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

const isMainModule = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  main();
}
