import test from "node:test";
import assert from "node:assert/strict";

const SUPABASE_URL = process.env.SUPABASE_INTEGRATION_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_INTEGRATION_SERVICE_ROLE_KEY;

const maybeTest = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? test : test.skip;

maybeTest("supabase integration can reach memory tables and rpc endpoints", async () => {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json"
  };

  const restResponse = await fetch(`${SUPABASE_URL}/rest/v1/memory_items?select=id&limit=1`, {
    headers
  });
  assert.equal(restResponse.ok, true);

  const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/memory_search`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_query: "integration",
      p_namespace: {},
      p_filters: {},
      p_mode: "lexical",
      p_limit: 1
    })
  });
  assert.equal(rpcResponse.ok, true);
});
