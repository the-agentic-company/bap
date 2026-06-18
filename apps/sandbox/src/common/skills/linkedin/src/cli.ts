import { parseArgs } from "util";
import type { CliValues, OperationContext } from "./context";
import {
  getChat,
  listChats,
  listMessages,
  sendMessage,
  startChat,
} from "./messaging";
import { getCompanyProfile, getMyProfile, getProfile, searchUsers } from "./profiles";
import {
  listConnections,
  listPendingInvitations,
  removeConnection,
  sendInvitation,
} from "./network";
import {
  commentOnPost,
  createCompanyPost,
  createPost,
  getPost,
  listCompanyPosts,
  listPostComments,
  listPosts,
  reactToPost,
} from "./posts";

/** Parse the LinkedIn CLI argv into positionals + typed flag values. */
export function parseLinkedInArgs(argv: string[]): {
  command?: string;
  subcommand?: string;
  args: string[];
  values: CliValues;
} {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      limit: { type: "string", short: "l", default: "20" },
      text: { type: "string", short: "t" },
      query: { type: "string", short: "q" },
      message: { type: "string", short: "m" },
      profile: { type: "string", short: "p" },
      type: { type: "string" },
      visibility: { type: "string", default: "PUBLIC" },
      cursor: { type: "string" },
      "comment-id": { type: "string" },
      "sort-by": { type: "string" },
    },
  });

  const [command, subcommand, ...args] = positionals;
  return { command, subcommand, args, values };
}

export function showHelp(): void {
  console.log(`LinkedIn CLI (via Unipile) - Commands:

MESSAGING
  linkedin chats list [-l limit]                      List conversations
  linkedin chats get <chatId>                         Get conversation details
  linkedin messages list <chatId> [-l limit]          List messages in chat
  linkedin messages send <chatId> --text <message>    Send message
  linkedin messages start <profileId> --text <msg>    Start new conversation

PROFILES
  linkedin profile me                                 Get my profile
  linkedin profile get <identifier>                   Get user profile (URL or ID)
  linkedin profile company <identifier>               Get company profile
  linkedin search -q <query> [-l limit]               Search for people

INVITATIONS & CONNECTIONS
  linkedin invite send <profileId> [--message <m>]    Send connection request
  linkedin invite list                                List pending invitations
  linkedin connections list [-l limit]                List my connections
  linkedin connections remove <profileId>             Remove connection

POSTS & CONTENT
  linkedin posts list [--profile <id>] [-l limit]     List posts
  linkedin posts get <postId>                         Get post details
  linkedin posts comments <postId> [-l limit]         List post comments
  linkedin posts create --text <content>              Create a post
  linkedin posts comment <postId> --text <comment>    Comment on post
    Add --comment-id <id> to reply to a specific comment
  linkedin posts react <postId> --type <LIKE|...>     React to post
    Reaction types: LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY

COMPANY PAGES
  linkedin company posts <companyId> [-l limit]       List company posts
  linkedin company post <companyId> --text <text>     Post as company (if admin)

Options:
  -h, --help                                          Show this help message
  -l, --limit <n>                                     Limit results (default: 20)
  -t, --text <text>                                   Text content
  -q, --query <query>                                 Search query
  -m, --message <msg>                                 Message text
  --profile <id>                                      Profile identifier
  --comment-id <id>                                   Comment identifier for replies/thread replies
  --sort-by <MOST_RECENT|MOST_RELEVANT>               Comment sort order
  --type <type>                                       Reaction type
  --visibility <PUBLIC|CONNECTIONS>                   Post visibility`);
}

function requireArg(value: string | undefined, errorMessage: string): string {
  if (!value) {
    console.error(errorMessage);
    process.exit(1);
  }
  return value;
}

/** Route a parsed command to its operation handler. Mirrors the legacy switch exactly. */
export async function runCommand(
  ctx: OperationContext,
  command: string,
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  const { values } = ctx;

  switch (command) {
    case "chats":
      switch (subcommand) {
        case "list":
          await listChats(ctx);
          break;
        case "get":
          await getChat(ctx, requireArg(args[0], "Error: Chat ID required"));
          break;
        default:
          unknownSubcommand("chats", subcommand);
      }
      break;

    case "messages":
      switch (subcommand) {
        case "list":
          await listMessages(ctx, requireArg(args[0], "Error: Chat ID required"));
          break;
        case "send":
          requireArg(values.text, "Error: Chat ID and --text required");
          await sendMessage(
            ctx,
            requireArg(args[0], "Error: Chat ID and --text required"),
            values.text!,
          );
          break;
        case "start":
          requireArg(values.text, "Error: Profile ID and --text required");
          await startChat(
            ctx,
            requireArg(args[0], "Error: Profile ID and --text required"),
            values.text!,
          );
          break;
        default:
          unknownSubcommand("messages", subcommand);
      }
      break;

    case "profile":
      switch (subcommand) {
        case "me":
          await getMyProfile(ctx);
          break;
        case "get":
          await getProfile(ctx, requireArg(args[0], "Error: Profile identifier required"));
          break;
        case "company":
          await getCompanyProfile(ctx, requireArg(args[0], "Error: Company identifier required"));
          break;
        default:
          unknownSubcommand("profile", subcommand);
      }
      break;

    case "search":
      requireArg(values.query, "Error: --query required");
      await searchUsers(ctx, values.query!);
      break;

    case "invite":
      switch (subcommand) {
        case "send":
          await sendInvitation(
            ctx,
            requireArg(args[0], "Error: Profile ID required"),
            values.message,
          );
          break;
        case "list":
          await listPendingInvitations(ctx);
          break;
        default:
          unknownSubcommand("invite", subcommand);
      }
      break;

    case "connections":
      switch (subcommand) {
        case "list":
          await listConnections(ctx);
          break;
        case "remove":
          await removeConnection(ctx, requireArg(args[0], "Error: Profile ID required"));
          break;
        default:
          unknownSubcommand("connections", subcommand);
      }
      break;

    case "posts":
      await runPostsCommand(ctx, subcommand, args);
      break;

    case "company":
      switch (subcommand) {
        case "posts":
          await listCompanyPosts(ctx, requireArg(args[0], "Error: Company ID required"));
          break;
        case "post":
          requireArg(values.text, "Error: Company ID and --text required");
          await createCompanyPost(
            ctx,
            requireArg(args[0], "Error: Company ID and --text required"),
            values.text!,
          );
          break;
        default:
          unknownSubcommand("company", subcommand);
      }
      break;

    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
  }
}

async function runPostsCommand(
  ctx: OperationContext,
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  const { values } = ctx;

  switch (subcommand) {
    case "list":
      await listPosts(ctx, values.profile);
      break;
    case "get":
      await getPost(ctx, requireArg(args[0], "Error: Post ID required"));
      break;
    case "comments":
      await listPostComments(
        ctx,
        requireArg(args[0], "Error: Post ID required"),
        values["comment-id"],
      );
      break;
    case "create":
      requireArg(values.text, "Error: --text required");
      await createPost(ctx, values.text!, values.visibility);
      break;
    case "comment":
      requireArg(values.text, "Error: Post ID and --text required");
      await commentOnPost(
        ctx,
        requireArg(args[0], "Error: Post ID and --text required"),
        values.text!,
        values["comment-id"],
      );
      break;
    case "react":
      requireArg(values.type, "Error: Post ID and --type required");
      await reactToPost(
        ctx,
        requireArg(args[0], "Error: Post ID and --type required"),
        values.type!,
      );
      break;
    default:
      unknownSubcommand("posts", subcommand);
  }
}

function unknownSubcommand(command: string, subcommand: string | undefined): void {
  console.error(`Unknown ${command} subcommand: ${subcommand}`);
  showHelp();
}
