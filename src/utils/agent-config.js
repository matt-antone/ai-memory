function createHeaders(clientId, options = {}) {
  const { envStyle = "plain", accessKey = "" } = options;
  const envRef = (name) => envStyle === "cursor" ? `\${env:${name}}` : `\${${name}}`;
  const headers = {
    "x-memory-key": accessKey || envRef("MEMORY_MCP_ACCESS_KEY")
  };

  if (clientId) {
    headers["x-memory-client-id"] = clientId;
  }

  return headers;
}

function createJsonServerConfig(url, clientId, options = {}) {
  const config = {
    type: "http",
    url,
    headers: createHeaders(clientId, options)
  };

  if (options.envFile) {
    config.envFile = options.envFile;
  }

  return config;
}

function ensureObject(value, fallback) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  return value;
}

function parseJsonConfig(content) {
  const raw = (content ?? "").trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw);
  return ensureObject(parsed, {});
}

function normalizeJsonConfig(content) {
  const data = parseJsonConfig(content);
  data.mcpServers = ensureObject(data.mcpServers, {});
  return data;
}

function jsonServerLooksManaged(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }

  const headers = ensureObject(entry.headers, {});
  const usesLegacyEnvRefs = headers["x-memory-key"] === "${MEMORY_MCP_ACCESS_KEY}"
    && (
      headers["x-memory-client-id"] === undefined
      || typeof headers["x-memory-client-id"] === "string"
    );
  const usesCursorEnvRefs = headers["x-memory-key"] === "${env:MEMORY_MCP_ACCESS_KEY}"
    && (
      headers["x-memory-client-id"] === undefined
      || typeof headers["x-memory-client-id"] === "string"
    );

  return entry.type === "http"
    && typeof entry.url === "string"
    && (usesLegacyEnvRefs || usesCursorEnvRefs);
}

export function inspectJsonServerConfig(content, serverName) {
  const data = normalizeJsonConfig(content);
  const entry = data.mcpServers[serverName];

  return {
    exists: Boolean(entry),
    managed: jsonServerLooksManaged(entry)
  };
}

export function upsertJsonServerConfig(content, serverName, url, clientId = "", options = {}) {
  const data = normalizeJsonConfig(content);
  for (const alias of options.aliasesToRemove ?? []) {
    if (alias && alias !== serverName) {
      delete data.mcpServers[alias];
    }
  }
  data.mcpServers[serverName] = createJsonServerConfig(url, clientId, options);
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function removeJsonServerConfig(content, serverName) {
  const data = normalizeJsonConfig(content);
  delete data.mcpServers[serverName];
  return `${JSON.stringify(data, null, 2)}\n`;
}

function codexBlock(serverName, url, clientId, options = {}) {
  const { accessKey = "" } = options;
  const lines = [
    "# >>> ai-memory managed block >>>",
    `[mcp_servers.${serverName}]`,
    `url = "${url}"`
  ];

  if (!accessKey) {
    lines.push('bearer_token_env_var = "MEMORY_MCP_ACCESS_KEY"');
  }

  lines.push(
    "",
    `[mcp_servers.${serverName}.http_headers]`,
    accessKey ? `x-memory-key = "${accessKey}"` : 'x-memory-key = "MCP_BEARER_TOKEN"'
  );

  if (clientId) {
    lines.push(`x-memory-client-id = "${clientId}"`);
  }

  lines.push("# <<< ai-memory managed block <<<");
  return lines.join("\n");
}

function parseCodexLines(content) {
  return (content ?? "").split(/\r?\n/);
}

function stripManagedCodexBlock(lines) {
  const kept = [];
  let skip = false;

  for (const line of lines) {
    if (line.trim() === "# >>> ai-memory managed block >>>") {
      skip = true;
      continue;
    }
    if (line.trim() === "# <<< ai-memory managed block <<<") {
      skip = false;
      continue;
    }
    if (!skip) {
      kept.push(line);
    }
  }

  return kept;
}

function stripCodexServerSection(lines, serverName) {
  const kept = [];
  const rootHeader = `[mcp_servers.${serverName}]`;
  const nestedPrefix = `[mcp_servers.${serverName}.`;
  let skip = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === rootHeader || trimmed.startsWith(nestedPrefix)) {
      skip = true;
      continue;
    }
    if (skip && trimmed.startsWith("[") && !trimmed.startsWith(nestedPrefix)) {
      skip = false;
    }
    if (!skip) {
      kept.push(line);
    }
  }

  return kept;
}

export function inspectCodexConfig(content, serverName) {
  const lines = parseCodexLines(content);
  const rootHeader = `[mcp_servers.${serverName}]`;
  const marker = "# >>> ai-memory managed block >>>";
  const hasManagedMarker = lines.some((line) => line.trim() === marker);
  const hasServerEntry = lines.some((line) => line.trim() === rootHeader);

  return {
    exists: hasServerEntry,
    managed: hasManagedMarker
  };
}

export function upsertCodexConfig(content, serverName, url, clientId = "", options = {}) {
  let lines = parseCodexLines(content);
  lines = stripManagedCodexBlock(lines);
  lines = stripCodexServerSection(lines, serverName);

  const cleaned = lines.join("\n").trimEnd();
  const pieces = [];
  if (cleaned) {
    pieces.push(cleaned);
  }
  pieces.push(codexBlock(serverName, url, clientId, options));
  return `${pieces.join("\n\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function removeCodexConfig(content, serverName) {
  let lines = parseCodexLines(content);
  lines = stripManagedCodexBlock(lines);
  lines = stripCodexServerSection(lines, serverName);
  const cleaned = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned ? `${cleaned}\n` : "";
}
