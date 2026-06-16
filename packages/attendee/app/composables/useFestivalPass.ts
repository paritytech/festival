/**
 * Festival Pass orchestrator. Owns a per-user `passStatus`:
 *
 *   - 'active'    — allowances granted; never re-claims (a repeat claim scales
 *                   an extra host slot).
 *   - 'unclaimed' — confirmed no allowance, never deferred; overlay auto-opens.
 *   - 'deferred'  — user chose "Do it later" after a failed claim; app stays
 *                   usable, gated actions re-prompt via ensureAllowance().
 *   - 'unknown'   — chain read still in flight.
 *
 * `active` always wins. It is signalled by either the localStorage flag or a
 * PGAS > 0 chain read (recovers a wipe / cross-device case). The localStorage
 * key holds 'activated' | 'deferred'; 'activated' is written only on a
 * confirmed full grant.
 *
 * No in-app refill flow for users who spend PGAS to zero.
 */

import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useWalletStore } from '@festival/shared/host/wallet'
import { isInHost } from '@festival/shared/host/detect'
import { checkAllowancesOnChain } from '@festival/shared/host/allowances'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'
import { useRegistration } from './useRegistration'

type PassFlag = 'activated' | 'deferred'
type PassStatus = 'unknown' | 'active' | 'unclaimed' | 'deferred'

// Module-level state survives page nav. `phase` is reconciled against
// `passStatus` on every mount via the watcher below.
const pgasGranted = ref<boolean | null>(null)
const hasActivatedFlag = ref(false) // mirrors localStorage for the current user
const hasDeferredFlag = ref(false)
const activationFailed = ref(false) // drives the overlay's "Activation failed" modal
const phase = ref<
  'idle' | 'pass' | 'activating' | 'exploding' | 'badge'
>('idle')
const activatedAtMs = ref<number | null>(null)

function storageKey(userAddr: string): string {
  return `festivalPass:${FESTIVAL_ADDRESS}:${userAddr}`
}

function readPassFlag(userAddr: string): PassFlag | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(storageKey(userAddr))
    return v === 'activated' || v === 'deferred' ? v : null
  } catch {
    // localStorage disabled (Safari private, quota, etc.). Chain check covers us.
    return null
  }
}

function writeActivatedFlag(userAddr: string): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(storageKey(userAddr), 'activated')
    } catch {
      // Ignored. Chain check is the fallback signal anyway.
    }
  }
  hasActivatedFlag.value = true
  hasDeferredFlag.value = false
}

function writeDeferredFlag(userAddr: string): void {
  if (hasActivatedFlag.value) return // activation supersedes deferral
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(storageKey(userAddr), 'deferred')
    } catch {
      // Ignored — deferral just won't survive a reload; the failed modal
      // remains reachable so the user is never locked out.
    }
  }
  hasDeferredFlag.value = true
}

// Resources we request via wallet.claimAllowances. Keep in sync with `wallet.ts`.
const REQUESTED_RESOURCES = new Set([
  'BulletinAllowance',
  'SmartContractAllowance:0',
  'AutoSigning',
])

// AutoSigning never lands as `Allocated` host-side, so counting it would flag
// a partial failure on every claim. Drop it from this set once it ships.
const IGNORED_FOR_ACTIVATION = new Set(['AutoSigning'])

function isActivationCritical(o: { key: string }): boolean {
  return REQUESTED_RESOURCES.has(o.key) && !IGNORED_FOR_ACTIVATION.has(o.key)
}

// Address the latest in-flight read targets. Older reads whose stamp no
// longer matches drop their results so an account change can start a fresh
// read without blocking on the stale one.
let inFlightAddress = ''
let explodeTimer: ReturnType<typeof setTimeout> | null = null
// Re-bound on every useFestivalPass() so the module-scope visibility
// listener always reaches the live wallet bindings.
let latestRefresh: (() => Promise<unknown>) | null = null

// Holds phase='exploding' for the full FestivalPassScreen timeline:
// converge 0–600ms overlapped with card scale-out 550–1050ms, +50ms buffer.
const EXPLODE_DURATION_MS = 1100

let visibilityWired = false

// ok=false means the chain read threw. Callers needing positive
// confirmation (activate) must treat it as "couldn't confirm", not granted.
type RefreshResult = { ok: boolean }

export function useFestivalPass() {
  const wallet = useWalletStore()
  const { isCheckedIn } = useRegistration(FESTIVAL_ADDRESS)
  const { address, isConnected, isClaimingAllowances } = storeToRefs(wallet)

  // ── Allowance chain read ────────────────────────────────────────────────

  // Passive read on mount, visibility, and CheckedIn. The activate flow trusts
  // the host outcome directly, and a set localStorage flag skips the round-trip.
  async function refreshAllowance(): Promise<RefreshResult> {
    if (!isInHost()) {
      // Standalone: shouldShowPass already gates on isInHost(), so pin
      // granted=true and ok=true to keep activate() unreachable here.
      pgasGranted.value = true
      return { ok: true }
    }
    const queryAddr = address.value
    if (!isConnected.value || !queryAddr) {
      pgasGranted.value = null
      return { ok: false }
    }
    if (hasActivatedFlag.value) {
      return { ok: true }
    }
    inFlightAddress = queryAddr
    try {
      const state = await checkAllowancesOnChain(queryAddr)
      if (inFlightAddress !== queryAddr || address.value !== queryAddr) {
        return { ok: false }
      }
      pgasGranted.value = state.pgasGranted
      if (state.pgasGranted) {
        // Persist so a localStorage wipe / cross-device case doesn't re-show the pass.
        // TODO: PGAS > 0 misses the partial-grant case (PGAS allocated, Bulletin
        // rejected). Require both grants once the host SDK exposes a Bulletin
        // allowance query.
        writeActivatedFlag(queryAddr)
      }
      return { ok: true }
    } catch (err) {
      // Preserve prior pgasGranted so a transient RPC hiccup doesn't flip the UI.
      console.warn('[useFestivalPass] checkAllowancesOnChain failed:', err)
      return { ok: false }
    }
  }
  latestRefresh = refreshAllowance

  const passStatus = computed<PassStatus>(() => {
    if (hasActivatedFlag.value || pgasGranted.value === true) return 'active'
    if (hasDeferredFlag.value) return 'deferred'
    if (pgasGranted.value === false) return 'unclaimed'
    return 'unknown'
  })
  const isPassActive = computed(() => passStatus.value === 'active')
  const canClaim = computed(() => passStatus.value !== 'active')

  // Hydrates the localStorage flags for the current user and triggers the
  // chain read. Resets state on disconnect / pre-checkin.
  watch(
    [address, isCheckedIn],
    ([addr, checked]) => {
      activationFailed.value = false
      if (!addr || !checked) {
        hasActivatedFlag.value = false
        hasDeferredFlag.value = false
        pgasGranted.value = null
        if (phase.value !== 'idle') {
          phase.value = 'idle'
          if (explodeTimer !== null) {
            clearTimeout(explodeTimer)
            explodeTimer = null
          }
        }
        return
      }
      const flag = readPassFlag(addr)
      hasActivatedFlag.value = flag === 'activated'
      hasDeferredFlag.value = flag === 'deferred'
      // Reset to "unknown" so a previous account's grant state can't carry over.
      pgasGranted.value = null
      void refreshAllowance()
    },
    { immediate: true },
  )

  // immediate:true reconciles a stale phase on mount — e.g. the visibility
  // listener flipped activation while no consumer was watching, which would
  // otherwise leave the pass overlay lingering. Only 'unclaimed' auto-opens;
  // 'deferred' never re-blocks.
  watch(
    [passStatus, isCheckedIn],
    ([status, checked]) => {
      if (!checked) return
      if (status === 'unclaimed' && phase.value === 'idle') {
        phase.value = 'pass'
      } else if (status === 'active' && phase.value === 'pass') {
        phase.value = 'idle'
      }
    },
    { immediate: true },
  )

  // Foreground re-read for cases the watchers can't see. E.g. user activated
  // on another surface while this tab was backgrounded.
  if (typeof window !== 'undefined' && !visibilityWired) {
    visibilityWired = true
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && latestRefresh) {
        void latestRefresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    if ((import.meta as any).hot) {
      ;(import.meta as any).hot.dispose(() => {
        document.removeEventListener('visibilitychange', onVisibility)
        visibilityWired = false
        latestRefresh = null
      })
    }
  }

  // ── Activation flow ──────────────────────────────────────────────────────

  // Shared claim. Host outcomes are authoritative: every activation-critical
  // resource `Allocated` means granted. No phase/UI side effects beyond
  // persisting a full grant — callers own the presentation.
  async function claimAndConfirm(claimAddr: string): Promise<boolean> {
    const claim = await wallet.claimAllowances()
    // Bail on a mid-flow account change rather than credit a different user.
    if (address.value !== claimAddr) return false
    const granted =
      claim.outcomes !== null &&
      claim.outcomes.filter(isActivationCritical).every((o) => o.tag === 'Allocated')
    if (granted) {
      writeActivatedFlag(claimAddr)
      activatedAtMs.value = Date.now()
    } else {
      console.warn('[useFestivalPass] allocation not granted:', claim.outcomes)
    }
    return granted
  }

  // Overlay path: claims with the full celebration on success, surfaces the
  // "Activation failed" modal on reject/fail.
  async function activate(): Promise<void> {
    if (phase.value !== 'pass') return
    const claimAddr = address.value
    if (!claimAddr) return
    phase.value = 'activating'
    activationFailed.value = false
    try {
      const granted = await claimAndConfirm(claimAddr)
      // Bail if disconnect/account-change reset phase under us.
      if (phase.value !== 'activating') return
      if (granted) {
        phase.value = 'exploding'
        if (explodeTimer !== null) clearTimeout(explodeTimer)
        explodeTimer = setTimeout(() => {
          explodeTimer = null
          if (phase.value === 'exploding') phase.value = 'badge'
        }, EXPLODE_DURATION_MS)
      } else {
        phase.value = 'pass'
        activationFailed.value = true
      }
    } catch (err) {
      console.error('[useFestivalPass] activate failed:', err)
      if (phase.value !== 'activating') return
      phase.value = 'pass'
      activationFailed.value = true
    }
  }

  function retryActivation(): void {
    activationFailed.value = false
    void activate()
  }

  function defer(): void {
    const addr = address.value
    if (addr) writeDeferredFlag(addr)
    activationFailed.value = false
    if (phase.value === 'pass' || phase.value === 'activating') {
      phase.value = 'idle'
    }
  }

  // Imperative gated-action path: claim without overlay or animation.
  async function ensureAllowance(): Promise<boolean> {
    if (isPassActive.value) return true
    const claimAddr = address.value
    if (!claimAddr) return false
    try {
      return await claimAndConfirm(claimAddr)
    } catch (err) {
      console.error('[useFestivalPass] ensureAllowance failed:', err)
      return false
    }
  }

  function dismissBadge(): void {
    if (phase.value === 'badge') {
      phase.value = 'idle'
      if (explodeTimer !== null) {
        clearTimeout(explodeTimer)
        explodeTimer = null
      }
    }
  }

  // ── Exposed surface ──────────────────────────────────────────────────────

  // Every overlay phase requires the user still in host + connected + checked-in
  // AND that we are actually on the home route. The route gate is a hard
  // backstop: FestivalPassScreen teleports to <body>, so without this gate a
  // stale composable instance (e.g. one anchored in a kept-alive page) could
  // paint the overlay over /onboarding or any other route.
  const route = useRoute()
  const overlayGate = computed(
    () =>
      isInHost() &&
      isConnected.value &&
      isCheckedIn.value &&
      !!address.value &&
      route.path === '/',
  )

  const shouldShowPass = computed(
    () =>
      overlayGate.value &&
      (phase.value === 'pass' ||
        phase.value === 'activating' ||
        phase.value === 'exploding'),
  )

  const shouldShowBadge = computed(
    () => overlayGate.value && phase.value === 'badge',
  )

  const isActivating = computed(
    () => phase.value === 'activating' || isClaimingAllowances.value,
  )

  const isExploding = computed(() => phase.value === 'exploding')

  return {
    passStatus,
    isPassActive,
    canClaim,
    shouldShowPass,
    shouldShowBadge,
    activationFailed,
    isActivating,
    isExploding,
    activatedAtMs,
    activate,
    retryActivation,
    defer,
    ensureAllowance,
    dismissBadge,
    refreshAllowance,
  }
}
