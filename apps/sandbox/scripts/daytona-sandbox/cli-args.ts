/**
 * Command-line argument grammar for the Daytona sandbox helper.
 *
 * Owns the full surface a caller must know to drive the script from argv:
 * the parsed shape, the default create-mode identity, and how create vs.
 * attach mode is selected.
 */

export const DEFAULT_CREATE_USER_EMAIL =
  process.env.BAP_DEFAULT_USER_EMAIL?.trim() || "bap@example.com";
export const DEFAULT_CREATE_WORKSPACE_SLUG = "concentrix-c1e27b8c";

export type ParsedArgs = {
  sandboxId?: string;
  conversationId?: string;
  runId?: string;
  builderCoworkerId?: string;
  userEmail: string;
  workspaceSlug: string;
  help: boolean;
};

function requireArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    userEmail: DEFAULT_CREATE_USER_EMAIL,
    workspaceSlug: DEFAULT_CREATE_WORKSPACE_SLUG,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "--sandbox-id":
        args.sandboxId = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--conversation-id":
        args.conversationId = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--run-id":
        args.runId = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--builder-coworker-id":
        args.builderCoworkerId = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--user-email":
        args.userEmail = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--workspace-slug":
        args.workspaceSlug = requireArgValue(argv, i + 1, arg);
        i += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const attachSelectors = [
    args.sandboxId,
    args.conversationId,
    args.runId,
    args.builderCoworkerId,
  ].filter((value): value is string => Boolean(value));

  if (attachSelectors.length > 1) {
    throw new Error(
      "Use only one attach selector: --sandbox-id, --conversation-id, --run-id, or --builder-coworker-id.",
    );
  }

  return args;
}

export function printUsage(): void {
  console.log(`
Usage:
  bun run daytona:sandbox
  bun run daytona:sandbox -- --workspace-slug <workspace-slug>
  bun run daytona:sandbox -- --sandbox-id <sandbox-id>
  bun run daytona:sandbox -- --conversation-id <conversation-id>
  bun run daytona:sandbox -- --run-id <coworker-run-id>
  bun run daytona:sandbox -- --builder-coworker-id <coworker-id>

Options:
  --workspace-slug <slug>     Workspace slug to bootstrap in create mode
  --sandbox-id <id>           Attach directly to an existing Daytona sandbox
  --conversation-id <id>      Attach via a chat or coworker conversation runtime
  --run-id <id>               Attach via a coworker run
  --builder-coworker-id <id>  Attach via a coworker builder conversation
  --user-email <email>        User email for create mode token injection
  --help                      Show this help
`);
}

export function isAttachMode(args: ParsedArgs): boolean {
  return Boolean(args.sandboxId || args.conversationId || args.runId || args.builderCoworkerId);
}
