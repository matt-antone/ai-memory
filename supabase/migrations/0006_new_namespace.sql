-- Migration 0006: Redesign namespace model
-- Replaces scope/workspace_id/agent_id/topic/tags with repo_url/repo_name/agent.
-- Starts fresh by archiving all existing items.

-- Archive all existing memories (start fresh)
UPDATE memory_items SET is_archived = true WHERE is_archived = false;

-- Update default namespace shape
ALTER TABLE memory_items
  ALTER COLUMN namespace
    SET DEFAULT '{"repo_url":null,"repo_name":null,"agent":null}'::jsonb;

-- Replace namespace matching function used by memory_search RPC
CREATE OR REPLACE FUNCTION memory_namespace_matches(item_namespace jsonb, requested jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    -- repo_url: if requested, match exact OR include globals (repo_url IS NULL)
    (
      requested->>'repo_url' IS NULL
      OR item_namespace->>'repo_url' = requested->>'repo_url'
      OR item_namespace->>'repo_url' IS NULL
    )
    -- agent: if requested, exact match only
    AND (
      requested->>'agent' IS NULL
      OR item_namespace->>'agent' = requested->>'agent'
    );
$$;
