export function resolveChoice(options, selected, fallbackKey) {
  const normalizedSelected = String(selected ?? "").trim().toLowerCase();
  const normalizedFallback = String(fallbackKey ?? "").trim().toLowerCase();

  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("Choice options are required");
  }

  const match = normalizedSelected
    ? options.find((option) => matchesChoice(option, normalizedSelected))
    : options.find((option) => matchesChoice(option, normalizedFallback));

  if (!match) {
    throw new Error(`Unknown choice: ${selected}`);
  }

  return match;
}

function matchesChoice(option, selected) {
  if (!selected) {
    return false;
  }

  return [
    option.key,
    option.label,
    option.value
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase())
    .includes(selected);
}
