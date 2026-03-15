create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists memory_namespaces (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'global',
  workspace_id text,
  agent_id text,
  topic text,
  tags jsonb not null default '[]'::jsonb,
  unique (scope, workspace_id, agent_id, topic)
);

create table if not exists memory_items (
  id text primary key,
  kind text not null check (kind in ('memory', 'document', 'chunk', 'summary', 'fact')),
  content text not null,
  summary text,
  source_type text,
  source_ref text,
  metadata jsonb not null default '{}'::jsonb,
  namespace jsonb not null default '{"scope":"global","workspace_id":null,"agent_id":null,"topic":null,"tags":[]}'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  importance double precision not null default 0.5 check (importance >= 0 and importance <= 1),
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  recall_count integer not null default 0,
  is_archived boolean not null default false,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(content, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(jsonb_to_tsvector('english', coalesce(tags, '[]'::jsonb), '["string"]'::jsonb), 'C')
  ) stored
);

create index if not exists memory_items_search_vector_idx on memory_items using gin (search_vector);
create index if not exists memory_items_created_at_idx on memory_items (created_at desc);
create index if not exists memory_items_archived_idx on memory_items (is_archived);

create table if not exists memory_embeddings (
  id text primary key,
  item_id text not null references memory_items(id) on delete cascade,
  embedding_model text not null,
  dimensions integer not null,
  embedding vector,
  created_at timestamptz not null default now()
);

create index if not exists memory_embeddings_item_id_idx on memory_embeddings (item_id);
-- Keep embeddings dimension-agnostic in v1. ANN indexes require a fixed vector(n),
-- so we skip that index until the project standardizes on one embedding dimension.

create table if not exists memory_edges (
  id text primary key,
  from_id text not null references memory_items(id) on delete cascade,
  to_id text not null references memory_items(id) on delete cascade,
  edge_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists memory_edges_from_idx on memory_edges (from_id);
create index if not exists memory_edges_to_idx on memory_edges (to_id);

create table if not exists memory_events (
  id text primary key,
  item_id text references memory_items(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists memory_events_item_id_idx on memory_events (item_id);

alter table memory_namespaces enable row level security;
alter table memory_items enable row level security;
alter table memory_embeddings enable row level security;
alter table memory_edges enable row level security;
alter table memory_events enable row level security;

revoke all on table memory_namespaces from anon, authenticated;
revoke all on table memory_items from anon, authenticated;
revoke all on table memory_embeddings from anon, authenticated;
revoke all on table memory_edges from anon, authenticated;
revoke all on table memory_events from anon, authenticated;

create or replace function memory_namespace_matches(item_namespace jsonb, requested jsonb)
returns boolean
language sql
immutable
as $$
  select
    coalesce(requested->>'scope', item_namespace->>'scope', 'global') = coalesce(item_namespace->>'scope', 'global')
    and (
      requested->>'workspace_id' is null
      or requested->>'workspace_id' = item_namespace->>'workspace_id'
    )
    and (
      requested->>'agent_id' is null
      or requested->>'agent_id' = item_namespace->>'agent_id'
    )
    and (
      requested->>'topic' is null
      or requested->>'topic' = item_namespace->>'topic'
    )
    and (
      requested->'tags' is null
      or jsonb_typeof(requested->'tags') <> 'array'
      or coalesce(item_namespace->'tags', '[]'::jsonb) @> (requested->'tags')
    );
$$;

revoke all on function memory_namespace_matches(jsonb, jsonb) from public, anon, authenticated;

create or replace function memory_lexical_query(p_query text)
returns tsquery
language sql
immutable
as $$
  select
    case
      when coalesce(trim(p_query), '') = '' then null::tsquery
      else to_tsquery(
        'english',
        array_to_string(tsvector_to_array(to_tsvector('english', p_query)), ' | ')
      )
    end;
$$;

revoke all on function memory_lexical_query(text) from public, anon, authenticated;

create or replace function memory_search(
  p_query text,
  p_query_embedding vector default null,
  p_namespace jsonb default '{}'::jsonb,
  p_filters jsonb default '{}'::jsonb,
  p_mode text default 'lexical',
  p_limit integer default 10
)
returns table (
  item jsonb,
  vector_score double precision,
  lexical_score double precision,
  recency_score double precision,
  importance_score double precision
)
language sql
stable
as $$
  with query_parts as (
    select memory_lexical_query(p_query) as lexical_query
  ),
  filtered as (
    select
      mi.*,
      me.embedding,
      qp.lexical_query,
      case
        when p_query_embedding is not null and me.embedding is not null then 1 - (me.embedding <=> p_query_embedding)
        else 0
      end as vector_score,
      coalesce(ts_rank_cd(mi.search_vector, qp.lexical_query), 0) as lexical_score,
      1 / (1 + extract(epoch from (now() - mi.created_at)) / 1209600.0) as recency_score
    from memory_items mi
    cross join query_parts qp
    left join memory_embeddings me on me.item_id = mi.id
    where mi.is_archived = false
      and memory_namespace_matches(mi.namespace, p_namespace)
      and (
        p_filters->>'kind' is null
        or mi.kind = p_filters->>'kind'
      )
      and (
        p_filters->>'source_type' is null
        or mi.source_type = p_filters->>'source_type'
      )
  )
  select
    jsonb_build_object(
      'id', id,
      'kind', kind,
      'content', content,
      'summary', summary,
      'source_type', source_type,
      'source_ref', source_ref,
      'metadata', metadata,
      'namespace', namespace,
      'tags', tags,
      'importance', importance,
      'created_at', created_at,
      'last_accessed_at', last_accessed_at,
      'recall_count', recall_count,
      'is_archived', is_archived
    ) as item,
    vector_score,
    lexical_score,
    recency_score,
    importance as importance_score
  from filtered
  where (
    p_mode = 'vector' and vector_score > 0
  ) or (
    p_mode = 'lexical' and lexical_score > 0
  ) or (
    p_mode = 'hybrid' and (vector_score > 0 or lexical_score > 0)
  )
  order by
    (vector_score * 0.45 + lexical_score * 0.35 + recency_score * 0.1 + importance * 0.1) desc,
    created_at desc
  limit p_limit;
$$;

revoke all on function memory_search(text, vector, jsonb, jsonb, text, integer) from public, anon, authenticated;

create or replace function memory_expand_context(
  p_item_ids text[],
  p_depth integer default 1
)
returns table (
  edge jsonb,
  item jsonb
)
language sql
stable
as $$
  with recursive walk as (
    select
      me.id,
      me.from_id,
      me.to_id,
      me.edge_type,
      me.metadata,
      me.created_at,
      case
        when me.from_id = any(p_item_ids) then me.to_id
        else me.from_id
      end as item_id,
      1 as depth
    from memory_edges me
    where me.from_id = any(p_item_ids) or me.to_id = any(p_item_ids)

    union all

    select
      me.id,
      me.from_id,
      me.to_id,
      me.edge_type,
      me.metadata,
      me.created_at,
      case
        when me.from_id = walk.item_id then me.to_id
        else me.from_id
      end as item_id,
      walk.depth + 1
    from memory_edges me
    join walk on me.from_id = walk.item_id or me.to_id = walk.item_id
    where walk.depth < p_depth
  )
  select distinct
    jsonb_build_object(
      'id', walk.id,
      'from_id', walk.from_id,
      'to_id', walk.to_id,
      'edge_type', walk.edge_type,
      'metadata', walk.metadata,
      'created_at', walk.created_at
    ) as edge,
    jsonb_build_object(
      'id', mi.id,
      'kind', mi.kind,
      'content', mi.content,
      'summary', mi.summary,
      'source_type', mi.source_type,
      'source_ref', mi.source_ref,
      'metadata', mi.metadata,
      'namespace', mi.namespace,
      'tags', mi.tags,
      'importance', mi.importance,
      'created_at', mi.created_at,
      'last_accessed_at', mi.last_accessed_at,
      'recall_count', mi.recall_count,
      'is_archived', mi.is_archived
    ) as item
  from walk
  join memory_items mi on mi.id = walk.item_id
  where mi.is_archived = false
    and not (mi.id = any(p_item_ids));
$$;

revoke all on function memory_expand_context(text[], integer) from public, anon, authenticated;
