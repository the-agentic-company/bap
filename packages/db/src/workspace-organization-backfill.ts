import { sql } from "drizzle-orm";
import { closePool, db } from "./client";

type SqlExecutor = {
  execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown>;
};

export const workspaceOrganizationBackfillSql = [
  `
DO $$
BEGIN
  IF to_regclass('public.workspace') IS NOT NULL
     AND to_regclass('public.legacy_workspace') IS NULL THEN
    CREATE TABLE legacy_workspace AS TABLE workspace WITH DATA;
  END IF;

  IF to_regclass('public.workspace_member') IS NOT NULL
     AND to_regclass('public.legacy_workspace_member') IS NULL THEN
    CREATE TABLE legacy_workspace_member AS TABLE workspace_member WITH DATA;
    ALTER TABLE legacy_workspace_member ALTER COLUMN role TYPE text USING role::text;
  END IF;
END $$;
`,
  `
DO $$
BEGIN
  IF to_regclass('public.workspace') IS NOT NULL
     AND to_regclass('public.organization') IS NULL THEN
    ALTER TABLE workspace RENAME TO organization;
  END IF;

  IF to_regclass('public.workspace_member') IS NOT NULL
     AND to_regclass('public.member') IS NULL THEN
    ALTER TABLE workspace_member RENAME TO member;
  END IF;
END $$;
`,
  `
DO $$
BEGIN
  IF to_regclass('public.organization') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.organization'::regclass
        AND conname = 'workspace_pkey'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.organization'::regclass
        AND conname = 'organization_pkey'
    ) THEN
      ALTER TABLE organization RENAME CONSTRAINT workspace_pkey TO organization_pkey;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.organization'::regclass
        AND conname = 'workspace_slug_unique'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.organization'::regclass
        AND conname = 'organization_slug_unique'
    ) THEN
      ALTER TABLE organization RENAME CONSTRAINT workspace_slug_unique TO organization_slug_unique;
    END IF;

    ALTER TABLE organization ADD COLUMN IF NOT EXISTS logo text;
    ALTER TABLE organization ADD COLUMN IF NOT EXISTS metadata text;
    ALTER TABLE organization ADD COLUMN IF NOT EXISTS billing_plan_id text DEFAULT 'free' NOT NULL;
    ALTER TABLE organization ADD COLUMN IF NOT EXISTS autumn_customer_id text;
    ALTER TABLE organization ADD COLUMN IF NOT EXISTS image_storage_key text;
    ALTER TABLE organization ADD COLUMN IF NOT EXISTS image_mime_type text;
    ALTER TABLE organization ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now() NOT NULL;
    ALTER TABLE organization ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now() NOT NULL;

    UPDATE organization
    SET slug = left(
      trim(both '-' from regexp_replace(lower(coalesce(nullif(name, ''), id)), '[^a-z0-9]+', '-', 'g')),
      48
    ) || '-' || left(id, 8)
    WHERE slug IS NULL OR slug = '';

    ALTER TABLE organization ALTER COLUMN slug SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.organization'::regclass
        AND conname = 'organization_slug_unique'
    ) THEN
      ALTER TABLE organization ADD CONSTRAINT organization_slug_unique UNIQUE (slug);
    END IF;

    ALTER TABLE organization DROP COLUMN IF EXISTS created_by_user_id;
  END IF;
END $$;
`,
  `
DO $$
BEGIN
  IF to_regclass('public.legacy_workspace_member') IS NOT NULL THEN
    ALTER TABLE legacy_workspace_member ALTER COLUMN role TYPE text USING role::text;
  END IF;

  IF to_regclass('public.member') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.member'::regclass
        AND conname = 'workspace_member_pkey'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.member'::regclass
        AND conname = 'member_pkey'
    ) THEN
      ALTER TABLE member RENAME CONSTRAINT workspace_member_pkey TO member_pkey;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'member'
        AND column_name = 'workspace_id'
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'member'
        AND column_name = 'organization_id'
    ) THEN
      ALTER TABLE member RENAME COLUMN workspace_id TO organization_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.member'::regclass
        AND conname = 'workspace_member_workspace_id_workspace_id_fk'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.member'::regclass
        AND conname = 'member_organization_id_organization_id_fk'
    ) THEN
      ALTER TABLE member
      RENAME CONSTRAINT workspace_member_workspace_id_workspace_id_fk
      TO member_organization_id_organization_id_fk;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.member'::regclass
        AND conname = 'workspace_member_user_id_user_id_fk'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.member'::regclass
        AND conname = 'member_user_id_user_id_fk'
    ) THEN
      ALTER TABLE member
      RENAME CONSTRAINT workspace_member_user_id_user_id_fk
      TO member_user_id_user_id_fk;
    END IF;

    ALTER TABLE member ALTER COLUMN role TYPE text USING role::text;
    ALTER TABLE member ALTER COLUMN role SET DEFAULT 'member';
    ALTER TABLE member DROP COLUMN IF EXISTS updated_at;
  END IF;
END $$;
`,
  `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_depend dependency
    JOIN pg_type type ON type.oid = dependency.refobjid
    WHERE type.typname = 'workspace_membership_role'
      AND dependency.deptype IN ('a', 'n')
  ) THEN
    DROP TYPE IF EXISTS workspace_membership_role;
  END IF;
END $$;
`,
  `
DO $$
BEGIN
  IF to_regclass('public.member') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "member_organizationId_idx" ON member (organization_id);
    CREATE INDEX IF NOT EXISTS "member_userId_idx" ON member (user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS member_organization_user_uidx ON member (organization_id, user_id);
  END IF;

  IF to_regclass('public.organization') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS organization_slug_uidx ON organization (slug);
  END IF;
END $$;
`,
  `
DO $$
BEGIN
  IF to_regclass('public.organization') IS NOT NULL
     AND to_regclass('public.invitation') IS NULL THEN
    CREATE TABLE invitation (
      id text PRIMARY KEY,
      organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      email text NOT NULL,
      role text,
      status text NOT NULL DEFAULT 'pending',
      expires_at timestamp NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      inviter_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
    );
  END IF;

  IF to_regclass('public.invitation') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON invitation (organization_id);
    CREATE INDEX IF NOT EXISTS invitation_email_idx ON invitation (email);
  END IF;
END $$;
`,
  `
ALTER TABLE session ADD COLUMN IF NOT EXISTS active_organization_id text;

UPDATE session
SET active_organization_id = "user".active_workspace_id
FROM "user"
WHERE session.user_id = "user".id
  AND session.active_organization_id IS NULL
  AND "user".active_workspace_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM member
    WHERE member.user_id = "user".id
      AND member.organization_id = "user".active_workspace_id
  );
`,
];

export const workspaceOrganizationBackfillStatements = workspaceOrganizationBackfillSql.map(
  (statement) => sql.raw(statement),
);

export async function backfillWorkspacesToOrganizations(executor: SqlExecutor = db) {
  for (const statement of workspaceOrganizationBackfillStatements) {
    await executor.execute(statement);
  }
}

if (process.argv[1]?.endsWith("workspace-organization-backfill.ts")) {
  try {
    await backfillWorkspacesToOrganizations();
    console.log("Workspace organization backfill completed.");
  } finally {
    await closePool();
  }
}
