export function chunkText(text, options = {}) {
  const chunkSize = options.chunkSize ?? 900;
  const overlap = options.overlap ?? 120;
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [];
  }

  if (chunkSize <= overlap) {
    throw new Error("chunkSize must be larger than overlap");
  }

  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    const maxEnd = Math.min(normalized.length, start + chunkSize);
    let end = maxEnd;

    if (maxEnd < normalized.length) {
      const window = normalized.slice(start, maxEnd);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf(" ")
      );

      if (breakAt > Math.floor(chunkSize * 0.5)) {
        end = start + breakAt + 1;
      }
    }

    const content = normalized.slice(start, end).trim();
    if (content) {
      chunks.push({
        index: chunks.length,
        content,
        start,
        end
      });
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
