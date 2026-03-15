#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  inspectCodexConfig,
  inspectJsonServerConfig,
  removeCodexConfig,
  removeJsonServerConfig,
  upsertCodexConfig,
  upsertJsonServerConfig
} from "../src/utils/agent-config.js";

const [,, kind, action, filePath, serverName, url = "", clientId = ""] = process.argv;

if (!kind || !action || !filePath || !serverName) {
  console.error("Usage: node scripts/agent-config.mjs <codex|json> <inspect|upsert|remove> <path> <server> [url] [clientId]");
  process.exit(1);
}

const exists = fs.existsSync(filePath);
const content = exists ? fs.readFileSync(filePath, "utf8") : "";

const helpers = kind === "codex"
  ? {
      inspect: inspectCodexConfig,
      upsert: upsertCodexConfig,
      remove: removeCodexConfig
    }
  : kind === "json"
    ? {
        inspect: inspectJsonServerConfig,
        upsert: upsertJsonServerConfig,
        remove: removeJsonServerConfig
      }
    : null;

if (!helpers) {
  console.error(`Unsupported config kind: ${kind}`);
  process.exit(1);
}

if (action === "inspect") {
  process.stdout.write(`${JSON.stringify(helpers.inspect(content, serverName))}\n`);
  process.exit(0);
}

if (action === "upsert") {
  const nextContent = helpers.upsert(content, serverName, url, clientId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, nextContent);
  process.exit(0);
}

if (action === "remove") {
  const nextContent = helpers.remove(content, serverName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, nextContent);
  process.exit(0);
}

console.error(`Unsupported action: ${action}`);
process.exit(1);
