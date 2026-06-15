import { onUnmounted } from 'vue'

/**
 * Watch for visibility changes (tab/app returning to foreground) and run
 * the supplied callback. SPAs pass a `bootLoad{Attendee,Admin}` invocation
 * to refresh the central festivalState against current chain data.
 *
 * Concurrent calls are dropped. If a previous reconcile is still running,
 * the new visibility event is ignored.
 */
export function useVisibilityReconcile(
  onVisible: () => Promise<void> | void,
): { stop: () => void } {
  let reconciling = false

  async function handler() {
    if (document.visibilityState !== 'visible') return
    if (reconciling) return
    reconciling = true
    try {
      await onVisible()
    } catch (e) {
      console.warn('[useVisibilityReconcile] reconcile failed:', e)
    } finally {
      reconciling = false
    }
  }

  document.addEventListener('visibilitychange', handler)

  function stop() {
    document.removeEventListener('visibilitychange', handler)
  }

  onUnmounted(stop)

  return { stop }
}
