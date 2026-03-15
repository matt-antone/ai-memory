import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/0001_memory.sql", import.meta.url);
const metadataMigrationPath = new URL("../supabase/migrations/0003_metadata_search_enrichment.sql", import.meta.url);
const policiesMigrationPath = new URL("../supabase/migrations/0004_service_role_policies.sql", import.meta.url);
const forceRlsMigrationPath = new URL("../supabase/migrations/0005_force_rls_memory_tables.sql", import.meta.url);
const baselineInstallPath = new URL("../supabase/baseline/initial_install.sql", import.meta.url);
const edgeFunctionPath = new URL("../supabase/functions/memory-mcp/index.ts", import.meta.url);

async function loadMigration() {
  return readFile(migrationPath, "utf8");
}

async function loadMetadataMigration() {
  return readFile(metadataMigrationPath, "utf8");
}

async function loadPoliciesMigration() {
  return readFile(policiesMigrationPath, "utf8");
}

async function loadForceRlsMigration() {
  return readFile(forceRlsMigrationPath, "utf8");
}

async function loadBaselineInstall() {
  return readFile(baselineInstallPath, "utf8");
}

async function loadEdgeFunction() {
  return readFile(edgeFunctionPath, "utf8");
}

test("sql search vector indexes tags alongside content and summary", async () => {
  const sql = await loadMigration();

  assert.match(
    sql,
    /jsonb_to_tsvector\('english', coalesce\(tags, '\[\]'::jsonb\), '\["string"\]'::jsonb\)/
  );
});

test("sql namespace matching applies requested namespace tags", async () => {
  const sql = await loadMigration();

  assert.match(
    sql,
    /coalesce\(item_namespace->'tags', '\[\]'::jsonb\) @> \(requested->'tags'\)/
  );
});

test("sql lexical query helper expands query terms with OR semantics", async () => {
  const sql = await loadMigration();

  assert.match(sql, /create or replace function memory_lexical_query\(p_query text\)/);
  assert.match(
    sql,
    /array_to_string\(tsvector_to_array\(to_tsvector\('english', p_query\)\), ' \| '\)/
  );
});

test("sql search uses the lexical query helper instead of strict plainto_tsquery matching", async () => {
  const sql = await loadMigration();

  assert.match(sql, /memory_lexical_query\(p_query\) as lexical_query/);
  assert.doesNotMatch(sql, /ts_rank_cd\(mi\.search_vector, plainto_tsquery\('english', p_query\)\)/);
});

test("sql context expansion traverses from the current frontier item", async () => {
  const sql = await loadMigration();

  assert.match(sql, /join walk on me\.from_id = walk\.item_id or me\.to_id = walk\.item_id/);
  assert.match(sql, /join memory_items mi on mi\.id = walk\.item_id/);
});

test("sql enables row level security on all memory tables", async () => {
  const sql = await loadMigration();

  for (const table of [
    "memory_namespaces",
    "memory_items",
    "memory_embeddings",
    "memory_edges",
    "memory_events"
  ]) {
    assert.match(sql, new RegExp(`alter table ${table} enable row level security;`));
  }
});

test("sql revokes direct table and rpc access from client roles", async () => {
  const sql = await loadMigration();

  for (const table of [
    "memory_namespaces",
    "memory_items",
    "memory_embeddings",
    "memory_edges",
    "memory_events"
  ]) {
    assert.match(sql, new RegExp(`revoke all on table ${table} from anon, authenticated;`));
  }

  assert.match(
    sql,
    /revoke all on function memory_search\(text, vector, jsonb, jsonb, text, integer\) from public, anon, authenticated;/
  );
  assert.match(
    sql,
    /revoke all on function memory_expand_context\(text\[\], integer\) from public, anon, authenticated;/
  );
});

test("metadata search migration indexes metadata keys and values", async () => {
  const sql = await loadMetadataMigration();

  assert.match(
    sql,
    /jsonb_to_tsvector\('english', coalesce\(metadata, '\{\}'::jsonb\), '\["string","numeric","boolean","key"\]'::jsonb\)/
  );
  assert.match(sql, /drop column if exists search_vector/);
});

test("service role policy migration adds explicit service-role-only policies on all memory tables", async () => {
  const sql = await loadPoliciesMigration();

  for (const table of [
    "memory_namespaces",
    "memory_items",
    "memory_embeddings",
    "memory_edges",
    "memory_events"
  ]) {
    assert.match(
      sql,
      new RegExp(`create policy "service_role_all_${table}"\\s+on ${table}\\s+for all\\s+to service_role\\s+using \\(true\\)\\s+with check \\(true\\);`)
    );
  }
});

test("force RLS migration explicitly enables and forces RLS on all public memory tables", async () => {
  const sql = await loadForceRlsMigration();

  for (const table of [
    "memory_namespaces",
    "memory_items",
    "memory_embeddings",
    "memory_edges",
    "memory_events"
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security;`));
  }
});

test("baseline initial install enables and forces RLS on all public memory tables", async () => {
  const sql = await loadBaselineInstall();

  for (const table of [
    "memory_namespaces",
    "memory_items",
    "memory_embeddings",
    "memory_edges",
    "memory_events"
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security;`));
    assert.match(
      sql,
      new RegExp(`create policy "service_role_all_${table}"\\s+on public\\.${table}\\s+for all\\s+to service_role\\s+using \\(true\\)\\s+with check \\(true\\);`)
    );
  }
});

test("edge function applies pre-auth rate limiting and request body size checks", async () => {
  const source = await loadEdgeFunction();

  assert.match(source, /preAuthRateLimiter\.consume\(getRequestRateLimitKey\(request\)\)/);
  assert.match(source, /const MAX_REQUEST_BODY_BYTES = parsePositiveInt\(Deno\.env\.get\("MEMORY_MAX_REQUEST_BODY_BYTES"\), 256 \* 1024\)/);
  assert.match(source, /contentLength !== null && contentLength > MAX_REQUEST_BODY_BYTES/);
  assert.match(source, /byteLength\(text\) > MAX_REQUEST_BODY_BYTES/);
});
