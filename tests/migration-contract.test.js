import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/0001_memory.sql", import.meta.url);

async function loadMigration() {
  return readFile(migrationPath, "utf8");
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
    /coalesce\(item_namespace->'tags', '\[\]'::jsonb\) @> requested->'tags'/
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
