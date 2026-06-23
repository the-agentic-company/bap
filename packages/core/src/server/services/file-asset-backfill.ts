import { sql, type SQL } from "drizzle-orm";
import {
  conversation,
  coworker,
  coworkerDocument,
  fileAsset,
  fileAssetReference,
  message,
  messageAttachment,
  sandboxFile,
  skill,
  skillDocument,
} from "@bap/db/schema";

type Database = typeof import("@bap/db/client").db;

export type FileAssetBackfillTable =
  | "message_attachment"
  | "coworker_document"
  | "skill_document"
  | "sandbox_file";

export type FileAssetBackfillTableResult = {
  table: FileAssetBackfillTable;
  eligibleRows: number;
  insertedFileAssets: number;
  updatedRows: number;
  insertedReferences: number;
};

export type FileAssetBackfillResult = {
  dryRun: boolean;
  tables: FileAssetBackfillTableResult[];
  totals: Omit<FileAssetBackfillTableResult, "table">;
};

type QueryResultRow = {
  eligible_rows?: unknown;
  inserted_file_assets?: unknown;
  updated_rows?: unknown;
  inserted_references?: unknown;
};

type BackfillStatement = {
  table: FileAssetBackfillTable;
  statement: SQL;
};

function numberFromRow(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readSingleCountRow(result: unknown): QueryResultRow {
  const rows = (result as { rows?: QueryResultRow[] } | undefined)?.rows;
  return rows?.[0] ?? {};
}

function toTableResult(table: FileAssetBackfillTable, result: unknown): FileAssetBackfillTableResult {
  const row = readSingleCountRow(result);
  return {
    table,
    eligibleRows: numberFromRow(row.eligible_rows),
    insertedFileAssets: numberFromRow(row.inserted_file_assets),
    updatedRows: numberFromRow(row.updated_rows),
    insertedReferences: numberFromRow(row.inserted_references),
  };
}

function sumResults(tables: FileAssetBackfillTableResult[]): FileAssetBackfillResult["totals"] {
  return tables.reduce(
    (totals, table) => ({
      eligibleRows: totals.eligibleRows + table.eligibleRows,
      insertedFileAssets: totals.insertedFileAssets + table.insertedFileAssets,
      updatedRows: totals.updatedRows + table.updatedRows,
      insertedReferences: totals.insertedReferences + table.insertedReferences,
    }),
    {
      eligibleRows: 0,
      insertedFileAssets: 0,
      updatedRows: 0,
      insertedReferences: 0,
    },
  );
}

function buildApplyStatements(): BackfillStatement[] {
  return [
    {
      table: "message_attachment",
      statement: sql`
        with candidates as (
          select
            attachment.id as reference_id,
            conv.workspace_id,
            conv.user_id as created_by_user_id,
            attachment.filename,
            attachment.mime_type,
            attachment.size_bytes,
            attachment.storage_key
          from ${messageAttachment} as attachment
          inner join ${message} as msg on msg.id = attachment.message_id
          inner join ${conversation} as conv on conv.id = msg.conversation_id
          where attachment.file_asset_id is null
            and conv.workspace_id is not null
            and attachment.storage_key is not null
            and attachment.size_bytes is not null
        ),
        inserted_assets as (
          insert into ${fileAsset} (
            id,
            workspace_id,
            created_by_user_id,
            filename,
            mime_type,
            size_bytes,
            storage_key,
            status
          )
          select
            'legacy-file-asset:' || md5(storage_key),
            workspace_id,
            created_by_user_id,
            filename,
            mime_type,
            size_bytes,
            storage_key,
            'ready'
          from candidates
          on conflict (storage_key) do nothing
          returning id, storage_key
        ),
        asset_links as (
          select id, storage_key from inserted_assets
          union
          select asset.id, asset.storage_key
          from ${fileAsset} as asset
          inner join candidates on candidates.storage_key = asset.storage_key
        ),
        updated_rows as (
          update ${messageAttachment} as attachment
          set file_asset_id = asset.id
          from candidates
          inner join asset_links as asset on asset.storage_key = candidates.storage_key
          where attachment.id = candidates.reference_id
            and attachment.file_asset_id is null
          returning attachment.id, attachment.file_asset_id
        ),
        inserted_references as (
          insert into ${fileAssetReference} (id, file_asset_id, kind, reference_id)
          select
            'legacy-file-asset-reference:' ||
              md5(concat('message_attachment:', updated_rows.id, ':', updated_rows.file_asset_id)),
            updated_rows.file_asset_id,
            'message_attachment',
            updated_rows.id
          from updated_rows
          on conflict do nothing
          returning id
        )
        select
          (select count(*) from candidates) as eligible_rows,
          (select count(*) from inserted_assets) as inserted_file_assets,
          (select count(*) from updated_rows) as updated_rows,
          (select count(*) from inserted_references) as inserted_references
      `,
    },
    {
      table: "coworker_document",
      statement: sql`
        with candidates as (
          select
            document.id as reference_id,
            wf.workspace_id,
            wf.owner_id as created_by_user_id,
            document.filename,
            document.mime_type,
            document.size_bytes,
            document.storage_key
          from ${coworkerDocument} as document
          inner join ${coworker} as wf on wf.id = document.coworker_id
          where document.file_asset_id is null
            and wf.workspace_id is not null
            and document.storage_key is not null
            and document.size_bytes is not null
        ),
        inserted_assets as (
          insert into ${fileAsset} (
            id,
            workspace_id,
            created_by_user_id,
            filename,
            mime_type,
            size_bytes,
            storage_key,
            status
          )
          select
            'legacy-file-asset:' || md5(storage_key),
            workspace_id,
            created_by_user_id,
            filename,
            mime_type,
            size_bytes,
            storage_key,
            'ready'
          from candidates
          on conflict (storage_key) do nothing
          returning id, storage_key
        ),
        asset_links as (
          select id, storage_key from inserted_assets
          union
          select asset.id, asset.storage_key
          from ${fileAsset} as asset
          inner join candidates on candidates.storage_key = asset.storage_key
        ),
        updated_rows as (
          update ${coworkerDocument} as document
          set file_asset_id = asset.id
          from candidates
          inner join asset_links as asset on asset.storage_key = candidates.storage_key
          where document.id = candidates.reference_id
            and document.file_asset_id is null
          returning document.id, document.file_asset_id
        ),
        inserted_references as (
          insert into ${fileAssetReference} (id, file_asset_id, kind, reference_id)
          select
            'legacy-file-asset-reference:' ||
              md5(concat('coworker_document:', updated_rows.id, ':', updated_rows.file_asset_id)),
            updated_rows.file_asset_id,
            'coworker_document',
            updated_rows.id
          from updated_rows
          on conflict do nothing
          returning id
        )
        select
          (select count(*) from candidates) as eligible_rows,
          (select count(*) from inserted_assets) as inserted_file_assets,
          (select count(*) from updated_rows) as updated_rows,
          (select count(*) from inserted_references) as inserted_references
      `,
    },
    {
      table: "skill_document",
      statement: sql`
        with candidates as (
          select
            document.id as reference_id,
            skill.workspace_id,
            skill.user_id as created_by_user_id,
            document.filename,
            document.mime_type,
            document.size_bytes,
            document.storage_key
          from ${skillDocument} as document
          inner join ${skill} as skill on skill.id = document.skill_id
          where document.file_asset_id is null
            and skill.workspace_id is not null
            and document.storage_key is not null
            and document.size_bytes is not null
        ),
        inserted_assets as (
          insert into ${fileAsset} (
            id,
            workspace_id,
            created_by_user_id,
            filename,
            mime_type,
            size_bytes,
            storage_key,
            status
          )
          select
            'legacy-file-asset:' || md5(storage_key),
            workspace_id,
            created_by_user_id,
            filename,
            mime_type,
            size_bytes,
            storage_key,
            'ready'
          from candidates
          on conflict (storage_key) do nothing
          returning id, storage_key
        ),
        asset_links as (
          select id, storage_key from inserted_assets
          union
          select asset.id, asset.storage_key
          from ${fileAsset} as asset
          inner join candidates on candidates.storage_key = asset.storage_key
        ),
        updated_rows as (
          update ${skillDocument} as document
          set file_asset_id = asset.id
          from candidates
          inner join asset_links as asset on asset.storage_key = candidates.storage_key
          where document.id = candidates.reference_id
            and document.file_asset_id is null
          returning document.id, document.file_asset_id
        ),
        inserted_references as (
          insert into ${fileAssetReference} (id, file_asset_id, kind, reference_id)
          select
            'legacy-file-asset-reference:' ||
              md5(concat('skill_document:', updated_rows.id, ':', updated_rows.file_asset_id)),
            updated_rows.file_asset_id,
            'skill_document',
            updated_rows.id
          from updated_rows
          on conflict do nothing
          returning id
        )
        select
          (select count(*) from candidates) as eligible_rows,
          (select count(*) from inserted_assets) as inserted_file_assets,
          (select count(*) from updated_rows) as updated_rows,
          (select count(*) from inserted_references) as inserted_references
      `,
    },
    {
      table: "sandbox_file",
      statement: sql`
        with candidates as (
          select
            file.id as reference_id,
            conv.workspace_id,
            conv.user_id as created_by_user_id,
            file.filename,
            file.mime_type,
            file.size_bytes,
            file.storage_key
          from ${sandboxFile} as file
          inner join ${conversation} as conv on conv.id = file.conversation_id
          where file.file_asset_id is null
            and conv.workspace_id is not null
            and file.storage_key is not null
            and file.size_bytes is not null
        ),
        inserted_assets as (
          insert into ${fileAsset} (
            id,
            workspace_id,
            created_by_user_id,
            filename,
            mime_type,
            size_bytes,
            storage_key,
            status
          )
          select
            'legacy-file-asset:' || md5(storage_key),
            workspace_id,
            created_by_user_id,
            filename,
            mime_type,
            size_bytes,
            storage_key,
            'ready'
          from candidates
          on conflict (storage_key) do nothing
          returning id, storage_key
        ),
        asset_links as (
          select id, storage_key from inserted_assets
          union
          select asset.id, asset.storage_key
          from ${fileAsset} as asset
          inner join candidates on candidates.storage_key = asset.storage_key
        ),
        updated_rows as (
          update ${sandboxFile} as file
          set file_asset_id = asset.id
          from candidates
          inner join asset_links as asset on asset.storage_key = candidates.storage_key
          where file.id = candidates.reference_id
            and file.file_asset_id is null
          returning file.id, file.file_asset_id
        ),
        inserted_references as (
          insert into ${fileAssetReference} (id, file_asset_id, kind, reference_id)
          select
            'legacy-file-asset-reference:' ||
              md5(concat('sandbox_file:', updated_rows.id, ':', updated_rows.file_asset_id)),
            updated_rows.file_asset_id,
            'sandbox_file',
            updated_rows.id
          from updated_rows
          on conflict do nothing
          returning id
        )
        select
          (select count(*) from candidates) as eligible_rows,
          (select count(*) from inserted_assets) as inserted_file_assets,
          (select count(*) from updated_rows) as updated_rows,
          (select count(*) from inserted_references) as inserted_references
      `,
    },
  ];
}

function buildDryRunStatements(): BackfillStatement[] {
  return [
    {
      table: "message_attachment",
      statement: sql`
        select
          count(*) as eligible_rows,
          0 as inserted_file_assets,
          0 as updated_rows,
          0 as inserted_references
        from ${messageAttachment} as attachment
        inner join ${message} as msg on msg.id = attachment.message_id
        inner join ${conversation} as conv on conv.id = msg.conversation_id
        where attachment.file_asset_id is null
          and conv.workspace_id is not null
          and attachment.storage_key is not null
          and attachment.size_bytes is not null
      `,
    },
    {
      table: "coworker_document",
      statement: sql`
        select
          count(*) as eligible_rows,
          0 as inserted_file_assets,
          0 as updated_rows,
          0 as inserted_references
        from ${coworkerDocument} as document
        inner join ${coworker} as wf on wf.id = document.coworker_id
        where document.file_asset_id is null
          and wf.workspace_id is not null
          and document.storage_key is not null
          and document.size_bytes is not null
      `,
    },
    {
      table: "skill_document",
      statement: sql`
        select
          count(*) as eligible_rows,
          0 as inserted_file_assets,
          0 as updated_rows,
          0 as inserted_references
        from ${skillDocument} as document
        inner join ${skill} as skill on skill.id = document.skill_id
        where document.file_asset_id is null
          and skill.workspace_id is not null
          and document.storage_key is not null
          and document.size_bytes is not null
      `,
    },
    {
      table: "sandbox_file",
      statement: sql`
        select
          count(*) as eligible_rows,
          0 as inserted_file_assets,
          0 as updated_rows,
          0 as inserted_references
        from ${sandboxFile} as file
        inner join ${conversation} as conv on conv.id = file.conversation_id
        where file.file_asset_id is null
          and conv.workspace_id is not null
          and file.storage_key is not null
          and file.size_bytes is not null
      `,
    },
  ];
}

export async function backfillLegacyFileAssets(input: {
  database: Database;
  dryRun?: boolean;
}): Promise<FileAssetBackfillResult> {
  const dryRun = input.dryRun ?? false;
  const statements = dryRun ? buildDryRunStatements() : buildApplyStatements();
  const tables: FileAssetBackfillTableResult[] = [];

  for (const statement of statements) {
    const result = await input.database.execute(statement.statement);
    tables.push(toTableResult(statement.table, result));
  }

  return {
    dryRun,
    tables,
    totals: sumResults(tables),
  };
}
