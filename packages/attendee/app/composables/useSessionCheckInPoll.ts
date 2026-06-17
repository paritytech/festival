import { FestivalABI } from '@festival/shared/contracts/abis'
import { hasDeployedContracts } from '@festival/shared/contracts/festival-reads'
import { batchRead } from '@festival/shared/contracts/multicall'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'
import { festivalState } from '@festival/shared/cache/festival-state'
import { useVisiblePoll } from '@festival/shared/cache/visibility'
import { useSubEvents } from './useSubEvents'
import { bootLoadAttendee } from './useBootLoad'

const POLL_INTERVAL_MS = 10_000

/**
 * Session analogue of {@link useCheckInPoll} for the session detail screen,
 * whose badge animation fires off `subEvent.isCheckedIn`. The fast path is the
 * CheckedIn event watcher; on a flaky socket an event can be dropped and never
 * replayed, so while the user is not yet checked in to this session each tick
 * reconciles against the chain and, on drift, runs a bootLoad that flips the
 * flag (firing the celebration) and pulls the freshly minted POAP. No-ops once
 * checked in.
 */
export function useSessionCheckInPoll(sessionAddress: string) {
  const wallet = useWalletStore()
  const { getByAddress } = useSubEvents()

  const isCheckedIn = () => getByAddress(sessionAddress)?.isCheckedIn ?? false

  useVisiblePoll(async () => {
    if (!hasDeployedContracts() || isCheckedIn()) return
    if (!wallet.isConnected) {
      if (!wallet.isInitializing) await wallet.init()
      return
    }
    const userH160 = walletAddressToH160(wallet.address)
    if (!festivalState.festival) {
      await bootLoadAttendee(userH160)
      return
    }
    const [chainCheckedIn] = (await batchRead([
      { address: sessionAddress as `0x${string}`, abi: FestivalABI, functionName: 'isCheckedIn', args: [userH160] },
    ])) as [boolean]
    if (chainCheckedIn && !isCheckedIn()) await bootLoadAttendee(userH160)
  }, POLL_INTERVAL_MS)
}
