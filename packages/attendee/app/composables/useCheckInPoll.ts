import { onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'
import { hasDeployedContracts } from '@festival/shared/contracts/festival-reads'
import { useWalletStore } from '@festival/shared/host/wallet'
import { useRegistration } from './useRegistration'

// Each tick is one cheap read and only fires for the not-yet-checked-in
// attendee on a visible screen, so a short interval stays inside the host's
// read-rate budget while a door check-in still flips the screen within a cycle.
const POLL_INTERVAL_MS = 10_000

/**
 * Self-healing check-in watch for screens that render off `isCheckedIn`.
 * While the owning page is shown and the user is not checked in, each tick:
 *
 *  1. retries wallet connection if host account setup failed or was
 *     interrupted (e.g. user navigated away mid-setup) — app.vue's
 *     wallet.address watcher then fires the regular bootLoad, or
 *  2. reconciles registration/check-in state against the chain, updating
 *     festivalState and the persistent cache on drift.
 *
 * The fast path stays the CheckedIn event watcher; this is the fallback for
 * missed events, failed boots, and dead wallet connections. Ticks no-op once
 * checked in. KeepAlive-aware: pauses on deactivate, resumes on activate.
 */
export function useCheckInPoll() {
  const wallet = useWalletStore()
  const { isCheckedIn, reconcileCheckInStatus } = useRegistration(FESTIVAL_ADDRESS)

  let timer: ReturnType<typeof setInterval> | null = null
  let ticking = false

  async function tick() {
    if (ticking || isCheckedIn.value) return
    if (document.visibilityState !== 'visible') return
    ticking = true
    try {
      if (!wallet.isConnected) {
        if (!wallet.isInitializing) await wallet.init()
        return
      }
      await reconcileCheckInStatus()
    } catch (e) {
      console.warn('[useCheckInPoll] reconcile failed:', e)
    } finally {
      ticking = false
    }
  }

  function start() {
    if (!hasDeployedContracts() || timer) return
    void tick()
    timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
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
