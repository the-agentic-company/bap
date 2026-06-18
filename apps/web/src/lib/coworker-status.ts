export function getCoworkerRunStatusLabel(status: string): string {
  switch (status) {
    case "needs_user_input":
      return "Needs your input";
    case "awaiting_approval":
      return "Awaiting approval";
    case "awaiting_auth":
      return "Awaiting auth";
    case "paused":
      return "Needs continuation";
    case "cancelling":
      return "Cancelling";
    default:
      return status.replaceAll("_", " ");
  }
}
