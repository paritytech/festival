import { ref, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import type { SubEventMetadata } from '@festival/shared/metadata/schemas'
import { hydrateSubEventMetadata } from '@festival/shared/metadata/schemas'
import { watchFestivalEvents } from '@festival/shared/cache/event-watcher'
import { useWalletStore } from '@festival/shared/host/wallet'
import { useBulletinStorage } from '@festival/shared/metadata/bulletin'
import { isNonZeroCid } from '@festival/shared/contracts/festival-reads'
import { ss58ToH160, isValidEvmAddress } from '@festival/shared/utils/address'
import { useSubEvents } from './useSubEvents'
import { refreshUserSessionPoaps } from './usePoapRefresh'

/**
 * Subscribe to a session's Revive.ContractEmitted events for the lifetime of
 * the calling component, pausing while the page is KeepAlive-cached.
 *
 * Each `watchFestivalEvents` opens its own `chainHead_v1_follow`. The session
 * list lives under `<KeepAlive :max="10">` (see `app.vue`), so without the
 * `onDeactivated` hook ten cached pages would keep ten follows alive at once
 * and blow the host's follow budget ("No active follow for this chain").
 * `onUnmounted` alone doesn't fire under KeepAlive.
 */
export function useSessionWatcher(sessionAddress: string) {
  const checkedIn = ref(false)
  let stop: (() => void) | null = null

  function userH160OrNull(): string | null {
    const wallet = useWalletStore()
    if (!wallet.isConnected) return null
    return (
      isValidEvmAddress(wallet.address)
        ? (wallet.address as `0x${string}`)
        : ss58ToH160(wallet.address)
    ).toLowerCase()
  }

  function start() {
    if (stop) return // already running
    const sub = watchFestivalEvents(sessionAddress as `0x${string}`, {
      onCheckedIn: (attendee) => {
        const me = userH160OrNull()
        if (!me || attendee.toLowerCase() !== me) return
        checkedIn.value = true
        void refreshUserSessionPoaps(
          me as `0x${string}`,
          sessionAddress as `0x${string}`,
        )
      },
      onMetadataUpdated: async (newCid) => {
        if (!isNonZeroCid(newCid)) return
        try {
          const { retrievePlaintext } = useBulletinStorage()
          const raw = await retrievePlaintext<SubEventMetadata>(newCid)
          const metadata = hydrateSubEventMetadata(raw)
          useSubEvents().patchSession(sessionAddress, { metadata, metadataCid: newCid })
        } catch (e) {
          console.warn('[useSessionWatcher] metadata patch failed:', e)
        }
      },
    })
    stop = sub.unsubscribe
  }

  function dispose() {
    if (stop) {
      stop()
      stop = null
    }
  }

  // Both hooks needed: Vue fires only onMounted on first mount inside
  // KeepAlive, then onActivated on re-entry. start() is idempotent.
  onMounted(start)
  onActivated(start)
  onDeactivated(dispose)
  onUnmounted(dispose)

  return { checkedIn }
}
