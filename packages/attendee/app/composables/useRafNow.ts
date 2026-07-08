import { ref, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'

const TICK_MS = 30_000

/**
 * A clock that advances off requestAnimationFrame instead of setInterval.
 *
 * The host's mobile webviews (WKWebView / Android WebView) throttle or suspend
 * idle main-thread interval timers even while the app is foregrounded, which
 * freezes a setInterval-driven clock and stops time-gated CTAs from ever
 * flipping. rAF is driven by the native render loop, so it keeps firing while
 * the page is actually painting and pauses when it isn't.
 *
 * Unlike the app-wide `useNow` singleton, this is scoped per component: the loop
 * and its listeners are created on mount/activate and fully torn down on
 * unmount/deactivate (KeepAlive-aware), so a cached or unmounted page leaves
 * nothing running. The ref only advances every `tickMs` so consumers don't
 * re-render every frame.
 */
export function useRafNow(tickMs = TICK_MS) {
  const now = ref(new Date())
  let rafId: number | null = null
  let lastTick = 0

  function loop() {
    const t = Date.now()
    if (t - lastTick >= tickMs) {
      lastTick = t
      now.value = new Date(t)
    }
    rafId = requestAnimationFrame(loop)
  }

  // Snap to real time the instant we return to the foreground. rAF resumes on
  // its own, but this avoids up to a full tick of staleness right after resume.
  function onForeground() {
    if (document.visibilityState !== 'visible') return
    lastTick = Date.now()
    now.value = new Date(lastTick)
    if (rafId == null) rafId = requestAnimationFrame(loop)
  }

  function start() {
    if (rafId != null) return
    lastTick = Date.now()
    now.value = new Date(lastTick)
    rafId = requestAnimationFrame(loop)
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('focus', onForeground)
    window.addEventListener('pageshow', onForeground)
  }

  function stop() {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    document.removeEventListener('visibilitychange', onForeground)
    window.removeEventListener('focus', onForeground)
    window.removeEventListener('pageshow', onForeground)
  }

  onMounted(start)
  onActivated(start)
  onUnmounted(stop)
  onDeactivated(stop)

  return now
}
