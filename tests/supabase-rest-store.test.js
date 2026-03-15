import test from "node:test";
import assert from "node:assert/strict";

import { SupabaseRestStore } from "../src/storage/supabase-rest-store.js";

test("store retries transient response failures", async () => {
  const responses = [
    new Response(JSON.stringify({ error: "temporary" }), { status: 503, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify([{ id: "mem_1" }]), { status: 200, headers: { "content-type": "application/json" } })
  ];
  const store = new SupabaseRestStore({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-key",
    fetchImpl: async () => responses.shift()
  });

  const item = await store.getItem("mem_1");
  assert.equal(item.id, "mem_1");
  assert.equal(responses.length, 0);
});

test("store retries transient network errors", async () => {
  let attempts = 0;
  const store = new SupabaseRestStore({
    url: "https://example.supabase.co",
    serviceRoleKey: "service-key",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("network timeout");
      }
      return new Response(JSON.stringify([{ id: "mem_1" }]), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const item = await store.getItem("mem_1");
  assert.equal(item.id, "mem_1");
  assert.equal(attempts, 2);
});
