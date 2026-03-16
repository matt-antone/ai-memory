#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";

import {
  envFileMode,
  getAgentServerName,
  getCurrentAgent,
  readEnvFile,
  readUserConfig,
  resolveAiMemoryPaths,
  resolveHostAgent,
  setCurrentAgent,
  upsertAgent,
  validateAgentId,
  validateClientId,
  writeEnvFile,
  writeUserConfig
} from "../src/utils/user-config.js";

import {
  inspectCodexConfig,
  inspectJsonServerConfig,
  upsertCodexConfig,
  upsertJsonServerConfig
} from "../src/utils/agent-config.js";
import { resolveChoice } from "../src/utils/prompt.js";

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
    if (!["codex", "claude", "cursor", "openclaw"].includes(host)) {
      throw new Error("Install target must be one of: codex, claude, cursor, openclaw");
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
  let config = readUserConfig(paths.configPath);
  const currentEnv = readEnvFile(paths.envPath);

  const url = process.env.AI_MEMORY_INIT_URL
    || await ask("Memory MCP endpoint URL", config.url || defaultUrl);
  const accessKey = process.env.AI_MEMORY_INIT_ACCESS_KEY
    || await ask("Memory MCP access key", currentEnv.MEMORY_MCP_ACCESS_KEY || process.env.MEMORY_MCP_ACCESS_KEY || "");

  let agentId = process.env.AI_MEMORY_INIT_AGENT_ID || "";
  if (!agentId) {
    const existingCurrent = getCurrentAgent(config);
    agentId = await ask("Current agent ID", existingCurrent?.agentId || defaultAgentId("codex"));
  }
  validateAgentId(agentId);

  let authMode = process.env.AI_MEMORY_INIT_AUTH_MODE || "";
  if (!authMode) {
    const existingCurrent = getCurrentAgent(config);
    authMode = existingCurrent?.authMode || "scoped";
  }
  authMode = authMode === "shared" ? "shared" : "scoped";

  let clientId = process.env.AI_MEMORY_INIT_CLIENT_ID || "";
  if (authMode === "scoped" && !clientId) {
    const existingCurrent = getCurrentAgent(config);
    clientId = await ask("Scoped client ID", existingCurrent?.clientId || process.env.MEMORY_MCP_CLIENT_ID || "ai-memory-client");
  }
  if (authMode === "scoped") {
    validateClientId(clientId);
  } else {
    clientId = "";
  }

  config = {
    ...config,
    url
  };
  config = upsertAgent(config, agentId, { authMode, clientId });
  config = setCurrentAgent(config, agentId);
  const now = new Date().toISOString();
  config.createdAt = config.createdAt || now;
  config.updatedAt = now;

  fs.mkdirSync(paths.backupsDir, { recursive: true });
  writeUserConfig(paths.configPath, config);

  const agentSecrets = parseAgentSecrets(currentEnv.MEMORY_MCP_AGENT_SECRETS_JSON);
  agentSecrets[agentId] = { authMode, clientId, secret: accessKey };
  writeEnvFile(paths.envPath, {
    MEMORY_MCP_ACCESS_KEY: accessKey,
    MEMORY_MCP_CLIENT_ID: clientId,
    MEMORY_MCP_AGENT_SECRETS_JSON: JSON.stringify(agentSecrets)
  });

  console.log(`Initialized ai-memory config at: ${paths.configPath}`);
  console.log(`Stored ai-memory secret at: ${paths.envPath}`);
}

async function runInstall(type) {
  let config = readUserConfig(paths.configPath);
  const envValues = readEnvFile(paths.envPath);
  const accessKey = envValues.MEMORY_MCP_ACCESS_KEY || process.env.MEMORY_MCP_ACCESS_KEY || "";

  if (!config.url) {
    throw new Error(`Missing URL in ${paths.configPath}. Run 'ai-memory init' first.`);
  }
  if (!accessKey) {
    throw new Error(`Missing MEMORY_MCP_ACCESS_KEY in ${paths.envPath}. Run 'ai-memory init' first.`);
  }

  const selection = resolveInstallSelection(config, type);
  let nextConfig = selection.updatedConfig;

  if (type === "claude") {
    const defaultServerName = getAgentServerName(nextConfig, selection.agentId);
    const serverName = (process.env.AI_MEMORY_SERVER_NAME
      || await ask("Claude MCP server name", defaultServerName)).trim();
    if (!serverName) {
      throw new Error("Claude MCP server name is required.");
    }
    nextConfig = upsertAgent(nextConfig, selection.agentId, { serverName });
  }

  writeUserConfig(paths.configPath, nextConfig);

  const effectiveClientId = selection.authMode === "scoped" ? selection.clientId : "";
  if (type === "codex") {
    await installCodex(nextConfig, accessKey, effectiveClientId, selection.agentId);
    return;
  }
  if (type === "claude") {
    await installClaude(nextConfig, accessKey, effectiveClientId, selection.agentId);
    return;
  }
  if (type === "cursor") {
    await installJsonHost("Cursor", "cursor", nextConfig, effectiveClientId, selection.agentId);
    return;
  }
  await installJsonHost("OpenClaw", "openclaw", nextConfig, effectiveClientId, selection.agentId);
}

function resolveInstallSelection(config, hostId) {
  const resolved = resolveHostAgent(config, hostId);
  if (!resolved.match) {
    throw new Error(`No '${hostId}' agent is configured in ${paths.configPath}. Run 'npm run onboard' and create that host agent first.`);
  }

  const updatedConfig = setCurrentAgent(config, resolved.match.agentId);
  return {
    updatedConfig,
    agentId: resolved.match.agentId,
    clientId: resolved.match.clientId,
    authMode: resolved.match.authMode
  };
}

async function installCodex(config, accessKey, clientId, agentId) {
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

  const nextContent = upsertCodexConfig(existingContent, config.serverName, config.url, clientId, {
    accessKey
  });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, nextContent);

  printInstallSummary(agentId, clientId, configPath, "Restart Codex after config changes so it reloads MCP servers.");
}

async function installClaude(config, accessKey, clientId, agentId) {
  if (!commandExists("claude")) {
    throw new Error("Claude Code CLI ('claude') is not installed or not on PATH.");
  }

  const serverName = getAgentServerName(config, agentId);

  const scope = process.env.CLAUDE_MCP_SCOPE || await choose(
    "Where should Claude store the ai-memory config?",
    [
      { key: "1", label: "project", value: "project" },
      { key: "2", label: "user", value: "user" },
      { key: "3", label: "local", value: "local" }
    ],
    "1"
  );

  const getResult = spawnSync("claude", ["mcp", "get", "--scope", scope, serverName], { encoding: "utf8" });
  if (getResult.status === 0) {
    const overwrite = process.env.AI_MEMORY_OVERWRITE_EXISTING
      ? parseBoolean(process.env.AI_MEMORY_OVERWRITE_EXISTING, true)
      : await confirm(`Existing Claude ai-memory entry '${serverName}' found in scope '${scope}'. Replace it?`, true);
    if (!overwrite) {
      throw new Error("Install cancelled.");
    }
    spawnSync("claude", ["mcp", "remove", "--scope", scope, serverName], { stdio: "ignore" });
  }

  const addArgs = [
    "mcp",
    "add",
    "--transport",
    "http",
    "--scope",
    scope,
    serverName,
    config.url
  ];
  addArgs.push("--header", `x-memory-key: ${accessKey}`);
  if (clientId) {
    addArgs.push("--header", `x-memory-client-id: ${clientId}`);
  }
  const addResult = runCapture("claude", addArgs);
  if (addResult.status !== 0) {
    const combinedOutput = `${addResult.stdout || ""}\n${addResult.stderr || ""}`;
    if (isClaudeAlreadyExistsError(combinedOutput)) {
      const overwrite = process.env.AI_MEMORY_OVERWRITE_EXISTING
        ? parseBoolean(process.env.AI_MEMORY_OVERWRITE_EXISTING, true)
        : await confirm(`Claude reports '${serverName}' already exists in scope '${scope}'. Replace it?`, true);
      if (!overwrite) {
        throw new Error("Install cancelled.");
      }

      const removeResult = runCapture("claude", ["mcp", "remove", "--scope", scope, serverName]);
      if (removeResult.status !== 0) {
        throw new Error(formatCommandFailure("claude", ["mcp", "remove", "--scope", scope, serverName], removeResult));
      }

      const retryResult = runCapture("claude", addArgs);
      if (retryResult.status !== 0) {
        throw new Error(formatCommandFailure("claude", addArgs, retryResult));
      }
    } else {
      throw new Error(formatCommandFailure("claude", addArgs, addResult));
    }
  }

  printInstallSummary(agentId, clientId, `Claude scope '${scope}' as '${serverName}'`, "Restart Claude if it was already running.");
}

async function installJsonHost(label, hostId, config, clientId, agentId) {
  const scope = process.env.AI_MEMORY_INSTALL_SCOPE || await choose(
    `Where should ${label} store the ai-memory config?`,
    [
      { key: "1", label: "project/local", value: "project/local" },
      { key: "2", label: "global/user", value: "global/user" }
    ],
    "1"
  );

  const pathConfig = resolveJsonHostConfigPath(hostId, scope);
  const envStyle = hostId === "cursor" ? "cursor" : "plain";
  const envFile = hostId === "cursor" && scope === "project/local" ? "${workspaceFolder}/.env" : undefined;
  const overrideEnvVar = hostId === "cursor" ? "AI_MEMORY_CURSOR_CONFIG_PATH" : "AI_MEMORY_OPENCLAW_CONFIG_PATH";
  const configPath = process.env[overrideEnvVar] || await ask(`${label} config path`, pathConfig);
  const sourceServerName = getAgentServerName(config, agentId);
  const serverName = hostId === "cursor"
    ? normalizeCursorServerName(sourceServerName)
    : sourceServerName;
  const aliasesToRemove = hostId === "cursor" && sourceServerName !== serverName
    ? [sourceServerName]
    : [];

  const existingContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const inspect = inspectJsonServerConfig(existingContent, serverName);
  if (inspect.exists) {
    const overwrite = process.env.AI_MEMORY_OVERWRITE_EXISTING
      ? parseBoolean(process.env.AI_MEMORY_OVERWRITE_EXISTING, true)
      : await confirm(`Existing ${label} ai-memory entry found at ${configPath}. Replace it?`, true);
    if (!overwrite) {
      throw new Error("Install cancelled.");
    }
  }

  const nextContent = upsertJsonServerConfig(existingContent, serverName, config.url, clientId, {
    envStyle,
    envFile,
    aliasesToRemove
  });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, nextContent);

  const restartMessage = hostId === "cursor"
    ? "Open Cursor and confirm the MCP server is enabled for the selected scope."
    : "Restart OpenClaw or reload its MCP settings after config changes.";
  printInstallSummary(agentId, clientId, configPath, restartMessage);
}

function normalizeCursorServerName(serverName) {
  const normalized = String(serverName || "").replace(/[^A-Za-z0-9_]/g, "_");
  return normalized || "ai_memory";
}

function resolveJsonHostConfigPath(hostId, scope) {
  if (hostId === "cursor") {
    return scope === "global/user"
      ? path.join(os.homedir(), ".cursor", "mcp.json")
      : path.join(cwd, ".cursor", "mcp.json");
  }
  return scope === "global/user"
    ? path.join(os.homedir(), ".openclaw", "openclaw.json")
    : path.join(cwd, ".openclaw", "openclaw.json");
}

function runDoctor() {
  const issues = [];
  const configExists = fs.existsSync(paths.configPath);
  const envExists = fs.existsSync(paths.envPath);
  let hasScopedAgentsInRawConfig = false;

  if (!configExists) {
    issues.push(`Missing config file: ${paths.configPath}`);
  }
  if (!envExists) {
    issues.push(`Missing env file: ${paths.envPath}`);
  }

  let config = null;
  if (configExists) {
    const rawConfig = readRawJson(paths.configPath);
    config = readUserConfig(paths.configPath);
    if (!config.url) {
      issues.push("Config file is missing 'url'.");
    }
    if (!String(rawConfig?.currentAgent || "").trim()) {
      issues.push("Config file is missing 'currentAgent'.");
    } else if (!config.agents[String(rawConfig.currentAgent).trim()]) {
      issues.push(`Current agent '${String(rawConfig.currentAgent).trim()}' does not exist.`);
    }

    const rawAgents = rawConfig?.agents && typeof rawConfig.agents === "object" && !Array.isArray(rawConfig.agents)
      ? rawConfig.agents
      : {};
    hasScopedAgentsInRawConfig = Object.values(rawAgents).some((agent) => (
      agent
      && typeof agent === "object"
      && !Array.isArray(agent)
      && agent.authMode !== "shared"
    ));
    for (const [agentId, agent] of Object.entries(rawAgents)) {
      if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
        issues.push(`Agent '${agentId}' must be an object.`);
        continue;
      }
      const authMode = agent.authMode === "shared" ? "shared" : "scoped";
      const clientId = String(agent.clientId || "").trim();
      if (authMode === "scoped" && !clientId) {
        issues.push(`Scoped agent '${agentId}' is missing a scoped client ID.`);
      }
      if (authMode === "shared" && clientId) {
        issues.push(`Shared agent '${agentId}' must not define a scoped client ID.`);
      }
    }

    for (const [agentId, agent] of Object.entries(config.agents)) {
      if (agent.authMode === "scoped" && !agent.clientId) {
        issues.push(`Scoped agent '${agentId}' is missing a scoped client ID.`);
      }
      if (agent.authMode === "shared" && agent.clientId) {
        issues.push(`Shared agent '${agentId}' must not define a scoped client ID.`);
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

    if (hasScopedAgentsInRawConfig || (config && Object.values(config.agents).some((agent) => agent.authMode === "scoped"))) {
      const secrets = parseAgentSecrets(envValues.MEMORY_MCP_AGENT_SECRETS_JSON);
      if (Object.keys(secrets).length === 0) {
        issues.push("Env file is missing parseable MEMORY_MCP_AGENT_SECRETS_JSON for scoped agents.");
      }
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

function printInstallSummary(agentId, clientId, target, restartMessage) {
  console.log(`Using config: ${paths.configPath}`);
  console.log(`Using secret: ${paths.envPath}`);
  console.log(`Using agent '${agentId}'.`);
  if (clientId) {
    console.log(`Scoped client ID: '${clientId}'.`);
  }
  console.log(`Updated host target: ${target}`);
  console.log(restartMessage);
}

function printHelp() {
  console.log(`Usage:
  node scripts/ai-memory-cli.mjs init
  node scripts/ai-memory-cli.mjs install <codex|claude|cursor|openclaw>
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
  return resolveChoice(options, selected, fallbackKey).value;
}

function runCapture(command, runArgs) {
  const result = spawnSync(command, runArgs, {
    cwd,
    encoding: "utf8"
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

function createPromptInterface() {
  return readline.createInterface({ input, output });
}

function defaultAgentId(type) {
  return type === "claude" ? "claude" : type;
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

function parseAgentSecrets(raw) {
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
        .filter(([agentId, value]) => String(agentId || "").trim() && value && typeof value === "object" && !Array.isArray(value))
        .map(([agentId, value]) => [
          agentId,
          {
            authMode: value.authMode === "shared" ? "shared" : "scoped",
            clientId: String(value.clientId || ""),
            secret: String(value.secret || "")
          }
        ])
    );
  } catch {
    return {};
  }
}

function isClaudeAlreadyExistsError(output) {
  return /already exists/i.test(output);
}

function formatCommandFailure(command, runArgs, result) {
  const details = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  return details
    ? `Command failed: ${command} ${runArgs.join(" ")}\n${details}`
    : `Command failed: ${command} ${runArgs.join(" ")}`;
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function readRawJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
