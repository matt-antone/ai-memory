/**
 * Constant-time string comparison using XOR accumulator.
 * Prevents timing side-channel attacks on credential validation.
 * Uses only Web Platform APIs (TextEncoder, Uint8Array) for Node/Deno portability.
 */
export function timingSafeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  if (bufA.byteLength !== bufB.byteLength) {
    // Burn the same comparison time to avoid leaking length info.
    xorAccumulate(bufA, bufA);
    return false;
  }

  return xorAccumulate(bufA, bufB);
}

function xorAccumulate(a, b) {
  let result = 0;
  for (let i = 0; i < a.byteLength; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
