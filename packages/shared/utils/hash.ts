/**
 * DJB2 string hash. Returns a signed 32-bit integer (the raw accumulator).
 * Callers apply their own final transform — `Math.abs(h) % n` for a bucket
 * index, or `h >>> 0` for an unsigned seed.
 */
export function djb2(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return hash
}
