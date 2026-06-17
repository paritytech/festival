/**
 * Does this error look like a transient network/connection blip, as opposed to a
 * deterministic failure (contract revert, dispatch error, user rejection)? Used
 * to decide whether retrying could plausibly succeed. Matches an allowlist of
 * connectivity signatures so a revert/dispatch message is never treated as
 * retryable.
 */
export function isTransientError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return /timed out|timeout|disconnect|connection|network|websocket|socket|failed to fetch|fetch failed|econnreset|econnrefused|etimedout|not connected/.test(msg)
}

/**
 * Retry `fn` on transient network errors with exponential backoff; deterministic
 * failures throw immediately. Use only for idempotent work — reads, or a
 * check-in (a double-landed check-in just reverts harmlessly).
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 400
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (attempt >= retries || !isTransientError(e)) throw e
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt))
    }
  }
}
