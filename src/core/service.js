import { createId } from "../utils/id.js";
import { chunkText } from "./chunking.js";
import { buildEmbedText } from "./embedders.js";
import { enrichMemoryInput } from "./memory-enrichment.js";
import { combineScores } from "./ranking.js";
import {
  normalizeNamespace,
  normalizeSearchMode,
  validateIngestInput,
  validateLinkInput,
  validateSearchInput,
  validateWriteInput
} from "./validation.js";

export class MemoryService {
  constructor(store, options = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date());
    this.embedder = options.embedder ?? null;
  }

  async writeMemory(input, context = {}) {
    validateWriteInput(input);
    const enriched = enrichMemoryInput(input);
    const namespace = normalizeNamespace(enriched.namespace);
    const now = this.clock().toISOString();
    const item = {
      id: enriched.id ?? createId("mem"),
      kind: enriched.kind,
      content: enriched.content.trim(),
      summary: enriched.summary ?? null,
      source_type: enriched.source_type ?? null,
      source_ref: enriched.source_ref ?? null,
      metadata: enriched.metadata ?? {},
      namespace,
      tags: Array.isArray(enriched.tags) ? enriched.tags : [],
      importance: normalizeImportance(enriched.importance),
      created_at: now,
      last_accessed_at: null,
      recall_count: 0,
      is_archived: false
    };

    const created = await this.store.createItem(item);

    const embeddingVector = enriched.embedding
      ?? (this.embedder ? await this.embedder(buildEmbedText(item)).catch(() => null) : null);

    if (embeddingVector) {
      await this.store.createEmbedding({
        id: createId("emb"),
        item_id: item.id,
        embedding: embeddingVector,
        embedding_model: enriched.embedding ? (enriched.embedding_model ?? "caller-supplied") : "auto",
        dimensions: embeddingVector.length,
        created_at: now
      });
    }

    if (Array.isArray(enriched.links)) {
      for (const link of enriched.links) {
        await this.linkMemory({
          from_id: item.id,
          to_id: link.to_id,
          edge_type: link.edge_type,
          metadata: link.metadata ?? {}
        }, context);
      }
    }

    await this.store.createEvent({
      id: createId("evt"),
      item_id: item.id,
      event_type: "memory.created",
      payload: {
        kind: item.kind,
        source_ref: item.source_ref,
        actor: buildActor(context),
        request_id: context.requestId ?? null
      },
      created_at: now
    });

    return toPublicItem(created);
  }

  async searchMemory(input, context = {}) {
    validateSearchInput(input);
    const hasQueryEmbedding = Array.isArray(input.query_embedding) && input.query_embedding.length > 0;
    const mode = normalizeSearchMode(input.mode, hasQueryEmbedding);
    const namespace = normalizeNamespace(input.namespace);
    const limit = input.k ?? 10;
    const candidates = await this.store.searchCandidates({
      query: input.query,
      queryEmbedding: input.query_embedding ?? null,
      namespace,
      filters: input.filters ?? {},
      mode,
      limit
    });

    const hits = candidates
      .map((candidate) => {
        const scoring = combineScores(candidate);
        return {
          item: toPublicItem(candidate.item),
          score: scoring.total,
          breakdown: scoring.breakdown,
          provenance: {
            source_type: candidate.item.source_type,
            source_ref: candidate.item.source_ref
          }
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const hit of hits) {
      await this.store.updateItem(hit.item.id, {
        last_accessed_at: this.clock().toISOString(),
        recall_count: Number(hit.item.recall_count || 0) + 1
      });
    }

    let expandedContext = [];
    if ((input.expand_depth ?? 0) > 0 && hits.length > 0) {
      const raw = await this.store.expandEdges({
        itemIds: hits.map((hit) => hit.item.id),
        depth: input.expand_depth
      });
      expandedContext = raw.map(({ edge, item }) => ({ edge, item: toPublicItem(item) }));
    }

    await this.store.createEvent({
      id: createId("evt"),
      item_id: null,
      event_type: "memory.search",
      payload: {
        actor: buildActor(context),
        request_id: context.requestId ?? null,
        namespace,
        mode,
        query: input.query,
        result_count: hits.length
      },
      created_at: this.clock().toISOString()
    });

    return {
      mode_used: mode,
      query: input.query,
      hits,
      context: expandedContext
    };
  }

  async getMemory(input, context = {}) {
    const item = await this.store.getItem(input.id);
    if (!item) {
      throw new Error(`memory item not found: ${input.id}`);
    }
    await this.store.createEvent({
      id: createId("evt"),
      item_id: item.id,
      event_type: "memory.get",
      payload: {
        actor: buildActor(context),
        request_id: context.requestId ?? null
      },
      created_at: this.clock().toISOString()
    });
    return toPublicItem(item);
  }

  async linkMemory(input, context = {}) {
    validateLinkInput(input);
    const from = await this.store.getItem(input.from_id);
    const to = await this.store.getItem(input.to_id);
    if (!from || !to) {
      throw new Error("from_id and to_id must reference existing memory items");
    }
    const now = this.clock().toISOString();
    const edge = {
      id: createId("edge"),
      from_id: input.from_id,
      to_id: input.to_id,
      edge_type: input.edge_type,
      metadata: input.metadata ?? {},
      created_at: now
    };
    await this.store.createEdge(edge);
    await this.store.createEvent({
      id: createId("evt"),
      item_id: input.from_id,
      event_type: "memory.linked",
      payload: {
        ...edge,
        actor: buildActor(context),
        request_id: context.requestId ?? null
      },
      created_at: now
    });
    return edge;
  }

  async ingestDocument(input, context = {}) {
    validateIngestInput(input);
    const namespace = normalizeNamespace(input.namespace);
    const document = await this.writeMemory({
      content: input.content,
      summary: input.summary ?? null,
      kind: "document",
      source_type: input.source_type ?? "ingest",
      source_ref: input.source_ref ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        ingestion: {
          chunk_size: input.chunk_size ?? 900,
          chunk_overlap: input.chunk_overlap ?? 120
        }
      },
      namespace,
      tags: input.tags,
      importance: input.importance
    }, context);

    const chunks = chunkText(input.content, {
      chunkSize: input.chunk_size,
      overlap: input.chunk_overlap
    });

    const createdChunks = [];
    for (const chunk of chunks) {
      const embedding = Array.isArray(input.chunk_embeddings?.[chunk.index])
        ? input.chunk_embeddings[chunk.index]
        : null;

      const chunkItem = await this.writeMemory({
        content: chunk.content,
        kind: "chunk",
        source_type: "document_chunk",
        source_ref: document.id,
        metadata: {
          chunk_index: chunk.index,
          start: chunk.start,
          end: chunk.end
        },
        namespace,
        tags: input.tags,
        importance: input.importance,
        embedding,
        embedding_model: embedding ? input.embedding_model ?? "caller-supplied" : undefined
      }, context);

      await this.linkMemory({
        from_id: chunkItem.id,
        to_id: document.id,
        edge_type: "belongs_to",
        metadata: { chunk_index: chunk.index }
      }, context);

      createdChunks.push(chunkItem);
    }

    return {
      document,
      chunks: createdChunks
    };
  }

  async listRecent(input = {}, context = {}) {
    const namespace = normalizeNamespace(input.namespace);
    const items = await this.store.listRecent({
      namespace,
      limit: input.limit ?? 10
    });
    await this.store.createEvent({
      id: createId("evt"),
      item_id: null,
      event_type: "memory.list_recent",
      payload: {
        actor: buildActor(context),
        request_id: context.requestId ?? null,
        namespace,
        limit: input.limit ?? 10,
        result_count: items.length
      },
      created_at: this.clock().toISOString()
    });
    return items.map(toPublicItem);
  }

  async archiveMemory(input, context = {}) {
    const item = await this.store.getItem(input.id);
    if (!item) {
      throw new Error(`memory item not found: ${input.id}`);
    }
    await this.store.archiveItem(input.id);
    await this.store.createEvent({
      id: createId("evt"),
      item_id: input.id,
      event_type: "memory.archived",
      payload: {
        actor: buildActor(context),
        request_id: context.requestId ?? null
      },
      created_at: this.clock().toISOString()
    });
    return { id: input.id, archived: true };
  }

  async promoteSummary(input, context = {}) {
    const source = await this.getMemory({ id: input.source_id }, context);
    const namespace = normalizeNamespace(input.namespace ?? source.namespace);
    const summary = await this.writeMemory({
      content: input.content,
      summary: input.summary ?? source.summary ?? null,
      kind: "summary",
      source_type: "promoted_summary",
      source_ref: source.id,
      metadata: {
        promoted_from: source.id
      },
      namespace,
      tags: source.tags,
      importance: normalizeImportance(input.importance, Math.max(0.8, Number(source.importance || 0)))
    }, context);

    await this.linkMemory({
      from_id: summary.id,
      to_id: source.id,
      edge_type: "derived_from",
      metadata: {}
    }, context);

    return summary;
  }
}

function toPublicItem(item) {
  if (!item?.metadata?.retrieval) return item;
  const { retrieval, ...rest } = item.metadata;
  return { ...item, metadata: rest };
}

function normalizeImportance(value, fallback = 0.5) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function buildActor(context = {}) {
  if (!context.clientId) {
    return null;
  }

  return {
    client_id: context.clientId,
    role: context.role ?? "service",
    auth_mode: context.authMode ?? null
  };
}
