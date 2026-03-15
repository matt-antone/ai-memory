drop index if exists memory_items_search_vector_idx;

alter table if exists memory_items
  drop column if exists search_vector;

alter table memory_items
  add column search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(content, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(jsonb_to_tsvector('english', coalesce(tags, '[]'::jsonb), '["string"]'::jsonb), 'C') ||
    setweight(jsonb_to_tsvector('english', coalesce(metadata, '{}'::jsonb), '["string","numeric","boolean","key"]'::jsonb), 'D')
  ) stored;

create index if not exists memory_items_search_vector_idx on memory_items using gin (search_vector);
