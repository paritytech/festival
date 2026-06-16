import { computed } from 'vue'
import {
  MAX_SESSIONS_PER_DAY,
  getMaxSessionsTotal,
} from '@festival/shared/contracts/types'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'
import { toBerlinDateKey } from '@festival/shared/utils/time'
import { festivalState } from '@festival/shared/cache/festival-state'
import { hasPending } from '@festival/shared/cache/pending'
import { useFestival } from './useFestival'

/**
 * Session creation limit for the connected user.
 *
 * Contract caps each creator at MAX_SESSIONS_PER_DAY per festival day, so the
 * total ceiling across the festival is MAX_SESSIONS_PER_DAY × festivalDays.
 * Once a user has that many non-cancelled sessions, no day has room for one
 * more and the create CTAs should hide.
 *
 * While festival details aren't loaded yet (totalLimit === 0) the composable
 * reports `hasHitLimit = false` so create CTAs stay visible during boot.
 */
export function useSessionLimit() {
  const { details } = useFestival()
  const wallet = useWalletStore()

  const userH160 = computed(() => {
    if (!wallet.isConnected || !wallet.address) return null
    return walletAddressToH160(wallet.address)
  })

  const totalLimit = computed(() => {
    if (!details.value) return 0
    return getMaxSessionsTotal(details.value.startTime, details.value.endTime)
  })

  // Sessions that consume one of the creator's per-day slots.
  // Mirrors Festival.cancelSession: a creator self-cancel below the flag
  // threshold decrements sessionsPerDay (slot returned); an admin/manager
  // cancel at/above the flag threshold leaves the slot consumed.
  const countableSessions = computed(() => {
    const u = userH160.value
    if (!u) return []
    return festivalState.sessions.filter((s) => {
      if (s.details.creator.toLowerCase() !== u) return false
      // Optimistically treat the creator's own pending self-cancel as freeing
      // the slot (only the creator's device sees their own pending cancels).
      if (hasPending('cancelSession', s.address)) return false
      if (!s.details.cancelled) return true
      return s.details.flagCount >= s.details.flagThreshold
    })
  })

  const used = computed(() => countableSessions.value.length)

  const hasHitLimit = computed(
    () => totalLimit.value > 0 && used.value >= totalLimit.value,
  )
  const canHostMore = computed(() => !hasHitLimit.value)

  /** Berlin dateKey → number of slots the user has consumed on that day. */
  const usedByDateKey = computed<Map<string, number>>(() => {
    const map = new Map<string, number>()
    for (const s of countableSessions.value) {
      const key = toBerlinDateKey(new Date(Number(s.details.startTime) * 1000))
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  })

  /** Berlin dateKeys where the user has reached MAX_SESSIONS_PER_DAY. */
  const fullDateKeys = computed<Set<string>>(() => {
    const set = new Set<string>()
    for (const [key, count] of usedByDateKey.value) {
      if (count >= MAX_SESSIONS_PER_DAY) set.add(key)
    }
    return set
  })

  return {
    totalLimit,
    used,
    hasHitLimit,
    canHostMore,
    usedByDateKey,
    fullDateKeys,
  }
}
