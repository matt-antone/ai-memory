export function toStructuredContent(result) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result;
  }

  return {
    items: Array.isArray(result) ? result : [result]
  };
}

export function asToolResult(result) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ],
    structuredContent: toStructuredContent(result)
  };
}
