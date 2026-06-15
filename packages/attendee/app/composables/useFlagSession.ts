import { ref } from 'vue'
import { writeContract } from '@festival/shared/contracts/write'
import type { TxStatus } from '@festival/shared/contracts/write'
import { FestivalSessionABI } from '@festival/shared/contracts/abis'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { useHiddenSessions } from './useHiddenSessions'
import { useBookmarks } from './useBookmarks'
import { usePoaps } from './usePoaps'

export function useFlagSession() {
  const txStatus = ref<TxStatus>('idle')
  const error = ref<string | null>(null)
  const { hide } = useHiddenSessions()
  const { isBookmarked, toggleBookmark } = useBookmarks()
  const { poaps } = usePoaps()

  /** The current user's festival POAP token id, if any. */
  function userFestivalPoapTokenId(): bigint | null {
    const fest = poaps.value.find((p) => p.type === 'festival')
    return fest ? BigInt(fest.tokenId) : null
  }

  async function flag(sessionAddress: string): Promise<boolean> {
    error.value = null
    txStatus.value = 'preparing'

    try {
      const tokenId = userFestivalPoapTokenId()
      if (tokenId === null) {
        throw new Error('You need a festival POAP to report a session.')
      }

      const wallet = useWalletStore()
      await writeContract({
        address: sessionAddress as `0x${string}`,
        abi: FestivalSessionABI,
        functionName: 'flag',
        args: [tokenId],
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => {
          txStatus.value = s
          if (s === 'in-block') {
            hide(sessionAddress)
            if (isBookmarked(sessionAddress)) toggleBookmark(sessionAddress)
          }
        },
      })

      return true
    } catch (e) {
      txStatus.value = 'error'
      error.value = formatTxError(e)
      return false
    }
  }

  function reset() {
    txStatus.value = 'idle'
    error.value = null
  }

  return { txStatus, error, flag, reset, userFestivalPoapTokenId }
}
