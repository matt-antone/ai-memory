import { dotProduct, lexicalScore, normalizeRecency } from "../core/ranking.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function matchesNamespace(itemNamespace = {}, requestedNamespace = {}) {
  const entries = Object.entries(requestedNamespace || {}).filter(([, value]) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return value !== null && value !== undefined && value !== "";
  });

  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      const actual = Array.isArray(itemNamespace[key]) ? itemNamespace[key] : [];
      const missing = value.some((entry) => !actual.includes(entry));
      if (missing) {
        return false;
      }
      continue;
    }

    if (itemNamespace[key] !== value) {
      return false;
    }
  }

  return true;
}

export class InMemoryStore {
  constructor() {
    this.items = new Map();
    this.embeddings = new Map();
    this.edges = [];
    this.events = [];
  }

  async createItem(item) {
    this.items.set(item.id, clone(item));
    return clone(item);
  }

  async createEmbedding(record) {
    this.embeddings.set(record.item_id, clone(record));
    return clone(record);
  }

  async createEdge(edge) {
    this.edges.push(clone(edge));
    return clone(edge);
  }

  async createEvent(event) {
    this.events.push(clone(event));
    return clone(event);
  }

  async getItem(id) {
    const item = this.items.get(id);
    return item ? clone(item) : null;
  }

  async updateItem(id, patch) {
    const item = this.items.get(id);
    if (!item) {
      return null;
    }

    const updated = { ...item, ...clone(patch) };
    this.items.set(id, updated);
    return clone(updated);
  }

  async archiveItem(id) {
    return this.updateItem(id, { is_archived: true });
  }

  async listRecent({ namespace, limit = 10 } = {}) {
    return Array.from(this.items.values())
      .filter((item) => !item.is_archived)
      .filter((item) => matchesNamespace(item.namespace, namespace))
      .sort((a, b) => {
        const aTime = new Date(a.last_accessed_at ?? a.created_at).getTime();
        const bTime = new Date(b.last_accessed_at ?? b.created_at).getTime();
        return bTime - aTime;
      })
      .slice(0, limit)
      .map(clone);
  }

  async searchCandidates({ query, queryEmbedding, namespace, filters, mode, limit = 10 }) {
    const candidates = [];

    for (const item of this.items.values()) {
      if (item.is_archived) {
        continue;
      }

      if (!matchesNamespace(item.namespace, namespace)) {
        continue;
      }

      if (filters?.kind && item.kind !== filters.kind) {
        continue;
      }

      if (filters?.source_type && item.source_type !== filters.source_type) {
        continue;
      }

      const storedEmbedding = this.embeddings.get(item.id)?.embedding ?? null;
      const vectorScore = queryEmbedding && storedEmbedding ? Math.max(0, dotProduct(queryEmbedding, storedEmbedding)) : 0;
      const text = [item.content, item.summary, ...(item.tags ?? [])].filter(Boolean).join(" ");
      const textScore = lexicalScore(query, text);

      if (mode === "vector" && vectorScore === 0) {
        continue;
      }

      if (mode === "lexical" && textScore === 0) {
        continue;
      }

      if (mode === "hybrid" && vectorScore === 0 && textScore === 0) {
        continue;
      }

      candidates.push({
        item: clone(item),
        vectorScore,
        lexicalScore: textScore,
        recencyScore: normalizeRecency(item.created_at),
        importanceScore: Number(item.importance || 0)
      });
    }

    return candidates
      .sort((a, b) => {
        const primary = (b.vectorScore + b.lexicalScore) - (a.vectorScore + a.lexicalScore);
        if (primary !== 0) {
          return primary;
        }
        return b.importanceScore - a.importanceScore;
      })
      .slice(0, limit);
  }

  async expandEdges({ itemIds, depth = 1 }) {
    const seenIds = new Set(itemIds);
    const results = [];
    let frontier = [...itemIds];

    for (let currentDepth = 0; currentDepth < depth; currentDepth += 1) {
      const next = [];
      for (const edge of this.edges) {
        if (!frontier.includes(edge.from_id) && !frontier.includes(edge.to_id)) {
          continue;
        }

        const relatedId = frontier.includes(edge.from_id) ? edge.to_id : edge.from_id;
        if (seenIds.has(relatedId)) {
          continue;
        }

        const item = this.items.get(relatedId);
        if (!item || item.is_archived) {
          continue;
        }

        seenIds.add(relatedId);
        next.push(relatedId);
        results.push({
          edge: clone(edge),
          item: clone(item)
        });
      }
      frontier = next;
      if (frontier.length === 0) {
        break;
      }
    }

    return results;
  }
}
