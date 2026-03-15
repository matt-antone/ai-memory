const DEFAULT_WEIGHTS = {
  vector: 0.45,
  lexical: 0.35,
  recency: 0.1,
  importance: 0.1
};

export function dotProduct(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }

  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += Number(a[i] || 0) * Number(b[i] || 0);
  }
  return total;
}

export function normalizeRecency(createdAt, now = new Date()) {
  const created = new Date(createdAt);
  const ageMs = Math.max(0, now.getTime() - created.getTime());
  const halfLifeMs = 1000 * 60 * 60 * 24 * 14;
  return 1 / (1 + ageMs / halfLifeMs);
}

export function combineScores(candidate, weights = DEFAULT_WEIGHTS) {
  const vectorScore = Number(candidate.vectorScore || 0);
  const lexicalScore = Number(candidate.lexicalScore || 0);
  const recencyScore = Number(candidate.recencyScore || 0);
  const importanceScore = Number(candidate.importanceScore || 0);
  const total =
    vectorScore * weights.vector +
    lexicalScore * weights.lexical +
    recencyScore * weights.recency +
    importanceScore * weights.importance;

  return {
    total,
    breakdown: {
      vector: vectorScore,
      lexical: lexicalScore,
      recency: recencyScore,
      importance: importanceScore
    }
  };
}

export function lexicalScore(query, content) {
  const queryTokens = tokenize(query);
  const contentTokens = tokenize(content);

  if (queryTokens.length === 0 || contentTokens.length === 0) {
    return 0;
  }

  const contentSet = new Set(contentTokens);
  let matches = 0;
  for (const token of queryTokens) {
    if (contentSet.has(token)) {
      matches += 1;
    }
  }

  return matches / queryTokens.length;
}

export function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}
