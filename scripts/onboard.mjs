import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import { resolveChoice } from "../src/utils/prompt.js";
import {
  BUILTIN_AGENT_IDS,
  addAgentNamespace,
  listAgentIds,
  readEnvFile,
  readUserConfig,
  resolveAiMemoryPaths,
  setCurrentAgent,
  upsertAgent,
  validateAgentId,
  validateClientId,
  writeUserConfig
} from "../src/utils/user-config.js";

const cwd = process.cwd();
const defaultProjectRef = readText(path.join(cwd, "supabase/.temp/project-ref"))?.trim() || "";
const defaultEndpoint = defaultProjectRef
  ? `https://${defaultProjectRef}.supabase.co/functions/v1/memory-mcp`
  : "https://your-project-ref.supabase.co/functions/v1/memory-mcp";
const envPath = path.join(cwd, ".env");
const configPaths = resolveAiMemoryPaths(process.env.AI_MEMORY_CONFIG_DIR);

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

let rl = createPromptInterface();

try {
  console.log("AI Memory onboarding");
  console.log("This will guide you through Supabase setup, function deployment, and agent registration.\n");

  let config = readUserConfig(configPaths.configPath);
  const aiMemoryEnv = readEnvFile(configPaths.envPath);
  const projectRef = await ask("Supabase project ref", defaultProjectRef || "");
  const endpoint = await ask("Memory MCP endpoint URL", projectRef
    ? `https://${projectRef}.supabase.co/functions/v1/memory-mcp`
    : defaultEndpoint);

  config = {
    ...config,
    url: endpoint
  };

  const agentResolution = await resolveAgent(config);
  config = agentResolution.config;
  const agentId = agentResolution.agentId;
  const authMode = agentResolution.authMode;
  const clientId = authMode === "scoped" ? agentResolution.clientId : "";

  const accessKey = await ask(
    authMode === "shared" ? "Shared MCP access key" : "Scoped client secret",
    crypto.randomBytes(32).toString("base64")
  );

  const namespace = {
    scope: "workspace",
    workspace_id: cwd,
    agent_id: null,
    topic: null,
    tags: []
  };
  config = ensureAgentNamespace(config, agentId, namespace);
  config = setCurrentAgent(config, agentId);
  const now = new Date().toISOString();
  config.createdAt = config.createdAt || now;
  config.updatedAt = now;
  writeUserConfig(configPaths.configPath, config);

  const agentSecrets = mergeAgentSecretInventory(
    aiMemoryEnv.MEMORY_MCP_AGENT_SECRETS_JSON,
    {
      [agentId]: {
        authMode,
        clientId,
        secret: accessKey
      }
    }
  );

  writeAiMemoryEnv(configPaths.envPath, {
    MEMORY_MCP_ACCESS_KEY: accessKey,
    MEMORY_MCP_CLIENT_ID: clientId,
    MEMORY_MCP_AGENT_SECRETS_JSON: JSON.stringify(agentSecrets)
  });

  const localEnv = {
    MEMORY_MCP_URL: endpoint,
    MEMORY_MCP_ACCESS_KEY: accessKey,
    MEMORY_MCP_CLIENT_ID: clientId
  };
  upsertEnvFile(envPath, localEnv);
  console.log(`\nUpdated local env file: ${envPath}`);
  console.log(`Updated ai-memory config: ${configPaths.configPath}`);

  if (await confirm("Run `supabase login` now if needed?", false)) {
    run("supabase", ["login"], { interactive: true });
  }

  if (await confirm("Link this repo to the Supabase project now?", false)) {
    run("supabase", ["link", "--project-ref", projectRef]);
  }

  if (await confirm("Apply remote database migrations with `supabase db push`?", true)) {
    const dbPush = run("supabase", ["db", "push", "--linked"], {
      allowFailure: true,
      interactive: true
    });
    if (dbPush.status !== 0) {
      console.warn("\n`supabase db push --linked` did not complete.");
      console.warn("If you saw an IPv6 connectivity error, rerun `supabase link --project-ref <ref>` and choose the IPv4 connection option, then run `supabase db push --linked` again.");
      if (!await confirm("Continue onboarding without a successful database push?", false)) {
        throw new Error("Stopping onboarding after failed database push.");
      }
    }
  }

  if (await confirm("Set edge function secrets on Supabase?", true)) {
    const secretPairs = [
      `SUPABASE_URL=https://${projectRef}.supabase.co`,
      `SUPABASE_SERVICE_ROLE_KEY=${await ask("Supabase service role key", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")}`
    ];

    if (authMode === "shared") {
      secretPairs.push(`MEMORY_MCP_ACCESS_KEY=${accessKey}`);
    } else {
      const scopedClientsJson = buildScopedClientsJson(config, agentSecrets);
      secretPairs.push(`MEMORY_MCP_CLIENTS_JSON=${JSON.stringify(scopedClientsJson, null, 2)}`);
    }

    const rateLimitWindow = await ask("Rate limit window ms", process.env.MEMORY_RATE_LIMIT_WINDOW_MS ?? "60000");
    const rateLimitMax = await ask("Rate limit max requests", process.env.MEMORY_RATE_LIMIT_MAX_REQUESTS ?? "120");
    secretPairs.push(`MEMORY_RATE_LIMIT_WINDOW_MS=${rateLimitWindow}`);
    secretPairs.push(`MEMORY_RATE_LIMIT_MAX_REQUESTS=${rateLimitMax}`);

    run("supabase", ["secrets", "set", "--project-ref", projectRef, ...secretPairs]);
  }

  if (await confirm("Deploy the `memory-mcp` edge function now?", true)) {
    run("supabase", ["functions", "deploy", "memory-mcp", "--project-ref", projectRef]);
  }

  const hostsRaw = await ask(
    "Which hosts should be configured? (comma-separated: claude, codex, cursor, openclaw, none)",
    "claude,codex,cursor"
  );
  const hosts = hostsRaw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const setupEnv = {
    ...process.env,
    MEMORY_MCP_URL: endpoint,
    MEMORY_MCP_ACCESS_KEY: accessKey,
    MEMORY_MCP_CLIENT_ID: clientId
  };

  for (const host of hosts) {
    if (host === "none") {
      break;
    }
    if (host === "claude") {
      run("npm", ["run", "setup:claude"], { env: setupEnv, interactive: true });
    } else if (host === "codex") {
      run("npm", ["run", "setup:codex"], { env: setupEnv, interactive: true });
    } else if (host === "cursor") {
      run("npm", ["run", "setup:cursor"], { env: setupEnv, interactive: true });
    } else if (host === "openclaw") {
      run("npm", ["run", "setup:openclaw"], { env: setupEnv, interactive: true });
    } else if (host) {
      console.warn(`Skipping unknown host: ${host}`);
    }
  }

  if (await confirm("Run the MCP smoke test now?", true)) {
    run("npm", ["run", "smoke:mcp"], {
      env: {
        ...process.env,
        MEMORY_MCP_SMOKE_URL: endpoint,
        MEMORY_MCP_ACCESS_KEY: accessKey,
        MEMORY_MCP_CLIENT_ID: clientId
      }
    });
  }

  console.log("\nOnboarding complete.");
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Current agent: ${agentId}`);
  if (clientId) {
    console.log(`Scoped client ID: ${clientId}`);
  }
  if (hosts.includes("claude")) {
    const red = "\u001b[31m";
    const reset = "\u001b[0m";
    console.log(`${red}Claude launch command:${reset}`);
    console.log(`${red}  cd "${cwd}" && set -a && source .env && set +a && claude${reset}`);
  }
  console.log("If Codex or Claude was already open, restart it so it reloads MCP config.");
} finally {
  rl?.close();
}

async function resolveAgent(config) {
  const agentIds = listAgentIds(config);
  if (agentIds.length === 0) {
    return createAgent(config, "");
  }

  const selection = await choose(
    "Select an agent host",
    [
      ...agentIds.map((agentId, index) => ({ key: String(index + 1), label: agentId, value: agentId })),
      { key: String(agentIds.length + 1), label: "new agent", value: "__new__" }
    ],
    "1"
  );

  if (selection === "__new__") {
    return createAgent(config, "");
  }

  const existing = config.agents[selection];
  const authMode = await choose(
    `Auth mode for '${selection}'`,
    [
      { key: "1", label: "Shared key", value: "shared" },
      { key: "2", label: "Scoped client", value: "scoped" }
    ],
    existing?.authMode === "shared" ? "1" : "2"
  );
  const clientId = authMode === "scoped"
    ? await ask("Scoped client ID", existing?.clientId || `${selection}-memory`)
    : "";
  if (authMode === "scoped") {
    validateClientId(clientId);
  }

  return {
    config: upsertAgent(config, selection, { authMode, clientId }),
    agentId: selection,
    authMode,
    clientId
  };
}

async function createAgent(config, fallbackAgentId) {
  const selection = await choose(
    "Choose the new agent host",
    [
      ...BUILTIN_AGENT_IDS.map((agentId, index) => ({ key: String(index + 1), label: agentId, value: agentId })),
      { key: String(BUILTIN_AGENT_IDS.length + 1), label: "custom", value: "__custom__" }
    ],
    "1"
  );

  const agentId = selection === "__custom__"
    ? await ask("Agent ID", fallbackAgentId || "team-agent")
    : selection;
  validateAgentId(agentId);

  const authMode = await choose(
    "Auth mode",
    [
      { key: "1", label: "Shared key", value: "shared" },
      { key: "2", label: "Scoped client", value: "scoped" }
    ],
    "2"
  );
  const clientId = authMode === "scoped"
    ? await ask("Scoped client ID", `${agentId}-memory`)
    : "";
  if (authMode === "scoped") {
    validateClientId(clientId);
  }

  return {
    config: upsertAgent(config, agentId, { authMode, clientId }),
    agentId,
    authMode,
    clientId
  };
}

function ensureAgentNamespace(config, agentId, namespace) {
  const namespaces = config.agents[agentId]?.namespaces ?? [];
  const exists = namespaces.some((entry) => JSON.stringify(entry) === JSON.stringify(namespace));
  if (exists) {
    return config;
  }
  return addAgentNamespace(config, agentId, namespace);
}

function buildScopedClientsJson(config, agentSecrets) {
  const scopedClients = [];

  for (const [agentId, agent] of Object.entries(config.agents)) {
    if (agent.authMode !== "scoped") {
      continue;
    }

    const inventory = agentSecrets[agentId];
    if (!inventory?.secret) {
      throw new Error(`Missing local secret for scoped agent '${agentId}'. Re-run onboarding for that agent before setting Supabase secrets.`);
    }
    if (!inventory?.clientId) {
      throw new Error(`Scoped agent '${agentId}' is missing a local client ID in the env inventory.`);
    }

    const namespace = agent.namespaces[0];
    if (!namespace) {
      throw new Error(`Scoped agent '${agentId}' has no namespace. Add a namespace before setting Supabase secrets.`);
    }

    scopedClients.push({
      client_id: inventory.clientId,
      secret: inventory.secret,
      namespace
    });
  }

  return scopedClients;
}

function mergeAgentSecretInventory(existingRaw, nextEntries) {
  const existing = parseAgentSecretInventory(existingRaw);
  return {
    ...existing,
    ...nextEntries
  };
}

function parseAgentSecretInventory(raw) {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([agentId, entry]) => String(agentId || "").trim() && entry && typeof entry === "object" && !Array.isArray(entry))
        .map(([agentId, entry]) => [
          agentId,
          {
            authMode: entry.authMode === "shared" ? "shared" : "scoped",
            clientId: String(entry.clientId || ""),
            secret: String(entry.secret || "")
          }
        ])
    );
  } catch {
    return {};
  }
}

function printHelp() {
  console.log(`Usage: npm run onboard

Interactive onboarding for this repo. It can:
- link the repo to a Supabase project
- push database migrations
- set edge function secrets
- deploy the memory-mcp edge function
- configure Claude, Codex, Cursor, and OpenClaw
- run the MCP smoke test
`);
}

async function ask(label, fallback = "") {
  const suffix = fallback ? ` [${fallback}]` : "";
  const value = (await rl.question(`${label}${suffix}: `)).trim();
  return value || fallback;
}

async function confirm(label, defaultYes = true) {
  const suffix = defaultYes ? " [Y/n]" : " [y/N]";
  const value = (await rl.question(`${label}${suffix}: `)).trim().toLowerCase();
  if (!value) {
    return defaultYes;
  }
  return value === "y" || value === "yes";
}

async function choose(label, options, fallbackKey) {
  console.log(`${label}:`);
  for (const option of options) {
    console.log(`  ${option.key}. ${option.label}`);
  }
  const selected = await ask("Choose an option", fallbackKey);
  return resolveChoice(options, selected, fallbackKey).value;
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  if (options.interactive) {
    rl.close();
    input.resume();
  }
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd,
    env: options.env ?? process.env
  });
  if (options.interactive) {
    rl = createPromptInterface();
  }

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }

  return result;
}

function createPromptInterface() {
  return readline.createInterface({ input, output });
}

function upsertEnvFile(filePath, values) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const seen = new Set();

  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) {
      return line;
    }
    const key = match[1];
    if (!(key in values)) {
      return line;
    }
    seen.add(key);
    return `${key}=${quoteEnv(values[key])}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (!seen.has(key)) {
      updated.push(`${key}=${quoteEnv(value)}`);
    }
  }

  fs.writeFileSync(filePath, `${updated.filter(Boolean).join("\n")}\n`);
}

function writeAiMemoryEnv(filePath, values) {
  upsertEnvFile(filePath, values);
}

function quoteEnv(value) {
  const stringValue = String(value ?? "");
  return JSON.stringify(stringValue);
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}
