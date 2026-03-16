import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_SERVER_NAME = "ai-memory";
export const DEFAULT_CONFIG_ROOT = path.join(os.homedir(), ".ai-config", "ai-memory");
export const BUILTIN_AGENT_IDS = ["claude", "codex", "cursor", "openclaw"];

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
    agents: {},
    currentAgent: "",
    createdAt: null,
    updatedAt: null
  };
}

export function normalizeUserConfig(input = {}) {
  const base = defaultUserConfig();
  const migrated = migrateLegacyShape(input);
  const agents = normalizeAgents(migrated.agents);
  const currentAgent = normalizeCurrentAgent(migrated.currentAgent, agents);

  return {
    serverName: String(migrated.serverName || base.serverName),
    url: String(migrated.url || base.url),
    agents,
    currentAgent,
    createdAt: migrated.createdAt || null,
    updatedAt: migrated.updatedAt || null
  };
}

export function readUserConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return normalizeUserConfig();
  }
  return normalizeUserConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
}

export function writeUserConfig(configPath, config) {
  backupLegacyConfigIfNeeded(configPath);
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

export function listAgentIds(config) {
  return Object.keys(normalizeUserConfig(config).agents).sort();
}

export function upsertAgent(config, agentId, record = {}) {
  validateAgentId(agentId);
  const next = normalizeUserConfig(config);
  const current = next.agents[agentId] ?? defaultAgentRecord();
  next.agents[agentId] = normalizeAgent({
    ...current,
    ...record
  });
  return next;
}

export function addAgentNamespace(config, agentId, namespace) {
  const next = normalizeUserConfig(config);
  const current = next.agents[agentId] ?? defaultAgentRecord();
  next.agents[agentId] = normalizeAgent({
    ...current,
    namespaces: [...current.namespaces, namespace]
  });
  return next;
}

export function setCurrentAgent(config, agentId) {
  const next = normalizeUserConfig(config);
  next.currentAgent = normalizeCurrentAgent(agentId, next.agents);
  return next;
}

export function getCurrentAgent(config) {
  const normalized = normalizeUserConfig(config);
  const agentId = normalized.currentAgent;
  if (!agentId) {
    return null;
  }
  const agent = normalized.agents[agentId];
  if (!agent) {
    return null;
  }
  return { agentId, ...agent };
}

export function getAgentRecord(config, agentId) {
  const normalized = normalizeUserConfig(config);
  const agent = normalized.agents[String(agentId || "").trim()];
  return agent ? { agentId: String(agentId || "").trim(), ...agent } : null;
}

export function listScopedAgents(config) {
  const normalized = normalizeUserConfig(config);
  return Object.entries(normalized.agents)
    .filter(([, agent]) => agent.authMode === "scoped")
    .map(([agentId, agent]) => ({ agentId, ...agent }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

export function listCompatibleAgentsForHost(config, hostId) {
  const normalizedHost = String(hostId || "").trim();
  const normalized = normalizeUserConfig(config);
  return Object.entries(normalized.agents)
    .filter(([agentId]) => agentId === normalizedHost)
    .map(([agentId, agent]) => ({ agentId, ...agent }));
}

export function resolveHostAgent(config, hostId) {
  const normalized = normalizeUserConfig(config);
  const targetHost = String(hostId || "").trim();
  if (!targetHost) {
    return { match: null, reason: "missing-host" };
  }

  const direct = normalized.agents[targetHost];
  if (direct) {
    return {
      match: { agentId: targetHost, ...direct },
      reason: "host-match"
    };
  }

  if (normalized.currentAgent === targetHost && normalized.agents[targetHost]) {
    return {
      match: { agentId: targetHost, ...normalized.agents[targetHost] },
      reason: "current-agent"
    };
  }

  const agents = Object.entries(normalized.agents)
    .map(([agentId, agent]) => ({ agentId, ...agent }));
  if (agents.length === 1) {
    return {
      match: agents[0],
      reason: "single-agent"
    };
  }

  return { match: null, reason: "missing-host-agent" };
}

export function validateClientId(clientId) {
  if (!String(clientId || "").trim()) {
    throw new Error("Scoped client ID is required");
  }
}

export function validateAgentId(agentId) {
  if (!String(agentId || "").trim()) {
    throw new Error("Agent ID is required");
  }
}

export function validateAgentRecord(agentId, record) {
  validateAgentId(agentId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Agent '${agentId}' must be an object`);
  }
  const authMode = normalizeAuthMode(record.authMode ?? "scoped");
  if (authMode === "scoped") {
    validateClientId(record.clientId);
  }
  if (authMode === "shared" && String(record.clientId || "").trim()) {
    throw new Error(`Shared agent '${agentId}' must not define a scoped client ID`);
  }
}

function migrateLegacyShape(input) {
  const base = defaultUserConfig();
  if (!isPlainObject(input)) {
    return { ...base };
  }

  const hasLegacyShape = "clientId" in input || "installs" in input;
  const hasIntermediateShape = "clients" in input || hasLegacyAgentShape(input.agents);

  if (!hasLegacyShape && !hasIntermediateShape) {
    return {
      ...base,
      ...input
    };
  }

  const serverName = input.serverName || base.serverName;
  const url = input.url || base.url;
  const createdAt = input.createdAt || null;
  const updatedAt = input.updatedAt || null;

  if (hasLegacyShape) {
    return migrateFromLegacyConfig({ serverName, url, createdAt, updatedAt, ...input });
  }

  return migrateFromIntermediateConfig({ serverName, url, createdAt, updatedAt, ...input });
}

function migrateFromLegacyConfig(input) {
  const legacyClientId = String(input.clientId || "").trim();
  const installs = isPlainObject(input.installs) ? input.installs : {};
  const agents = {};

  for (const [installKey, record] of Object.entries(installs)) {
    const inferredHost = inferAgentKey(record, installKey);
    if (!inferredHost) {
      continue;
    }
    agents[inferredHost] = normalizeAgent({
      authMode: legacyClientId ? "scoped" : "shared",
      clientId: legacyClientId,
      namespaces: []
    });
  }

  return {
    serverName: input.serverName,
    url: input.url,
    agents,
    currentAgent: normalizeCurrentAgent(input.currentAgent, agents),
    createdAt: input.createdAt || null,
    updatedAt: input.updatedAt || null
  };
}

function migrateFromIntermediateConfig(input) {
  const clients = isPlainObject(input.clients) ? input.clients : {};
  const inputAgents = isPlainObject(input.agents) ? input.agents : {};
  const scopedClientIds = Object.entries(clients)
    .filter(([, value]) => normalizeAuthMode(value?.authMode ?? "scoped") === "scoped")
    .map(([clientId]) => String(clientId || "").trim())
    .filter(Boolean);
  const fallbackScopedClientId = scopedClientIds.length === 1 ? scopedClientIds[0] : "";

  const agents = {};
  for (const [rawAgentId, value] of Object.entries(inputAgents)) {
    const inferredAgentId = inferAgentKey(value, rawAgentId);
    if (!inferredAgentId) {
      continue;
    }

    const rawClientId = String(value?.clientId || "").trim();
    const clientAuthMode = rawClientId
      ? normalizeAuthMode(clients[rawClientId]?.authMode ?? "scoped")
      : (fallbackScopedClientId ? "scoped" : "shared");
    const clientId = clientAuthMode === "scoped"
      ? (rawClientId || fallbackScopedClientId)
      : "";

    agents[inferredAgentId] = normalizeAgent({
      authMode: clientAuthMode,
      clientId,
      namespaces: Array.isArray(value?.namespaces) ? value.namespaces : []
    });
  }

  return {
    serverName: input.serverName,
    url: input.url,
    agents,
    currentAgent: normalizeCurrentAgent(mapLegacyCurrentAgent(input.currentAgent, inputAgents, agents), agents),
    createdAt: input.createdAt || null,
    updatedAt: input.updatedAt || null
  };
}

function normalizeAgents(input) {
  if (!isPlainObject(input)) {
    return {};
  }

  const next = {};
  for (const [agentId, value] of Object.entries(input)) {
    if (!String(agentId || "").trim()) {
      continue;
    }
    const normalized = normalizeAgent(value);
    try {
      validateAgentRecord(agentId, normalized);
      next[agentId] = normalized;
    } catch {
      continue;
    }
  }
  return next;
}

function defaultAgentRecord() {
  return {
    authMode: "scoped",
    clientId: "",
    namespaces: []
  };
}

function normalizeAgent(input = {}) {
  const authMode = normalizeAuthMode(input.authMode ?? "scoped");
  const clientId = authMode === "scoped"
    ? String(input.clientId || "").trim()
    : "";
  return {
    authMode,
    clientId,
    namespaces: dedupeNamespaces(Array.isArray(input.namespaces) ? input.namespaces : [])
  };
}

function normalizeCurrentAgent(currentAgent, agents) {
  const normalized = String(currentAgent || "").trim();
  if (normalized && agents[normalized]) {
    return normalized;
  }
  return Object.keys(agents)[0] || "";
}

function normalizeAuthMode(value) {
  return value === "shared" ? "shared" : "scoped";
}

function dedupeNamespaces(namespaces) {
  const seen = new Set();
  const next = [];

  for (const namespace of namespaces) {
    const normalized = normalizeNamespace(namespace);
    const key = JSON.stringify(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(normalized);
  }

  return next;
}

function normalizeNamespace(namespace = {}) {
  return {
    scope: namespace.scope ?? "global",
    workspace_id: namespace.workspace_id ?? null,
    agent_id: namespace.agent_id ?? null,
    topic: namespace.topic ?? null,
    tags: Array.isArray(namespace.tags) ? Array.from(new Set(namespace.tags.map(String))) : []
  };
}

function inferAgentKey(record, fallbackKey = "") {
  const explicitHost = String(record?.type || record?.host || record?.agentHost || "").trim().toLowerCase();
  if (BUILTIN_AGENT_IDS.includes(explicitHost)) {
    return explicitHost;
  }
  const fallback = String(fallbackKey || "").trim().toLowerCase();
  if (BUILTIN_AGENT_IDS.includes(fallback)) {
    return fallback;
  }
  const explicitAgentId = String(record?.agentId || "").trim().toLowerCase();
  if (BUILTIN_AGENT_IDS.includes(explicitAgentId)) {
    return explicitAgentId;
  }
  return fallback || explicitAgentId;
}

function mapLegacyCurrentAgent(currentAgent, inputAgents, migratedAgents) {
  const normalized = String(currentAgent || "").trim();
  if (!normalized) {
    return "";
  }
  if (migratedAgents[normalized]) {
    return normalized;
  }
  const source = isPlainObject(inputAgents) ? inputAgents[normalized] : null;
  if (!source) {
    return normalized;
  }
  return inferAgentKey(source, normalized);
}

function hasLegacyAgentShape(agents) {
  if (!isPlainObject(agents)) {
    return false;
  }
  return Object.values(agents).some((value) => isPlainObject(value) && ("clientId" in value || "namespaces" in value));
}

function backupLegacyConfigIfNeeded(configPath) {
  if (!fs.existsSync(configPath)) {
    return;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const isLegacy = isPlainObject(parsed)
    && ("clientId" in parsed || "installs" in parsed || "clients" in parsed);
  if (!isLegacy) {
    return;
  }

  const backupsDir = path.join(path.dirname(configPath), "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const backupPath = path.join(backupsDir, `config-legacy-${Date.now()}.json`);
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, raw);
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
