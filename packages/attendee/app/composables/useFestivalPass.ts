/**
 * Festival Pass orchestrator. Shows the activation overlay once per user.
 * Activation is tracked in two places, and the pass hides if either says
 * activated:
 *
 *   - localStorage `festivalPass:{festivalAddr}:{userAddr}=activated` — fast
 *     path, also set on any chain read seeing PGAS > 0 (recovers a wipe or
 *     cross-device case).
 *   - PGAS balance on Asset Hub — chain fallback when localStorage is empty.
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

// Module-level state survives page nav. `phase` is reconciled against
// `hasActivated` on every mount via the watcher below.
const pgasGranted = ref<boolean | null>(null)
const hasActivatedFlag = ref(false) // mirrors localStorage for the current user
const phase = ref<
  'idle' | 'pass' | 'activating' | 'exploding' | 'badge'
>('idle')
const activatedAtMs = ref<number | null>(null)
const allocationWarning = ref<string | null>(null)

function storageKey(userAddr: string): string {
  return `festivalPass:${FESTIVAL_ADDRESS}:${userAddr}`
}

function readActivatedFlag(userAddr: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(storageKey(userAddr)) === 'activated'
  } catch {
    // localStorage disabled (Safari private, quota, etc.). Chain check covers us.
    return false
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

  // Combined activation signal: either localStorage flag set, or chain says
  // PGAS > 0. Once true (for this address), the pass screen never shows.
  const hasActivated = computed(
    () => hasActivatedFlag.value || pgasGranted.value === true,
  )

  // Strict "confirmed not activated" signal. `pgasGranted` starts as `null`
  // until the chain read resolves, so `!hasActivated` alone would flash the
  // pass on a 2nd device whose first read is still in flight after activation
  // on another device. Mounting the overlay requires `=== false`.
  const isUnactivatedConfirmed = computed(
    () => !hasActivatedFlag.value && pgasGranted.value === false,
  )

  // Hydrates the localStorage flag for the current user and triggers the
  // chain read. Resets state on disconnect / pre-checkin.
  watch(
    [address, isCheckedIn],
    ([addr, checked]) => {
      if (!addr || !checked) {
        hasActivatedFlag.value = false
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
      hasActivatedFlag.value = readActivatedFlag(addr)
      // Reset to "unknown" so a previous account's grant state can't carry over.
      pgasGranted.value = null
      void refreshAllowance()
    },
    { immediate: true },
  )

  // immediate:true reconciles a stale phase on mount — e.g. the visibility
  // listener flipped activation while no consumer was watching, which would
  // otherwise leave the pass overlay lingering.
  watch(
    [hasActivated, isUnactivatedConfirmed, isCheckedIn],
    ([activated, unactivated, checked]) => {
      if (!checked) return
      if (unactivated && phase.value === 'idle') {
        phase.value = 'pass'
      } else if (activated && phase.value === 'pass') {
        // Activation detected outside the activate() flow (cross-device,
        // late chain confirmation). Drop the overlay without ceremony.
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

  async function activate(): Promise<void> {
    if (phase.value !== 'pass') return
    // Pin the activation to the account that tapped the button; bail on
    // any mid-flow account change rather than celebrate a different user's
    // grant.
    const claimAddr = address.value
    if (!claimAddr) return
    phase.value = 'activating'
    allocationWarning.value = null
    try {
      const claim = await wallet.claimAllowances()
      if (address.value !== claimAddr) {
        phase.value = 'pass'
        return
      }
      // Host outcomes are authoritative: every activation-critical resource
      // `Allocated` means granted, no chain read needed. Passive
      // refreshAllowance on mount/visibility covers wipe-recovery later.
      const granted =
        claim.outcomes !== null &&
        claim.outcomes.filter(isActivationCritical).every((o) => o.tag === 'Allocated')
      if (claim.outcomes) {
        const missing = claim.outcomes.filter(
          (o) => isActivationCritical(o) && o.tag !== 'Allocated',
        )
        if (missing.length > 0) {
          console.warn('[useFestivalPass] partial allocation outcomes:', missing)
          allocationWarning.value =
            "We couldn't fully activate your pass. Please tap Activate again."
        }
      }
      // Bail if disconnect/route-change reset phase under us.
      if (phase.value !== 'activating') return
      if (granted) {
        writeActivatedFlag(claimAddr)
        activatedAtMs.value = Date.now()
        phase.value = 'exploding'
        if (explodeTimer !== null) clearTimeout(explodeTimer)
        explodeTimer = setTimeout(() => {
          explodeTimer = null
          if (phase.value === 'exploding') phase.value = 'badge'
        }, EXPLODE_DURATION_MS)
      } else {
        phase.value = 'pass'
      }
    } catch (err) {
      console.error('[useFestivalPass] activate failed:', err)
      phase.value = 'pass'
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

  // Every overlay phase requires the user still in host + connected + checked-in;
  // disconnect mid-flow drops the overlay rather than re-coloring it against
  // an empty address.
  const overlayGate = computed(
    () => isInHost() && isConnected.value && isCheckedIn.value && !!address.value,
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
    shouldShowPass,
    shouldShowBadge,
    isActivating,
    isExploding,
    activatedAtMs,
    allocationWarning,
    activate,
    dismissBadge,
    refreshAllowance,
  }
}
