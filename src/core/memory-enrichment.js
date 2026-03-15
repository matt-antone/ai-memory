const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have", "how",
  "i", "if", "in", "into", "is", "it", "its", "of", "on", "or", "our", "that", "the", "their",
  "this", "to", "use", "uses", "using", "was", "we", "what", "when", "where", "with", "you", "your"
]);

const MAX_DERIVED_TAGS = 12;
const MAX_SEARCH_HINTS = 16;

export function enrichMemoryInput(input) {
  const content = String(input.content ?? "").trim();
  const summary = String(input.summary ?? "").trim();
  const metadata = isObject(input.metadata) ? clone(input.metadata) : {};
  const namespace = isObject(input.namespace) ? input.namespace : {};
  const explicitTags = sanitizeTags(input.tags);

  const derivedTags = deriveTags({
    kind: input.kind,
    sourceType: input.source_type,
    content,
    summary,
    metadata,
    namespace
  });

  const tags = Array.from(new Set([...explicitTags, ...derivedTags])).slice(0, explicitTags.length + MAX_DERIVED_TAGS);
  const searchHints = deriveSearchHints({
    kind: input.kind,
    sourceType: input.source_type,
    content,
    summary,
    metadata,
    namespace,
    tags
  });

  metadata.retrieval = {
    ...(isObject(metadata.retrieval) ? metadata.retrieval : {}),
    kind: input.kind,
    source_type: input.source_type ?? null,
    namespace: {
      scope: namespace.scope ?? null,
      workspace_id: namespace.workspace_id ?? null,
      agent_id: namespace.agent_id ?? null,
      topic: namespace.topic ?? null
    },
    explicit_tags: explicitTags,
    derived_tags: derivedTags,
    search_hints: searchHints
  };

  const normalizedSummary = summary || buildFallbackSummary({ content, kind: input.kind, tags });

  return {
    ...input,
    summary: normalizedSummary,
    tags,
    metadata
  };
}

function deriveTags({ kind, sourceType, content, summary, metadata, namespace }) {
  const collected = [
    normalizeTag(kind),
    normalizeTag(sourceType),
    normalizeTag(namespace.scope),
    normalizeTag(namespace.topic),
    normalizeTag(namespace.workspace_id),
    ...tokenizeObject(metadata),
    ...extractTopTokens(`${summary} ${content}`)
  ];

  return uniqueNormalized(collected).slice(0, MAX_DERIVED_TAGS);
}

function deriveSearchHints({ kind, sourceType, content, summary, metadata, namespace, tags }) {
  return uniqueNormalized([
    normalizeTag(kind),
    normalizeTag(sourceType),
    normalizeTag(namespace.scope),
    normalizeTag(namespace.topic),
    normalizeTag(namespace.workspace_id),
    ...tags,
    ...tokenizeObject(metadata),
    ...extractTopTokens(`${summary} ${content}`, MAX_SEARCH_HINTS)
  ]).slice(0, MAX_SEARCH_HINTS);
}

function buildFallbackSummary({ content, kind, tags }) {
  const sentence = content.split(/\n+/).map((part) => part.trim()).find(Boolean) ?? content;
  const shortened = sentence.length > 180 ? `${sentence.slice(0, 177).trim()}...` : sentence;
  const tagText = tags.length > 0 ? ` Tags: ${tags.slice(0, 4).join(", ")}.` : "";
  return `${kind} memory: ${shortened}${tagText}`.trim();
}

function tokenizeObject(value) {
  if (!isObject(value)) {
    return [];
  }

  const tokens = [];
  for (const [key, entry] of Object.entries(value)) {
    tokens.push(...tokenize(key));
    if (typeof entry === "string") {
      tokens.push(...tokenize(entry));
    } else if (typeof entry === "number" || typeof entry === "boolean") {
      tokens.push(String(entry).toLowerCase());
    } else if (Array.isArray(entry)) {
      for (const child of entry) {
        if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
          tokens.push(...tokenize(String(child)));
        } else if (isObject(child)) {
          tokens.push(...tokenizeObject(child));
        }
      }
    } else if (isObject(entry)) {
      tokens.push(...tokenizeObject(entry));
    }
  }
  return uniqueNormalized(tokens);
}

function extractTopTokens(text, limit = MAX_DERIVED_TAGS) {
  const counts = new Map();
  for (const token of tokenize(text)) {
    if (STOP_WORDS.has(token) || token.length < 3) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return uniqueNormalized(tags);
}

function uniqueNormalized(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeTag(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeTag(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9/_-]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
