export function createId(prefix = "mem") {
  return `${prefix}_${crypto.randomUUID()}`;
}
