ALTER TABLE hosted_mcp_oauth_grant
  ADD COLUMN IF NOT EXISTS allowed_workspace_ids text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE hosted_mcp_oauth_grant
  ADD COLUMN IF NOT EXISTS allow_all_workspaces boolean NOT NULL DEFAULT false;
