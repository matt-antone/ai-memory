import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const defaultProjectRef = readText(path.join(cwd, "supabase/.temp/project-ref"))?.trim() || "";
const defaultEndpoint = defaultProjectRef
  ? `https://${defaultProjectRef}.supabase.co/functions/v1/memory-mcp`
  : "https://your-project-ref.supabase.co/functions/v1/memory-mcp";
const envPath = path.join(cwd, ".env");

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

let rl = createPromptInterface();

try {
  console.log("AI Memory onboarding");
  console.log("This will guide you through Supabase setup, function deployment, and agent registration.\n");

  const projectRef = await ask("Supabase project ref", defaultProjectRef || "");
  const endpoint = await ask("Memory MCP endpoint URL", projectRef
    ? `https://${projectRef}.supabase.co/functions/v1/memory-mcp`
    : defaultEndpoint);

  const authMode = await choose(
    "Auth mode",
    [
      { key: "1", label: "Shared key", value: "shared" },
      { key: "2", label: "Scoped client", value: "scoped" }
    ],
    "1"
  );

  const suggestedSecret = crypto.randomBytes(32).toString("base64");
  const accessKey = await ask(
    authMode === "shared" ? "Shared MCP access key" : "Scoped client secret",
    suggestedSecret
  );

  let clientId = "";
  let clientsJson = "";
  if (authMode === "scoped") {
    clientId = await ask("Scoped client ID", "ai-memory-client");
    const workspaceId = await ask("Workspace namespace", cwd);
    clientsJson = JSON.stringify([
      {
        client_id: clientId,
        secret: accessKey,
        namespace: {
          scope: "workspace",
          workspace_id: workspaceId
        }
      }
    ], null, 2);
  }

  const localEnv = {
    MEMORY_MCP_URL: endpoint,
    MEMORY_MCP_ACCESS_KEY: accessKey,
    MEMORY_MCP_CLIENT_ID: clientId
  };
  upsertEnvFile(envPath, localEnv);
  console.log(`\nUpdated local env file: ${envPath}`);

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
      secretPairs.push(`MEMORY_MCP_CLIENTS_JSON=${clientsJson}`);
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

  const agentsRaw = await ask(
    "Which agents should be configured? (comma-separated: claude, codex, cursor, openclaw, none)",
    "claude,codex,cursor"
  );
  const agents = agentsRaw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const setupEnv = {
    ...process.env,
    MEMORY_MCP_URL: endpoint,
    MEMORY_MCP_ACCESS_KEY: accessKey,
    MEMORY_MCP_CLIENT_ID: clientId
  };

  for (const agent of agents) {
    if (agent === "none") {
      break;
    }
    if (agent === "claude") {
      run("npm", ["run", "setup:claude"], { env: setupEnv, interactive: true });
    } else if (agent === "codex") {
      run("npm", ["run", "setup:codex"], { env: setupEnv, interactive: true });
    } else if (agent === "cursor") {
      run("npm", ["run", "setup:cursor"], { env: setupEnv, interactive: true });
    } else if (agent === "openclaw") {
      run("npm", ["run", "setup:openclaw"], { env: setupEnv, interactive: true });
    } else if (agent) {
      console.warn(`Skipping unknown agent: ${agent}`);
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
  if (agents.includes("claude")) {
    const red = "\u001b[31m";
    const reset = "\u001b[0m";
    console.log(`${red}Claude launch command:${reset}`);
    console.log(`${red}  cd "${cwd}" && set -a && source .env && set +a && claude${reset}`);
  }
  console.log("If Codex or Claude was already open, restart it so it reloads MCP config.");
} finally {
  rl?.close();
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
  const match = options.find((option) => option.key === selected) ?? options.find((option) => option.key === fallbackKey);
  return match.value;
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
