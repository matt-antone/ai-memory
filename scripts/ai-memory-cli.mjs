#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";

import {
  readUserConfig,
  readEnvFile,
  resolveAiMemoryPaths,
  writeEnvFile,
  writeUserConfig,
  upsertInstallRecord,
  installRecordExists,
  envFileMode,
  validateInstallRecord
} from "../src/utils/user-config.js";

import {
  inspectCodexConfig,
  upsertCodexConfig
} from "../src/utils/agent-config.js";

const cwd = process.cwd();
const args = process.argv.slice(2);
const [command, host] = args;
const paths = resolveAiMemoryPaths(process.env.AI_MEMORY_CONFIG_DIR);
const defaultProjectRef = readText(path.join(cwd, "supabase/.temp/project-ref"))?.trim() || "";
const defaultUrl = process.env.MEMORY_MCP_URL
  || (defaultProjectRef ? `https://${defaultProjectRef}.supabase.co/functions/v1/memory-mcp` : "https://your-project-ref.supabase.co/functions/v1/memory-mcp");
let rl = createPromptInterface();

main()
  .then((code) => {
    if (typeof code === "number") {
      process.exitCode = code;
    }
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "init") {
    await runInit();
    return 0;
  }

  if (command === "install") {
    if (host !== "codex" && host !== "claude") {
      throw new Error("Install target must be one of: codex, claude");
    }
    await runInstall(host);
    return 0;
  }

  if (command === "doctor") {
    runDoctor();
    return process.exitCode ?? 0;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function runInit() {
  const currentConfig = readUserConfig(paths.configPath);
  const currentEnv = readEnvFile(paths.envPath);

  const url = process.env.AI_MEMORY_INIT_URL
    || await ask("Memory MCP endpoint URL", currentConfig.url || defaultUrl);
  const accessKey = process.env.AI_MEMORY_INIT_ACCESS_KEY
    || await ask("Memory MCP access key", currentEnv.MEMORY_MCP_ACCESS_KEY || process.env.MEMORY_MCP_ACCESS_KEY || "");
  const clientId = process.env.AI_MEMORY_INIT_CLIENT_ID
    || await ask("Default client ID (optional)", currentConfig.clientId || process.env.MEMORY_MCP_CLIENT_ID || "");

  const now = new Date().toISOString();
  const nextConfig = {
    ...currentConfig,
    serverName: currentConfig.serverName || "ai-memory",
    url,
    clientId,
    createdAt: currentConfig.createdAt || now,
    updatedAt: now
  };

  fs.mkdirSync(paths.backupsDir, { recursive: true });
  writeUserConfig(paths.configPath, nextConfig);
  writeEnvFile(paths.envPath, { MEMORY_MCP_ACCESS_KEY: accessKey });

  console.log(`Initialized ai-memory config at: ${paths.configPath}`);
  console.log(`Stored ai-memory secret at: ${paths.envPath}`);
}

async function runInstall(type) {
  const config = readUserConfig(paths.configPath);
  const envValues = readEnvFile(paths.envPath);
  const accessKey = envValues.MEMORY_MCP_ACCESS_KEY || process.env.MEMORY_MCP_ACCESS_KEY || "";

  if (!config.url) {
    throw new Error(`Missing URL in ${paths.configPath}. Run 'ai-memory init' first.`);
  }
  if (!accessKey) {
    throw new Error(`Missing MEMORY_MCP_ACCESS_KEY in ${paths.envPath}. Run 'ai-memory init' first.`);
  }

  const installName = process.env.AI_MEMORY_INSTALL_NAME
    || await ask("Install name", defaultInstallName(type));
  if (installRecordExists(config, installName)) {
    const overwrite = process.env.AI_MEMORY_OVERWRITE_EXISTING
      ? parseBoolean(process.env.AI_MEMORY_OVERWRITE_EXISTING, true)
      : await confirm(`Install '${installName}' already exists. Update it?`, true);
    if (!overwrite) {
      throw new Error("Install cancelled.");
    }
  }
  const agentId = process.env.AI_MEMORY_AGENT_ID
    || await ask("Agent identity", config.installs?.[installName]?.agentId || defaultAgentId(type));

  if (type === "codex") {
    await installCodex(config, accessKey, installName, agentId);
    return;
  }
  await installClaude(config, accessKey, installName, agentId);
}

async function installCodex(config, accessKey, installName, agentId) {
  const scope = process.env.AI_MEMORY_INSTALL_SCOPE || await choose(
    "Where should Codex store the ai-memory config?",
    [
      { key: "1", label: "project/local", value: "project/local" },
      { key: "2", label: "global/user", value: "global/user" }
    ],
    "1"
  );

  const defaultPath = scope === "global/user"
    ? path.join(os.homedir(), ".codex", "config.toml")
    : path.join(cwd, ".codex", "config.toml");
  const configPath = process.env.AI_MEMORY_CODEX_CONFIG_PATH
    || await ask("Codex config path", defaultPath);
  const installRecord = {
    type: "codex",
    agentId,
    scope,
    path: configPath
  };
  validateInstallRecord(installName, installRecord);

  const existingContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const inspect = inspectCodexConfig(existingContent, config.serverName);
  if (inspect.exists) {
    const overwrite = process.env.AI_MEMORY_OVERWRITE_EXISTING
      ? parseBoolean(process.env.AI_MEMORY_OVERWRITE_EXISTING, true)
      : await confirm(`Existing Codex ai-memory entry found at ${configPath}. Replace it?`, true);
    if (!overwrite) {
      throw new Error("Install cancelled.");
    }
  }

  const nextContent = upsertCodexConfig(existingContent, config.serverName, config.url, config.clientId, {
    accessKey
  });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, nextContent);

  persistInstall(config, installName, installRecord);
  printInstallSummary(installName, agentId, configPath, "Restart Codex after config changes so it reloads MCP servers.");
}

async function installClaude(config, accessKey, installName, agentId) {
  if (!commandExists("claude")) {
    throw new Error("Claude Code CLI ('claude') is not installed or not on PATH.");
  }

  const scope = process.env.CLAUDE_MCP_SCOPE || await choose(
    "Where should Claude store the ai-memory config?",
    [
      { key: "1", label: "project", value: "project" },
      { key: "2", label: "user", value: "user" },
      { key: "3", label: "local", value: "local" }
    ],
    "1"
  );

  const getResult = spawnSync("claude", ["mcp", "get", "--scope", scope, config.serverName], { encoding: "utf8" });
  if (getResult.status === 0) {
    const overwrite = process.env.AI_MEMORY_OVERWRITE_EXISTING
      ? parseBoolean(process.env.AI_MEMORY_OVERWRITE_EXISTING, true)
      : await confirm(`Existing Claude ai-memory entry found in scope '${scope}'. Replace it?`, true);
    if (!overwrite) {
      throw new Error("Install cancelled.");
    }
    spawnSync("claude", ["mcp", "remove", "--scope", scope, config.serverName], { stdio: "ignore" });
  }

  const addArgs = [
    "mcp",
    "add",
    "--transport",
    "http",
    "--scope",
    scope,
    "--header",
    `x-memory-key: ${accessKey}`
  ];
  if (config.clientId) {
    addArgs.push("--header", `x-memory-client-id: ${config.clientId}`);
  }
  addArgs.push(config.serverName, config.url);
  run("claude", addArgs);

  const installRecord = {
    type: "claude",
    agentId,
    scope
  };
  validateInstallRecord(installName, installRecord);
  persistInstall(config, installName, installRecord);

  printInstallSummary(installName, agentId, `Claude scope '${scope}'`, "Restart Claude if it was already running.");
}

function persistInstall(config, installName, record) {
  const now = new Date().toISOString();
  const next = upsertInstallRecord(config, installName, record);
  next.updatedAt = now;
  next.createdAt = next.createdAt || now;
  writeUserConfig(paths.configPath, next);
}

function runDoctor() {
  const issues = [];
  const configExists = fs.existsSync(paths.configPath);
  const envExists = fs.existsSync(paths.envPath);

  if (!configExists) {
    issues.push(`Missing config file: ${paths.configPath}`);
  }
  if (!envExists) {
    issues.push(`Missing env file: ${paths.envPath}`);
  }

  if (configExists) {
    const config = readUserConfig(paths.configPath);
    if (!config.url) {
      issues.push("Config file is missing 'url'.");
    }
    for (const [installName, record] of Object.entries(config.installs)) {
      try {
        validateInstallRecord(installName, record);
      } catch (error) {
        issues.push(error.message);
        continue;
      }
      if (record.type === "codex" && record.path && !fs.existsSync(record.path)) {
        issues.push(`Codex install '${installName}' points to a missing path: ${record.path}`);
      }
    }
  }

  if (envExists) {
    const envValues = readEnvFile(paths.envPath);
    if (!envValues.MEMORY_MCP_ACCESS_KEY) {
      issues.push("Env file is missing MEMORY_MCP_ACCESS_KEY.");
    }
    const mode = envFileMode(paths.envPath);
    if (mode !== null && mode !== 0o600) {
      issues.push(`Env file permissions should be 600, found ${mode.toString(8)}.`);
    }
  }

  console.log(`Config path: ${paths.configPath}`);
  console.log(`Env path: ${paths.envPath}`);
  if (issues.length === 0) {
    console.log("Doctor check passed.");
    return;
  }
  console.log("Doctor found issues:");
  for (const issue of issues) {
    console.log(`- ${issue}`);
  }
  process.exitCode = 1;
}

function printInstallSummary(installName, agentId, target, restartMessage) {
  console.log(`Using config: ${paths.configPath}`);
  console.log(`Using secret: ${paths.envPath}`);
  console.log(`Install '${installName}' is configured to write as agent '${agentId}'.`);
  console.log(`Updated host target: ${target}`);
  console.log(restartMessage);
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai-memory-cli.mjs init
  node scripts/ai-memory-cli.mjs install <codex|claude>
  node scripts/ai-memory-cli.mjs doctor`);
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

function run(command, runArgs) {
  const result = spawnSync(command, runArgs, {
    stdio: "inherit",
    cwd
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${runArgs.join(" ")}`);
  }
}

function createPromptInterface() {
  return readline.createInterface({ input, output });
}

function defaultInstallName(type) {
  return type === "claude" ? "main-claude" : "main-codex";
}

function defaultAgentId(type) {
  return type === "claude" ? "reviewer-a" : "coder-a";
}

function commandExists(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
  return result.status === 0;
}

function parseBoolean(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}
