import { onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'

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

/**
 * Run `tick` once now and then every `intervalMs` while the owning page is shown
 * and the document is visible. Overlapping ticks are dropped. KeepAlive-aware:
 * pauses on deactivate, resumes on activate. The fast path stays the event
 * watcher; this is the foreground fallback for events missed on a flaky socket.
 */
export function useVisiblePoll(
  tick: () => Promise<void> | void,
  intervalMs: number,
): void {
  let timer: ReturnType<typeof setInterval> | null = null
  let ticking = false

  async function run() {
    if (ticking || document.visibilityState !== 'visible') return
    ticking = true
    try {
      await tick()
    } catch (e) {
      console.warn('[useVisiblePoll] tick failed:', e)
    } finally {
      ticking = false
    }
  }

  function start() {
    if (timer) return
    void run()
    timer = setInterval(() => void run(), intervalMs)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  onMounted(start)
  onActivated(start)
  onUnmounted(stop)
  onDeactivated(stop)
}
