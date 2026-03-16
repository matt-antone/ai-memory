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
  getAgentRecord,
  getAgentServerName,
  getCurrentAgent,
  listAgentIds,
  readEnvFile,
  readUserConfig,
  resolveAiMemoryPaths,
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
  removeJsonServerConfig,
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

  if (command === "self-install") {
    await runSelfInstall();
    return 0;
  }

  if (command === "doctor") {
    await runDoctor();
    return process.exitCode ?? 0;
  }

  if (command === "status") {
    await runStatus();
    return 0;
  }

  if (command === "install-all") {
    const hosts = args[1] ? args.slice(1) : ["codex", "cursor", "openclaw"];
    for (const h of hosts) {
      if (!["codex", "claude", "cursor", "openclaw"].includes(h)) {
        throw new Error(`Unknown host: ${h}. Must be one of: codex, claude, cursor, openclaw`);
      }
    }
    for (const h of hosts) {
      console.log(`\n--- Installing ${h} ---`);
      await runInstall(h);
    }
    return 0;
  }

  if (command === "uninstall") {
    if (!["codex", "claude", "cursor", "openclaw"].includes(host)) {
      throw new Error("Uninstall target must be one of: codex, claude, cursor, openclaw");
    }
    await runUninstall(host);
    return 0;
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

  let installKey = process.env.AI_MEMORY_INIT_INSTALL_KEY || process.env.AI_MEMORY_INIT_AGENT_ID || "";
  if (!installKey) {
    const existingCurrent = getCurrentAgent(config);
    installKey = await ask("Install key", existingCurrent?.agentId || "personal-codex");
  }
  validateAgentId(installKey);

  let authMode = process.env.AI_MEMORY_INIT_AUTH_MODE || "";
  if (!authMode) {
    const existingCurrent = getCurrentAgent(config);
    authMode = existingCurrent?.authMode || "scoped";
  }
  authMode = authMode === "shared" ? "shared" : "scoped";

  let clientId = process.env.AI_MEMORY_INIT_CLIENT_ID || "";
  if (authMode === "scoped" && !clientId) {
    const existingCurrent = getCurrentAgent(config);
    clientId = await ask("Scoped client ID", existingCurrent?.clientId || process.env.MEMORY_MCP_CLIENT_ID || installKey);
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
  config = upsertAgent(config, installKey, { authMode, clientId });
  config = setCurrentAgent(config, installKey);
  const now = new Date().toISOString();
  config.createdAt = config.createdAt || now;
  config.updatedAt = now;

  fs.mkdirSync(paths.backupsDir, { recursive: true });
  writeUserConfig(paths.configPath, config);

  const agentSecrets = parseAgentSecrets(currentEnv.MEMORY_MCP_AGENT_SECRETS_JSON);
  agentSecrets[installKey] = { authMode, clientId, secret: accessKey };
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
    await installJsonHost("Cursor", "cursor", nextConfig, accessKey, effectiveClientId, selection.agentId);
    return;
  }
  await installJsonHost("OpenClaw", "openclaw", nextConfig, accessKey, effectiveClientId, selection.agentId);
}

function resolveInstallSelection(config, _hostId) {
  const current = getCurrentAgent(config);
  if (current) {
    const updatedConfig = setCurrentAgent(config, current.agentId);
    return {
      updatedConfig,
      agentId: current.agentId,
      clientId: current.clientId,
      authMode: current.authMode
    };
  }

  const installKeys = listAgentIds(config);
  if (installKeys.length === 1) {
    const only = getAgentRecord(config, installKeys[0]);
    if (only) {
      const updatedConfig = setCurrentAgent(config, only.agentId);
      return {
        updatedConfig,
        agentId: only.agentId,
        clientId: only.clientId,
        authMode: only.authMode
      };
    }
  }

  if (installKeys.length === 0) {
    throw new Error(`No install key is configured in ${paths.configPath}. Run 'npm run onboard' or 'npm run ai-memory -- init' first.`);
  }

  throw new Error(
    `No current install key is set in ${paths.configPath}. ` +
    `Set one with 'npm run ai-memory -- init' (or keep exactly one install key to auto-resolve).`
  );
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

async function installJsonHost(label, hostId, config, accessKey, clientId, agentId) {
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
  const envFile = hostId === "cursor"
    ? (scope === "project/local" ? "${workspaceFolder}/.env" : paths.envPath)
    : undefined;
  const overrideEnvVar = hostId === "cursor" ? "AI_MEMORY_CURSOR_CONFIG_PATH" : "AI_MEMORY_OPENCLAW_CONFIG_PATH";
  const configPath = process.env[overrideEnvVar] || await ask(`${label} config path`, pathConfig);
  const configuredServerName = getAgentServerName(config, agentId);
  const hostServerName = resolveJsonHostServerName(configuredServerName, hostId);

  const existingContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const inspect = inspectJsonServerConfig(existingContent, hostServerName);
  if (inspect.exists) {
    const overwrite = process.env.AI_MEMORY_OVERWRITE_EXISTING
      ? parseBoolean(process.env.AI_MEMORY_OVERWRITE_EXISTING, true)
      : await confirm(`Existing ${label} ai-memory entry found at ${configPath}. Replace it?`, true);
    if (!overwrite) {
      throw new Error("Install cancelled.");
    }
  }

  const keyOverride = hostId === "cursor" ? accessKey : "";
  let baseContent = existingContent;
  if (hostServerName !== configuredServerName) {
    const legacyInspect = inspectJsonServerConfig(baseContent, configuredServerName);
    if (legacyInspect.exists && legacyInspect.managed) {
      baseContent = removeJsonServerConfig(baseContent, configuredServerName);
    }
  }

  const nextContent = upsertJsonServerConfig(baseContent, hostServerName, config.url, clientId, {
    envStyle,
    envFile,
    accessKey: keyOverride
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

function resolveJsonHostServerName(serverName, hostId) {
  const baseName = String(serverName || "").trim() || "ai-memory";
  if (hostId !== "cursor" && hostId !== "openclaw") {
    return baseName;
  }
  return baseName.replace(/[^A-Za-z0-9_]/g, "_");
}

async function runSelfInstall() {
  const projectRoot = path.resolve(new URL(".", import.meta.url).pathname, "..");
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Cannot find package.json at ${pkgPath}`);
  }

  console.log("Installing ai-memory CLI globally...");
  const result = spawnSync("npm", ["install", "-g", projectRoot], {
    stdio: "inherit",
    cwd: projectRoot
  });
  if (result.status !== 0) {
    throw new Error("Global install failed. You may need to run with sudo or fix npm permissions.");
  }

  // Verify the binary is on PATH
  const verifyResult = spawnSync("ai-memory", ["--help"], { encoding: "utf8", stdio: "pipe" });
  if (verifyResult.status === 0) {
    console.log("\nai-memory CLI installed globally. Available from any terminal.");
  } else {
    console.warn("\nInstall completed but 'ai-memory' not found on PATH.");
    console.warn("You may need to restart your shell or check your npm global bin directory.");
  }
}

async function runStatus() {
  const config = readUserConfig(paths.configPath);
  const envValues = readEnvFile(paths.envPath);
  const current = getCurrentAgent(config);
  const installKeys = listAgentIds(config);

  console.log(`Endpoint:       ${config.url || "(not set)"}`);
  console.log(`Install key:    ${current?.agentId || "(none)"}`);
  console.log(`Auth mode:      ${current?.authMode || "(unknown)"}`);
  if (current?.authMode === "scoped") {
    console.log(`Client ID:      ${current.clientId || "(not set)"}`);
  }
  console.log(`Access key:     ${envValues.MEMORY_MCP_ACCESS_KEY ? "(set)" : "(missing)"}`);
  console.log(`Installs:       ${installKeys.length > 0 ? installKeys.join(", ") : "(none)"}`);
  console.log("");

  const hosts = [
    { id: "codex", label: "Codex", check: checkCodexInstalled },
    { id: "claude", label: "Claude", check: checkClaudeInstalled },
    { id: "cursor", label: "Cursor", check: checkCursorInstalled },
    { id: "openclaw", label: "OpenClaw", check: checkOpenClawInstalled }
  ];

  console.log("Host status:");
  for (const h of hosts) {
    const installed = h.check(config, current?.agentId);
    console.log(`  ${h.label.padEnd(12)} ${installed ? "installed" : "not installed"}`);
  }
}

function checkCodexInstalled(config, agentId) {
  const localPath = path.join(cwd, ".codex", "config.toml");
  const globalPath = path.join(os.homedir(), ".codex", "config.toml");
  for (const p of [localPath, globalPath]) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf8");
      const inspect = inspectCodexConfig(content, config.serverName);
      if (inspect.exists) return true;
    }
  }
  return false;
}

function checkClaudeInstalled(_config, _agentId) {
  if (!commandExists("claude")) return false;
  const result = spawnSync("claude", ["mcp", "list"], { encoding: "utf8" });
  return result.status === 0 && /ai.memory/i.test(result.stdout);
}

function checkCursorInstalled(config, agentId) {
  const serverName = resolveJsonHostServerName(getAgentServerName(config, agentId || "cursor"), "cursor");
  const localPath = path.join(cwd, ".cursor", "mcp.json");
  const globalPath = path.join(os.homedir(), ".cursor", "mcp.json");
  for (const p of [localPath, globalPath]) {
    if (fs.existsSync(p)) {
      const inspect = inspectJsonServerConfig(fs.readFileSync(p, "utf8"), serverName);
      if (inspect.exists) return true;
    }
  }
  return false;
}

function checkOpenClawInstalled(config, agentId) {
  const serverName = resolveJsonHostServerName(getAgentServerName(config, agentId || "openclaw"), "openclaw");
  const localPath = path.join(cwd, ".openclaw", "openclaw.json");
  const globalPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  for (const p of [localPath, globalPath]) {
    if (fs.existsSync(p)) {
      const inspect = inspectJsonServerConfig(fs.readFileSync(p, "utf8"), serverName);
      if (inspect.exists) return true;
    }
  }
  return false;
}

async function runUninstall(type) {
  const config = readUserConfig(paths.configPath);
  const current = getCurrentAgent(config);
  const agentId = current?.agentId || "";

  if (type === "codex") {
    const localPath = path.join(cwd, ".codex", "config.toml");
    const globalPath = path.join(os.homedir(), ".codex", "config.toml");
    let removed = false;
    for (const p of [localPath, globalPath]) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf8");
        const inspect = inspectCodexConfig(content, config.serverName);
        if (inspect.exists) {
          const yes = await confirm(`Remove ai-memory from ${p}?`, true);
          if (yes) {
            // For Codex TOML, remove the managed block
            const lines = content.split("\n");
            const filtered = [];
            let inBlock = false;
            for (const line of lines) {
              if (line.includes("[mcp_servers.") && line.includes(config.serverName || "ai-memory")) {
                inBlock = true;
                continue;
              }
              if (inBlock && line.startsWith("[")) {
                inBlock = false;
              }
              if (!inBlock) {
                filtered.push(line);
              }
            }
            fs.writeFileSync(p, filtered.join("\n"));
            console.log(`Removed from ${p}`);
            removed = true;
          }
        }
      }
    }
    if (!removed) console.log("No Codex ai-memory config found to remove.");
    return;
  }

  if (type === "claude") {
    if (!commandExists("claude")) {
      throw new Error("Claude Code CLI ('claude') is not installed or not on PATH.");
    }
    const serverName = getAgentServerName(config, agentId);
    for (const scope of ["project", "user", "local"]) {
      const getResult = spawnSync("claude", ["mcp", "get", "--scope", scope, serverName], { encoding: "utf8" });
      if (getResult.status === 0) {
        const yes = await confirm(`Remove '${serverName}' from Claude scope '${scope}'?`, true);
        if (yes) {
          spawnSync("claude", ["mcp", "remove", "--scope", scope, serverName], { stdio: "inherit" });
          console.log(`Removed '${serverName}' from Claude scope '${scope}'.`);
        }
      }
    }
    return;
  }

  // cursor or openclaw — JSON-based
  const hostId = type;
  const label = type === "cursor" ? "Cursor" : "OpenClaw";
  const serverName = resolveJsonHostServerName(getAgentServerName(config, agentId || type), hostId);
  const paths_ = hostId === "cursor"
    ? [path.join(cwd, ".cursor", "mcp.json"), path.join(os.homedir(), ".cursor", "mcp.json")]
    : [path.join(cwd, ".openclaw", "openclaw.json"), path.join(os.homedir(), ".openclaw", "openclaw.json")];

  let removed = false;
  for (const p of paths_) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf8");
      const inspect = inspectJsonServerConfig(content, serverName);
      if (inspect.exists) {
        const yes = await confirm(`Remove ai-memory from ${p}?`, true);
        if (yes) {
          const nextContent = removeJsonServerConfig(content, serverName);
          fs.writeFileSync(p, nextContent);
          console.log(`Removed from ${p}`);
          removed = true;
        }
      }
    }
  }
  if (!removed) console.log(`No ${label} ai-memory config found to remove.`);
}

async function runDoctor() {
  const runId = `doctor-${Date.now()}`;
  // #region agent log
  debugLog({
    runId,
    hypothesisId: "H1",
    location: "scripts/ai-memory-cli.mjs:runDoctor:start",
    message: "Doctor run started",
    data: {
      configPath: paths.configPath,
      envPath: paths.envPath
    }
  });
  // #endregion
  const issues = [];
  const configExists = fs.existsSync(paths.configPath);
  const envExists = fs.existsSync(paths.envPath);
  let hasScopedInstallsInRawConfig = false;
  let configUrl = "";
  let configCurrentInstallKey = "";
  let configInstallCount = 0;
  let currentInstallAuthMode = "";
  let currentInstallClientIdPresent = false;

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
    configUrl = String(config.url || "");
    configCurrentInstallKey = String(config.currentInstallKey || "");
    configInstallCount = Object.keys(config.installs || {}).length;
    const currentInstall = configCurrentInstallKey ? config.installs[configCurrentInstallKey] : null;
    currentInstallAuthMode = String(currentInstall?.authMode || "");
    currentInstallClientIdPresent = Boolean(String(currentInstall?.clientId || "").trim());
    // #region agent log
    debugLog({
      runId,
      hypothesisId: "H1",
      location: "scripts/ai-memory-cli.mjs:runDoctor:config",
      message: "Loaded ai-memory config",
      data: {
        configUrl,
        currentInstallKey: configCurrentInstallKey,
        installCount: configInstallCount,
        currentInstallAuthMode,
        currentInstallClientIdPresent
      }
    });
    // #endregion
    if (!config.url) {
      issues.push("Config file is missing 'url'.");
    }
    const rawCurrentInstallKey = String(rawConfig?.currentInstallKey ?? rawConfig?.currentAgent ?? "").trim();
    if (!rawCurrentInstallKey) {
      issues.push("Config file is missing 'currentInstallKey'.");
    } else if (!config.installs[rawCurrentInstallKey]) {
      issues.push(`Current install key '${rawCurrentInstallKey}' does not exist.`);
    }

    const rawInstalls = rawConfig?.installs && typeof rawConfig.installs === "object" && !Array.isArray(rawConfig.installs)
      ? rawConfig.installs
      : (rawConfig?.agents && typeof rawConfig.agents === "object" && !Array.isArray(rawConfig.agents)
        ? rawConfig.agents
        : {});
    hasScopedInstallsInRawConfig = Object.values(rawInstalls).some((install) => (
      install
      && typeof install === "object"
      && !Array.isArray(install)
      && install.authMode !== "shared"
    ));
    for (const [installKey, install] of Object.entries(rawInstalls)) {
      if (!install || typeof install !== "object" || Array.isArray(install)) {
        issues.push(`Install '${installKey}' must be an object.`);
        continue;
      }
      const authMode = install.authMode === "shared" ? "shared" : "scoped";
      const clientId = String(install.clientId || "").trim();
      if (authMode === "scoped" && !clientId) {
        issues.push(`Scoped install '${installKey}' is missing a scoped client ID.`);
      }
      if (authMode === "shared" && clientId) {
        issues.push(`Shared install '${installKey}' must not define a scoped client ID.`);
      }
    }

    for (const [installKey, install] of Object.entries(config.installs)) {
      if (install.authMode === "scoped" && !install.clientId) {
        issues.push(`Scoped install '${installKey}' is missing a scoped client ID.`);
      }
      if (install.authMode === "shared" && install.clientId) {
        issues.push(`Shared install '${installKey}' must not define a scoped client ID.`);
      }
    }
  }

  if (envExists) {
    const envValues = readEnvFile(paths.envPath);
    // #region agent log
    debugLog({
      runId,
      hypothesisId: "H2",
      location: "scripts/ai-memory-cli.mjs:runDoctor:env",
      message: "Loaded ai-memory env",
      data: {
        hasAccessKey: Boolean(String(envValues.MEMORY_MCP_ACCESS_KEY || "").trim()),
        hasClientId: Boolean(String(envValues.MEMORY_MCP_CLIENT_ID || "").trim()),
        hasAgentSecretsJson: Boolean(String(envValues.MEMORY_MCP_AGENT_SECRETS_JSON || "").trim())
      }
    });
    // #endregion
    if (!envValues.MEMORY_MCP_ACCESS_KEY) {
      issues.push("Env file is missing MEMORY_MCP_ACCESS_KEY.");
    }
    const mode = envFileMode(paths.envPath);
    if (mode !== null && mode !== 0o600) {
      issues.push(`Env file permissions should be 600, found ${mode.toString(8)}.`);
    }

    if (hasScopedInstallsInRawConfig || (config && Object.values(config.installs).some((install) => install.authMode === "scoped"))) {
      const secrets = parseAgentSecrets(envValues.MEMORY_MCP_AGENT_SECRETS_JSON);
      // #region agent log
      debugLog({
        runId,
        hypothesisId: "H2",
        location: "scripts/ai-memory-cli.mjs:runDoctor:scoped-secrets",
        message: "Checked scoped install secrets",
        data: {
          scopedInstallExpected: true,
          scopedSecretsCount: Object.keys(secrets).length
        }
      });
      // #endregion
      if (Object.keys(secrets).length === 0) {
        issues.push("Env file is missing parseable MEMORY_MCP_AGENT_SECRETS_JSON for scoped installs.");
      }
    }
  }

  const cursorPaths = [
    path.join(cwd, ".cursor", "mcp.json"),
    path.join(os.homedir(), ".cursor", "mcp.json")
  ];
  const configuredCursorServerName = getAgentServerName(config || {}, configCurrentInstallKey || "cursor");
  const normalizedCursorServerName = resolveJsonHostServerName(configuredCursorServerName, "cursor");
  for (const cursorPath of cursorPaths) {
    const exists = fs.existsSync(cursorPath);
    let hasServer = false;
    let managed = false;
    let entryType = "";
    let entryUrl = "";
    let hasEnvFile = false;
    let keyHeader = "";
    let selectedServerName = configuredCursorServerName;
    if (exists) {
      const raw = fs.readFileSync(cursorPath, "utf8");
      const configuredInspect = inspectJsonServerConfig(raw, configuredCursorServerName);
      const normalizedInspect = normalizedCursorServerName === configuredCursorServerName
        ? configuredInspect
        : inspectJsonServerConfig(raw, normalizedCursorServerName);
      const inspection = normalizedInspect.exists ? normalizedInspect : configuredInspect;
      selectedServerName = normalizedInspect.exists ? normalizedCursorServerName : configuredCursorServerName;
      hasServer = inspection.exists;
      managed = inspection.managed;
      const parsed = readRawJson(cursorPath) || {};
      const entry = parsed?.mcpServers?.[selectedServerName] || {};
      entryType = String(entry.type || "");
      entryUrl = String(entry.url || "");
      hasEnvFile = Boolean(entry.envFile);
      keyHeader = String(entry?.headers?.["x-memory-key"] || "");
    }
    // #region agent log
    debugLog({
      runId,
      hypothesisId: "H3",
      location: "scripts/ai-memory-cli.mjs:runDoctor:cursor-config",
      message: "Inspected Cursor MCP config path",
      data: {
        cursorPath,
        exists,
        configuredServerName: configuredCursorServerName,
        normalizedServerName: normalizedCursorServerName,
        selectedServerName,
        hasServer,
        managed,
        entryType,
        entryUrl,
        hasEnvFile,
        usesCursorEnvRef: keyHeader === "${env:MEMORY_MCP_ACCESS_KEY}",
        usesLegacyEnvRef: keyHeader === "${MEMORY_MCP_ACCESS_KEY}"
      }
    });
    // #endregion
  }

  if (configUrl) {
    try {
      const envValues = envExists ? readEnvFile(paths.envPath) : {};
      const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      };
      const accessKey = String(envValues.MEMORY_MCP_ACCESS_KEY || "");
      const probeBody = JSON.stringify({
        jsonrpc: "2.0",
        id: "doctor-ping",
        method: "tools/list",
        params: {}
      });
      const noAuthResponse = await fetch(configUrl, {
        method: "POST",
        headers,
        body: probeBody
      });
      // #region agent log
      debugLog({
        runId,
        hypothesisId: "H4",
        location: "scripts/ai-memory-cli.mjs:runDoctor:endpoint-probe-no-auth",
        message: "Probed MCP endpoint without auth headers",
        data: {
          endpoint: configUrl,
          status: noAuthResponse.status,
          ok: noAuthResponse.ok
        }
      });
      // #endregion
      if (accessKey) {
        const authedHeaders = {
          ...headers,
          "x-memory-key": accessKey
        };
        if (currentInstallAuthMode === "scoped") {
          const scopedClientId = String(envValues.MEMORY_MCP_CLIENT_ID || "");
          if (scopedClientId) {
            authedHeaders["x-memory-client-id"] = scopedClientId;
          }
        }
        const authedResponse = await fetch(configUrl, {
          method: "POST",
          headers: authedHeaders,
          body: probeBody
        });
        // #region agent log
        debugLog({
          runId,
          hypothesisId: "H5",
          location: "scripts/ai-memory-cli.mjs:runDoctor:endpoint-probe-with-auth",
          message: "Probed MCP endpoint with auth headers",
          data: {
            endpoint: configUrl,
            status: authedResponse.status,
            ok: authedResponse.ok,
            scopedAuthMode: currentInstallAuthMode === "scoped"
          }
        });
        // #endregion
      }
    } catch (error) {
      // #region agent log
      debugLog({
        runId,
        hypothesisId: "H4",
        location: "scripts/ai-memory-cli.mjs:runDoctor:endpoint-probe-error",
        message: "MCP endpoint probe failed",
        data: {
          endpoint: configUrl,
          errorMessage: String(error?.message || error)
        }
      });
      // #endregion
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

function debugLog({ runId, hypothesisId, location, message, data }) {
  fetch("http://127.0.0.1:7331/ingest/0f7b4832-031b-423c-aeca-769ceeaa022a", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "2d2875"
    },
    body: JSON.stringify({
      sessionId: "2d2875",
      runId,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
}

function printInstallSummary(agentId, clientId, target, restartMessage) {
  console.log(`Using config: ${paths.configPath}`);
  console.log(`Using secret: ${paths.envPath}`);
  console.log(`Using install key '${agentId}'.`);
  if (clientId) {
    console.log(`Scoped client ID: '${clientId}'.`);
  }
  console.log(`Updated host target: ${target}`);
  console.log(restartMessage);
}

function printHelp() {
  console.log(`Usage:
  ai-memory self-install                           Install the CLI globally (survives project deletion)
  ai-memory init                                   Initialize config and credentials
  ai-memory install <codex|claude|cursor|openclaw>  Install MCP server for a host
  ai-memory install-all [hosts...]                  Install for all hosts (default: codex cursor openclaw)
  ai-memory uninstall <codex|claude|cursor|openclaw> Remove MCP server from a host
  ai-memory status                                  Show config and host install status
  ai-memory doctor                                  Validate config, env, and connectivity

Notes:
  - "install key" is the write identity used across hosts
  - install commands use the current install key from config`);
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
