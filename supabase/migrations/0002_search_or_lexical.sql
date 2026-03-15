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
