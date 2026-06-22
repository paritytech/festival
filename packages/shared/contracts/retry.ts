/**
 * A call that exceeded its per-attempt timeout. Thrown by {@link withTimeout}
 * and recognised as transient by {@link isTransientError} *by identity* (not by
 * message), so {@link retryTransient} always retries it. The underlying call is
 * not cancelled — PAPI exposes no abort handle for a dry-run — so a timed-out
 * attempt is abandoned and a fresh one is issued. Use only where abandoning the
 * in-flight work is harmless (idempotent reads).
 */
export class TimeoutError extends Error {
  constructor(message = 'operation timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * Reject with a {@link TimeoutError} if `promise` hasn't settled within `ms`.
 * The underlying promise is NOT cancelled (it settles into the void); this is
 * what converts a never-settling in-flight call — e.g. a dry-run orphaned when
 * the host-routed chainHead follow flaps — into a retryable rejection instead
 * of an unbounded hang.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`operation timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/**
 * Does this error look like a transient network/connection blip, as opposed to a
 * deterministic failure (contract revert, dispatch error, user rejection)? Used
 * to decide whether retrying could plausibly succeed.
 *
 * Recognises three shapes:
 *  - a {@link TimeoutError} (a per-attempt timeout — matched by identity);
 *  - a PAPI `RpcError` carrying JSON-RPC code `-32603` ("Internal error"), which
 *    the host forwards for a dropped/failed connection. This can never be a
 *    contract revert: reverts and pallet failures come back as a *successful*
 *    RPC round-trip (a revert flag / `!success` in the result payload) and are
 *    thrown as plain Errors, never as an RpcError — so matching `-32603` cannot
 *    mask a deterministic failure;
 *  - a connectivity signature in the message (the allowlist below), including
 *    `disjoint` (PAPI's `DisjointError`, raised when a follow errors hard).
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true
  // PAPI's RpcError exposes the JSON-RPC code on `.code`; -32603 is the host's
  // catch-all for a connection-drop / internal failure. Inspect the code, not
  // just the message — the message ("Internal error") carries no allowlist word.
  if ((error as { code?: unknown } | null)?.code === -32603) return true
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return /timed out|timeout|disconnect|connection|network|websocket|socket|failed to fetch|fetch failed|econnreset|econnrefused|etimedout|not connected|internal error|disjoint/.test(msg)
}

/**
 * Retry `fn` on transient network errors with exponential backoff; deterministic
 * failures throw immediately. Use only for idempotent work — reads, or a
 * check-in (a double-landed check-in just reverts harmlessly).
 *
 * Options:
 *  - `timeoutMs`: cap each attempt. A never-settling call (an in-flight read
 *    orphaned by a flapping host connection) rejects as a {@link TimeoutError}
 *    and becomes retryable instead of hanging forever.
 *  - `shouldRetry`: override the default {@link isTransientError} classifier.
 *    A submit passes one that stops retrying once the tx has broadcast, so a
 *    committed transaction is never re-signed / double-submitted.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number
    baseDelayMs?: number
    timeoutMs?: number
    shouldRetry?: (error: unknown) => boolean
  } = {},
): Promise<T> {
  const retries = opts.retries ?? 2
  const baseDelayMs = opts.baseDelayMs ?? 400
  const shouldRetry = opts.shouldRetry ?? isTransientError
  for (let attempt = 0; ; attempt++) {
    try {
      return opts.timeoutMs ? await withTimeout(fn(), opts.timeoutMs) : await fn()
    } catch (e) {
      if (attempt >= retries || !shouldRetry(e)) throw e
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt))
    }
  }
}

/**
 * Shared retry/timeout budget for the session check-in validation reads
 * (attendee + admin), kept in one place so the two surfaces can't silently
 * diverge. 8s per attempt sits well above a healthy sub-second read but below a
 * perceptible hang; one retry rides out a brief blip, after which the caller
 * rebuilds the wedged client (see resetMainClient) and runs one final round.
 *
 * NOTE: a timed-out attempt abandons (does not cancel) its in-flight call, so
 * each timeout orphans one PAPI chainHead op until the client is reset. Bounded
 * and acceptable here; an AbortSignal threaded into ReviveApi.call would remove
 * it entirely if this ever matters.
 */
export const READ_RETRY_OPTS = { timeoutMs: 8000, retries: 1, baseDelayMs: 500 } as const
