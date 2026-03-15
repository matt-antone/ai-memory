import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SERVER_NAME = "ai-memory";
export const DEFAULT_CONFIG_ROOT = path.join(os.homedir(), ".ai-config", "ai-memory");

export function resolveAiMemoryPaths(configRoot = DEFAULT_CONFIG_ROOT) {
  return {
    root: configRoot,
    configPath: path.join(configRoot, "config.json"),
    envPath: path.join(configRoot, "env"),
    backupsDir: path.join(configRoot, "backups")
  };
}

export function defaultUserConfig() {
  return {
    serverName: DEFAULT_SERVER_NAME,
    url: "https://your-project-ref.supabase.co/functions/v1/memory-mcp",
    clientId: "",
    installs: {},
    createdAt: null,
    updatedAt: null
  };
}

export function normalizeUserConfig(input = {}) {
  const base = defaultUserConfig();
  const installs = input.installs && typeof input.installs === "object" && !Array.isArray(input.installs)
    ? input.installs
    : {};

  return {
    serverName: String(input.serverName || base.serverName),
    url: String(input.url || base.url),
    clientId: input.clientId ? String(input.clientId) : "",
    installs,
    createdAt: input.createdAt || null,
    updatedAt: input.updatedAt || null
  };
}

export function readUserConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return normalizeUserConfig();
  }
  return normalizeUserConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
}

export function writeUserConfig(configPath, config) {
  const next = normalizeUserConfig(config);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
}

export function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    values[key] = parseEnvValue(rawValue);
  }
  return values;
}

export function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  return parseEnvFile(fs.readFileSync(envPath, "utf8"));
}

export function writeEnvFile(envPath, values) {
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  const lines = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`);
  fs.writeFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

export function envFileMode(envPath) {
  if (!fs.existsSync(envPath)) {
    return null;
  }
  return fs.statSync(envPath).mode & 0o777;
}

export function installRecordExists(config, installName) {
  return Boolean(normalizeUserConfig(config).installs[installName]);
}

export function upsertInstallRecord(config, installName, record) {
  const next = normalizeUserConfig(config);
  next.installs[installName] = {
    ...next.installs[installName],
    ...record
  };
  return next;
}

export function validateInstallRecord(installName, record) {
  if (!installName || !String(installName).trim()) {
    throw new Error("Install name is required");
  }
  if (!record || typeof record !== "object") {
    throw new Error(`Install '${installName}' must be an object`);
  }
  if (!String(record.type || "").trim()) {
    throw new Error(`Install '${installName}' must include a type`);
  }
  if (!String(record.agentId || "").trim()) {
    throw new Error(`Install '${installName}' must include an agentId`);
  }
}

function parseEnvValue(rawValue) {
  if (!rawValue) {
    return "";
  }
  if ((rawValue.startsWith("\"") && rawValue.endsWith("\"")) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return rawValue.slice(1, -1);
    }
  }
  return rawValue;
}
