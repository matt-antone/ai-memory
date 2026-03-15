function createHeaders(apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
}

async function parseResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase request failed with status ${response.status}`);
  }

  return data;
}

export class SupabaseRestStore {
  constructor({ url, serviceRoleKey, schema = "public", fetchImpl = fetch }) {
    if (!url || !serviceRoleKey) {
      throw new Error("Supabase url and service role key are required");
    }

    this.url = url.replace(/\/$/, "");
    this.schema = schema;
    this.fetch = fetchImpl;
    this.headers = createHeaders(serviceRoleKey);
  }

  async createItem(item) {
    const response = await this.fetch(`${this.url}/rest/v1/memory_items`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(item)
    });
    const data = await parseResponse(response);
    return Array.isArray(data) ? data[0] : data;
  }

  async createEmbedding(record) {
    const response = await this.fetch(`${this.url}/rest/v1/memory_embeddings`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(record)
    });
    const data = await parseResponse(response);
    return Array.isArray(data) ? data[0] : data;
  }

  async createEdge(edge) {
    const response = await this.fetch(`${this.url}/rest/v1/memory_edges`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(edge)
    });
    const data = await parseResponse(response);
    return Array.isArray(data) ? data[0] : data;
  }

  async createEvent(event) {
    const response = await this.fetch(`${this.url}/rest/v1/memory_events`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(event)
    });
    const data = await parseResponse(response);
    return Array.isArray(data) ? data[0] : data;
  }

  async getItem(id) {
    const response = await this.fetch(
      `${this.url}/rest/v1/memory_items?id=eq.${encodeURIComponent(id)}&select=*`,
      { headers: this.headers }
    );
    const data = await parseResponse(response);
    return data[0] ?? null;
  }

  async updateItem(id, patch) {
    const response = await this.fetch(
      `${this.url}/rest/v1/memory_items?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: this.headers,
        body: JSON.stringify(patch)
      }
    );
    const data = await parseResponse(response);
    return data[0] ?? null;
  }

  async archiveItem(id) {
    return this.updateItem(id, { is_archived: true });
  }

  async listRecent({ namespace, limit = 10 } = {}) {
    const response = await this.fetch(
      `${this.url}/rest/v1/memory_items?select=*&is_archived=eq.false&order=last_accessed_at.desc.nullslast,created_at.desc&limit=${limit}`,
      { headers: this.headers }
    );
    const data = await parseResponse(response);
    return data.filter((item) => matchesNamespace(item.namespace, namespace));
  }

  async searchCandidates({ query, queryEmbedding, namespace, filters, mode, limit = 10 }) {
    const response = await this.fetch(`${this.url}/rest/v1/rpc/memory_search`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        p_query: query,
        p_query_embedding: queryEmbedding ?? null,
        p_namespace: namespace ?? {},
        p_filters: filters ?? {},
        p_mode: mode,
        p_limit: limit
      })
    });
    const data = await parseResponse(response);
    return data.map((candidate) => ({
      item: candidate.item,
      vectorScore: Number(candidate.vector_score || 0),
      lexicalScore: Number(candidate.lexical_score || 0),
      recencyScore: Number(candidate.recency_score || 0),
      importanceScore: Number(candidate.importance_score || 0)
    }));
  }

  async expandEdges({ itemIds, depth = 1 }) {
    const response = await this.fetch(`${this.url}/rest/v1/rpc/memory_expand_context`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        p_item_ids: itemIds,
        p_depth: depth
      })
    });
    return parseResponse(response);
  }
}

function matchesNamespace(itemNamespace = {}, requestedNamespace = {}) {
  return Object.entries(requestedNamespace || {}).every(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      return true;
    }
    if (Array.isArray(value)) {
      const current = Array.isArray(itemNamespace[key]) ? itemNamespace[key] : [];
      return value.every((entry) => current.includes(entry));
    }
    return itemNamespace?.[key] === value;
  });
}
