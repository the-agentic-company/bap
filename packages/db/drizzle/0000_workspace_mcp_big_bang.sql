-- Big Bang replacement of Executor sources with Workspace MCP Servers.
-- Custom Executor/OpenAPI rows are intentionally deleted. Managed Galien and
-- Modulr MCP rows are retained under the new physical schema names.

DO $$
BEGIN
  IF to_regclass('public.workspace_executor_source_credential') IS NOT NULL
     AND to_regclass('public.workspace_executor_source') IS NOT NULL THEN
    DELETE FROM workspace_executor_source_credential credential
    WHERE NOT EXISTS (
      SELECT 1
      FROM workspace_executor_source source
      WHERE source.id = credential.workspace_executor_source_id
        AND source.kind::text = 'mcp'
        AND source.internal_key IN ('galien', 'modulr')
    );
  END IF;

  IF to_regclass('public.workspace_executor_source') IS NOT NULL THEN
    DELETE FROM workspace_executor_source
    WHERE kind::text <> 'mcp'
       OR internal_key IS NULL
       OR internal_key NOT IN ('galien', 'modulr');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_mcp_server_kind') THEN
    CREATE TYPE workspace_mcp_server_kind AS ENUM ('mcp');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_mcp_server_auth_type') THEN
    CREATE TYPE workspace_mcp_server_auth_type AS ENUM ('none', 'api_key', 'bearer', 'oauth2');
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.workspace_executor_source') IS NOT NULL
     AND to_regclass('public.workspace_mcp_server') IS NULL THEN
    ALTER TABLE workspace_executor_source RENAME TO workspace_mcp_server;
  END IF;

  IF to_regclass('public.workspace_executor_source_credential') IS NOT NULL
     AND to_regclass('public.workspace_mcp_authorization') IS NULL THEN
    ALTER TABLE workspace_executor_source_credential RENAME TO workspace_mcp_authorization;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_mcp_authorization'
      AND column_name = 'workspace_executor_source_id'
  ) THEN
    ALTER TABLE workspace_mcp_authorization
      RENAME COLUMN workspace_executor_source_id TO workspace_mcp_server_id;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.workspace_mcp_server') IS NOT NULL THEN
    ALTER TABLE workspace_mcp_server
      ALTER COLUMN kind TYPE text USING kind::text;

    ALTER TABLE workspace_mcp_server
      ALTER COLUMN kind TYPE workspace_mcp_server_kind USING kind::workspace_mcp_server_kind;

    ALTER TABLE workspace_mcp_server
      ALTER COLUMN auth_type TYPE text USING auth_type::text;

    ALTER TABLE workspace_mcp_server
      ALTER COLUMN auth_type TYPE workspace_mcp_server_auth_type USING auth_type::workspace_mcp_server_auth_type;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'executor_source_kind') THEN
    DROP TYPE executor_source_kind;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'executor_source_auth_type') THEN
    DROP TYPE executor_source_auth_type;
  END IF;
END $$;

ALTER INDEX IF EXISTS workspace_executor_source_workspace_idx
  RENAME TO workspace_mcp_server_workspace_idx;
ALTER INDEX IF EXISTS workspace_executor_source_created_by_idx
  RENAME TO workspace_mcp_server_created_by_idx;
ALTER INDEX IF EXISTS workspace_executor_source_workspace_namespace_idx
  RENAME TO workspace_mcp_server_workspace_namespace_idx;
ALTER INDEX IF EXISTS workspace_executor_source_credential_user_idx
  RENAME TO workspace_mcp_authorization_user_idx;
ALTER INDEX IF EXISTS workspace_executor_source_credential_source_idx
  RENAME TO workspace_mcp_authorization_server_idx;
ALTER INDEX IF EXISTS workspace_executor_source_credential_user_source_idx
  RENAME TO workspace_mcp_authorization_user_server_idx;
