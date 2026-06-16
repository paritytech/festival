import { computed } from 'vue'
import { getMaxSessionsTotal } from '@festival/shared/contracts/types'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'
import { useFestival } from './useFestival'
import { useSubEvents } from './useSubEvents'

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
  const { subEvents } = useSubEvents()
  const wallet = useWalletStore()

  const userH160 = computed(() => {
    if (!wallet.isConnected || !wallet.address) return null
    return walletAddressToH160(wallet.address)
  })

  const totalLimit = computed(() => {
    if (!details.value) return 0
    return getMaxSessionsTotal(details.value.startTime, details.value.endTime)
  })

  const used = computed(() => {
    const u = userH160.value
    if (!u) return 0
    return subEvents.value.filter((se) => se.creator.toLowerCase() === u).length
  })

  const hasHitLimit = computed(
    () => totalLimit.value > 0 && used.value >= totalLimit.value,
  )
  const canHostMore = computed(() => !hasHitLimit.value)

  return { totalLimit, used, hasHitLimit, canHostMore }
}
