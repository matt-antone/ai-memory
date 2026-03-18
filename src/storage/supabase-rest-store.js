import { upstreamError } from "../core/runtime-errors.js";

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
    throw upstreamError(
      data?.message || data?.error || `Supabase request failed with status ${response.status}`,
      { status: response.status }
    );
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

  async healthCheck() {
    const response = await this.request(`${this.url}/rest/v1/memory_items?select=id&limit=1`, {
      headers: this.headers
    });
    await parseResponse(response);
    return {
      ok: true
    };
  }

  async createItem(item) {
    const response = await this.request(`${this.url}/rest/v1/memory_items`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(item)
    });
    const data = await parseResponse(response);
    return stripInternalFields(Array.isArray(data) ? data[0] : data);
  }

  async createEmbedding(record) {
    const response = await this.request(`${this.url}/rest/v1/memory_embeddings`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(record)
    });
    const data = await parseResponse(response);
    return Array.isArray(data) ? data[0] : data;
  }

  async createEdge(edge) {
    const response = await this.request(`${this.url}/rest/v1/memory_edges`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(edge)
    });
    const data = await parseResponse(response);
    return Array.isArray(data) ? data[0] : data;
  }

  async createEvent(event) {
    const response = await this.request(`${this.url}/rest/v1/memory_events`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(event)
    });
    const data = await parseResponse(response);
    return Array.isArray(data) ? data[0] : data;
  }

  async getItem(id) {
    const response = await this.request(
      `${this.url}/rest/v1/memory_items?id=eq.${encodeURIComponent(id)}&select=*`,
      { headers: this.headers }
    );
    const data = await parseResponse(response);
    return stripInternalFields(data[0] ?? null);
  }

  async updateItem(id, patch) {
    const response = await this.request(
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
    const response = await this.request(
      `${this.url}/rest/v1/memory_items?select=*&is_archived=eq.false&order=last_accessed_at.desc.nullslast,created_at.desc&limit=${limit}`,
      { headers: this.headers }
    );
    const data = await parseResponse(response);
    return data
      .filter((item) => matchesNamespace(item.namespace, namespace))
      .map(stripInternalFields);
  }

  async searchCandidates({ query, queryEmbedding, namespace, filters, mode, limit = 10 }) {
    const response = await this.request(`${this.url}/rest/v1/rpc/memory_search`, {
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
      item: stripInternalFields(candidate.item),
      vectorScore: Number(candidate.vector_score || 0),
      lexicalScore: Number(candidate.lexical_score || 0),
      recencyScore: Number(candidate.recency_score || 0),
      importanceScore: Number(candidate.importance_score || 0)
    }));
  }

  async expandEdges({ itemIds, depth = 1 }) {
    const response = await this.request(`${this.url}/rest/v1/rpc/memory_expand_context`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        p_item_ids: itemIds,
        p_depth: depth
      })
    });
    return parseResponse(response);
  }

  async request(url, init = {}, attempt = 0) {
    try {
      const response = await this.fetch(url, init);
      if (shouldRetryResponse(response.status) && attempt < 2) {
        await wait(backoffMs(attempt));
        return this.request(url, init, attempt + 1);
      }
      return response;
    } catch (error) {
      if (attempt >= 2 || !isTransientNetworkError(error)) {
        throw upstreamError(error instanceof Error ? error.message : "Supabase request failed");
      }
      await wait(backoffMs(attempt));
      return this.request(url, init, attempt + 1);
    }
  }
}

function stripInternalFields(item) {
  if (!item) return item;
  const { search_vector, ...rest } = item;
  return rest;
}

function matchesNamespace(itemNs = {}, requestedNs = {}) {
  if (requestedNs.repo_url) {
    // include exact match OR globals (repo_url null/undefined)
    if (itemNs.repo_url && itemNs.repo_url !== requestedNs.repo_url) {
      return false;
    }
  }
  if (requestedNs.agent) {
    if (itemNs.agent !== requestedNs.agent) {
      return false;
    }
  }
  return true;
}

function shouldRetryResponse(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isTransientNetworkError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /timed out|timeout|network|fetch|reset|econn|temporar/i.test(error.message);
}

function backoffMs(attempt) {
  return 100 * (attempt + 1) * (attempt + 1);
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
