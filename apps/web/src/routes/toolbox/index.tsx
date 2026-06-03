import { createFileRoute } from "@tanstack/react-router";
import { ToolboxPage } from "./-components/toolbox-page";

/**
 * /toolbox — data source / integrations / skills landing grid (was src/app/toolbox/page.tsx).
 * Protected by the parent /toolbox layout `beforeLoad` guard.
 *
 * Behavior-affecting search params are validated at the boundary: `preview` (modal preview
 * IDs), `account_id` (LinkedIn account link callback), and the OAuth completion flags
 * `success` / `error`.
 */
type ToolboxSearch = {
  preview?: string;
  account_id?: string;
  success?: string;
  error?: string;
};

export const Route = createFileRoute("/toolbox/")({
  validateSearch: (search: Record<string, unknown>): ToolboxSearch => {
    const str = (key: string): string | undefined =>
      typeof search[key] === "string" ? (search[key] as string) : undefined;
    const preview = str("preview");
    const accountId = str("account_id");
    const success = str("success");
    const error = str("error");
    return {
      ...(preview ? { preview } : {}),
      ...(accountId ? { account_id: accountId } : {}),
      ...(success ? { success } : {}),
      ...(error ? { error } : {}),
    };
  },
  head: () => ({ meta: [{ title: "Toolbox - CmdClaw" }] }),
  component: ToolboxPage,
});
