import { usePersistentRef } from '@festival/shared/cache/persistent'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'

/**
 * Per-(festival, user) record of sessions whose badge animation has already
 * played. Persisted (host storage + localStorage) so a session is celebrated at
 * most once, ever — across re-entry, reload, and app restart. Keyed per user so
 * switching accounts on a shared device starts fresh.
 */
export function useCelebratedSessions() {
  const wallet = useWalletStore()
  const user = wallet.isConnected ? walletAddressToH160(wallet.address).toLowerCase() : 'anon'
  const celebrated = usePersistentRef<string[]>(
    `celebratedSessions:${FESTIVAL_ADDRESS.toLowerCase()}:${user}`,
    [],
  )

  function hasCelebrated(sessionAddress: string): boolean {
    return celebrated.value.includes(sessionAddress.toLowerCase())
  }

  function markCelebrated(sessionAddress: string): void {
    const key = sessionAddress.toLowerCase()
    if (!celebrated.value.includes(key)) celebrated.value = [...celebrated.value, key]
  }

  return { hasCelebrated, markCelebrated }
}
