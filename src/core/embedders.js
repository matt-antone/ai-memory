/**
 * Embedder factories.
 *
 * Each factory returns an async function: (text: string) => number[]
 *
 * Usage in edge function:
 *   const embedder = createSupabaseEmbedder("gte-small");
 *
 * Usage in Node environments with OpenAI:
 *   const embedder = createOpenAIEmbedder(apiKey, "text-embedding-3-small");
 */

/**
 * Supabase AI embedder — runs natively in Deno edge functions at zero cost.
 * Model options: "gte-small" (384 dims), "gte-large" (1024 dims)
 */
export function createSupabaseEmbedder(model = "gte-small") {
  return async function supabaseEmbed(text) {
    // Supabase.ai is a Deno global injected by the edge runtime.
    // eslint-disable-next-line no-undef
    const session = new Supabase.ai.Session(model);
    const output = await session.run(text, { mean_pool: true, normalize: true });
    return Array.from(output);
  };
}

/**
 * OpenAI embedder — works in any Node or Deno environment with fetch.
 * Model options: "text-embedding-3-small" (1536 dims), "text-embedding-3-large" (3072 dims)
 */
export function createOpenAIEmbedder(apiKey, model = "text-embedding-3-small") {
  if (!apiKey) throw new Error("OpenAI API key is required for createOpenAIEmbedder");

  return async function openAIEmbed(text) {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ input: text, model })
    });

    if (!response.ok) {
      const err = await response.text().catch(() => response.statusText);
      throw new Error(`OpenAI embedding failed (${response.status}): ${err}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  };
}

/**
 * Build the text to embed from a memory item.
 * Combines content and summary for richer semantic coverage.
 */
export function buildEmbedText(item) {
  const parts = [item.content];
  if (item.summary && item.summary !== item.content) {
    parts.push(item.summary);
  }
  return parts.join("\n").trim();
}
