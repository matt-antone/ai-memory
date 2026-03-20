#!/usr/bin/env node
/**
 * search-comparison.mjs
 *
 * Compares two search strategies for the same vague query:
 *   1. Grep workflow — realistic multi-step ripgrep + file reads
 *   2. ai-memory    — single MCP memory.search call
 *
 * Usage:
 *   node scripts/search-comparison.mjs
 *   node scripts/search-comparison.mjs "your custom query"
 *
 * Requires MEMORY_MCP_URL and MEMORY_MCP_ACCESS_KEY for ai-memory leg.
 * Grep leg runs locally; no env vars needed.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUERY = process.argv[2] ?? "how does search fall back when there's no embedding";
const NAMESPACE = { repo_url: 'https://github.com/matt-antone/ai-memory' };

// ~4 chars per token (reasonable approximation for Claude/GPT)
const tok = (s) => Math.ceil((s ?? '').length / 4);

const hr = (char = '─', len = 68) => char.repeat(len);
const col = (s, w) => String(s ?? 'N/A').padEnd(w);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// opts: '-l' for files-only, '-i' for case-insensitive
function search(pattern, opts = '') {
  const lFlag = opts.includes('-l') ? '-l' : '';
  const iFlag = opts.includes('-i') ? '-i' : '';
  try {
    return execSync(
      `grep -rEn ${lFlag} ${iFlag} --include="*.js" ${JSON.stringify(pattern)} src/`,
      { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString();
  } catch {
    return '';
  }
}

function readFile(relPath) {
  const abs = path.join(ROOT, relPath);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg 1: Grep workflow
// Simulates a developer who knows the concept but not the exact symbol names.
// ─────────────────────────────────────────────────────────────────────────────

async function runGrepWorkflow() {
  const t0 = performance.now();
  const log = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let roundTrips = 0;

  // Round 1 — vague keyword search (what a dev would try first)
  const q1 = 'fallback|no.{0,20}embed|embed.{0,20}fallback';
  tokensIn += tok(q1);
  const r1 = search(q1, '-l -i');
  tokensOut += tok(r1);
  roundTrips++;
  const files1 = r1.trim().split('\n').filter(Boolean);
  log.push(`  [1] grep "${q1}" -l  →  ${files1.length} file(s): ${files1.join(', ') || '(none)'}`);

  // Round 2 — follow the thread: search for where mode/embedding is checked
  const q2 = 'queryEmbedding|query_embedding|mode.*lexical';
  tokensIn += tok(q2);
  const r2 = search(q2, '-i');
  tokensOut += tok(r2);
  roundTrips++;
  const lines2 = r2.trim().split('\n').filter(Boolean);
  log.push(`  [2] grep "${q2}"     →  ${lines2.length} line(s)`);

  // Round 3 — extract unique files from round 2, read the most relevant ones
  const seen = new Set();
  for (const line of lines2) {
    const m = line.match(/^([^:]+):/);
    if (m) seen.add(m[1]);
  }
  // If round 2 found nothing, fall back to round 1 files
  if (seen.size === 0) files1.forEach(f => seen.add(f));
  const toRead = [...seen].slice(0, 3); // read up to 3 files

  for (const f of toRead) {
    tokensIn += tok(`read ${f}`);
    const content = readFile(f);
    tokensOut += tok(content);
    roundTrips++;
    log.push(`  [3] read ${f}  →  ${content.length} chars`);
  }

  const elapsed = performance.now() - t0;
  return { tokensIn, tokensOut, roundTrips, elapsed, log };
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg 2: ai-memory workflow
// Single MCP memory.search call via HTTP.
// ─────────────────────────────────────────────────────────────────────────────

async function runMemoryWorkflow() {
  const endpoint = process.env.MEMORY_MCP_URL;
  const accessKey = process.env.MEMORY_MCP_ACCESS_KEY;
  const clientId = process.env.MEMORY_MCP_CLIENT_ID ?? '';

  if (!endpoint || !accessKey) {
    return { skipped: true, reason: 'MEMORY_MCP_URL or MEMORY_MCP_ACCESS_KEY not set' };
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'memory.search',
      arguments: { query: QUERY, namespace: NAMESPACE, k: 5, mode: 'lexical' },
    },
  });

  const log = [];
  const t0 = performance.now();
  const tokensIn = tok(body);
  let tokensOut = 0;
  let hits = 0;
  let error = null;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-memory-key': accessKey,
        ...(clientId ? { 'x-memory-client-id': clientId } : {}),
      },
      body,
    });

    const text = await res.text();
    tokensOut = tok(text);

    if (!res.ok) {
      error = `HTTP ${res.status}: ${text.slice(0, 120)}`;
    } else {
      // Parse SSE or plain JSON
      const jsonStr = text.includes('data:')
        ? text.split('\n').find(l => l.startsWith('data:'))?.slice(5) ?? '{}'
        : text;
      try {
        const parsed = JSON.parse(jsonStr);
        const inner = parsed?.result?.content?.[0]?.text;
        if (inner) {
          const data = JSON.parse(inner);
          hits = data?.hits?.length ?? 0;
        }
      } catch {
        // best-effort parse
      }
      log.push(`  [1] memory.search "${QUERY}"  →  ${hits} hit(s)`);
    }
  } catch (e) {
    error = e.message;
  }

  const elapsed = performance.now() - t0;
  return { tokensIn, tokensOut, roundTrips: 1, elapsed, log, hits, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${hr('═')}`);
console.log(`  SEARCH COMPARISON`);
console.log(`  Query: "${QUERY}"`);
console.log(`${hr('═')}\n`);

const [grep, memory] = await Promise.all([runGrepWorkflow(), runMemoryWorkflow()]);

console.log('GREP WORKFLOW\n' + hr());
grep.log.forEach(l => console.log(l));

console.log('\nai-memory WORKFLOW\n' + hr());
if (memory.skipped) {
  console.log(`  SKIPPED — ${memory.reason}`);
} else if (memory.error) {
  console.log(`  ERROR — ${memory.error}`);
} else {
  memory.log.forEach(l => console.log(l));
}

// ─── Table ────────────────────────────────────────────────────────────────────
const memOk = !memory.skipped && !memory.error;
// If auth failed, output tokens are just the error body — flag this clearly
const memTotalTok = memory.skipped ? null : memory.tokensIn + memory.tokensOut;
const grepTotalTok = grep.tokensIn + grep.tokensOut;
const savings = (memOk && memTotalTok != null)
  ? Math.round((1 - memTotalTok / grepTotalTok) * 100)
  : null;

const memVal = (v) => {
  if (memory.skipped) return 'N/A (no creds)';
  if (memory.error) return `${v} ⚠ auth err`;
  return v;
};

console.log(`\n${'RESULTS'.padStart(38)}\n${hr()}`);
console.log(`${col('Metric', 30)} ${col('Grep', 16)} ${'ai-memory'}`);
console.log(hr('-'));
console.log(`${col('Round trips', 30)} ${col(grep.roundTrips, 16)} ${memVal(memory.roundTrips ?? 1)}`);
console.log(`${col('Tokens in (est.)', 30)} ${col(grep.tokensIn, 16)} ${memVal(memory.tokensIn ?? 0)}`);
console.log(`${col('Tokens out (est.)', 30)} ${col(grep.tokensOut, 16)} ${memVal(memory.tokensOut ?? 0)}`);
console.log(`${col('Total tokens (est.)', 30)} ${col(grepTotalTok, 16)} ${memVal(memTotalTok ?? 'N/A')}`);
console.log(`${col('Wall time (ms)', 30)} ${col(Math.round(grep.elapsed), 16)} ${memVal(Math.round(memory.elapsed ?? 0))}`);
console.log(hr('-'));

if (savings != null) {
  const larger = Math.max(grepTotalTok, memTotalTok);
  const smaller = Math.min(grepTotalTok, memTotalTok);
  const pct = Math.round((1 - smaller / larger) * 100);
  const winner = memTotalTok < grepTotalTok
    ? `ai-memory saves ~${pct}% tokens`
    : `grep saves ~${pct}% tokens (ai-memory returned ${Math.round(memTotalTok / grepTotalTok * 10) / 10}× more)`;
  console.log(`${col('Token delta', 30)} ${winner}`);
} else if (memory.error) {
  // Show timing even on auth failure — it's still useful data
  const real = memory.elapsed ? Math.round(memory.elapsed) : '?';
  console.log(`  Note: ai-memory auth failed (check MEMORY_MCP_ACCESS_KEY).`);
  console.log(`  Network round-trip was ${real}ms. Token savings comparison requires valid creds.`);
  // Estimate: based on typical search returning ~3000 tok output
  const estMemTok = (memory.tokensIn ?? 0) + 3000;
  const estSavings = Math.round((1 - estMemTok / grepTotalTok) * 100);
  if (grepTotalTok > estMemTok) {
    console.log(`  Estimate (if creds valid, ~5 hits): ai-memory ~${estMemTok} tok total → saves ~${estSavings}%`);
  }
} else {
  console.log(`  Run with MEMORY_MCP_URL + MEMORY_MCP_ACCESS_KEY to compare ai-memory.`);
}

console.log();
