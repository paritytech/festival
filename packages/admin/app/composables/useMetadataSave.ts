import { ref } from 'vue'
import type { FestivalMetadata } from '@festival/shared/metadata/schemas'
import type { TxStatus } from '@festival/shared/contracts/write'
import { writeContract } from '@festival/shared/contracts/write'
import { FestivalABI } from '@festival/shared/contracts/abis'
import { useBulletinStorage } from '@festival/shared/metadata/bulletin'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { setCachedMetadata } from '@festival/shared/cache/cid-cache'

export function useMetadataSave(festivalAddress: string) {
  const txStatus = ref<TxStatus>('idle')
  const error = ref<string | null>(null)
  const lastSavedCid = ref<string | null>(null)

  /**
   * Store updated metadata on Bulletin Chain, pre-cache it under the new CID so
   * retrieval is instant, then point the contract at the new CID (user signs).
   */
  async function save(metadata: FestivalMetadata) {
    error.value = null
    txStatus.value = 'preparing'

    try {
      const { storePlaintext } = useBulletinStorage()
      const { cid, bytes32 } = await storePlaintext(metadata)

      await setCachedMetadata(cid, metadata)

      txStatus.value = 'signing'

      const wallet = useWalletStore()
      await writeContract({
        address: festivalAddress as `0x${string}`,
        abi: FestivalABI,
        functionName: 'updateCid',
        args: [bytes32],
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => {
          txStatus.value = s
          if (s === 'in-block') {
            lastSavedCid.value = cid
          }
        },
      })
    } catch (e: any) {
      txStatus.value = 'error'
      error.value = formatTxError(e)
    }
  }

  function reset() {
    txStatus.value = 'idle'
    error.value = null
  }

  return { txStatus, error, lastSavedCid, save, reset }
}
