import { ref, computed } from 'vue'
import type { SubEventMetadata } from '@festival/shared/metadata/schemas'
import type { TxStatus } from '@festival/shared/contracts/write'
import { writeContract } from '@festival/shared/contracts/write'
import { FestivalABI } from '@festival/shared/contracts/abis'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'
import { festivalState } from '@festival/shared/cache/festival-state'
import { bootLoadAdmin } from './useBootLoad'

export interface SubEventListItem {
  address: string
  metadata: SubEventMetadata
  registeredCount: number
  startTime: number
  endTime: number
  cancelled: boolean
  flagCount: number
  flagThreshold: number
}

const DEFAULT_METADATA: SubEventMetadata = {
  version: '1.0',
  type: 'sub-event',
  name: '',
  description: '',
  location: '',
  speakers: [],
}

const FLAG_THRESHOLD_FALLBACK = 5

export function useSubEvents(_festivalAddress: string) {
  const txStatus = ref<TxStatus>('idle')

  const subEvents = computed<SubEventListItem[]>(() =>
    festivalState.sessions.map((s) => ({
      address: s.address,
      metadata: s.metadata ?? { ...DEFAULT_METADATA, name: `Sub-Event ${s.address.slice(0, 8)}` },
      registeredCount: Number(s.details.registeredCount),
      startTime: Number(s.details.startTime),
      endTime: Number(s.details.endTime),
      cancelled: s.details.cancelled,
      flagCount: Number(s.details.flagCount),
      flagThreshold: Number(s.details.flagThreshold) || FLAG_THRESHOLD_FALLBACK,
    })),
  )

  const isLoading = computed(() => festivalState.loading)

  function reload(): Promise<void> {
    const wallet = useWalletStore()
    const userH160 = wallet.isConnected ? walletAddressToH160(wallet.address) : null
    const addr = (festivalState.festival?.address ?? _festivalAddress) as `0x${string}`
    return bootLoadAdmin(addr, userH160)
  }

  async function createSession(
    metadataCid: `0x${string}`,
    startTimestamp: bigint,
    endTimestamp: bigint,
    festivalPoapTokenId: bigint,
  ): Promise<string | null> {
    txStatus.value = 'preparing'
    try {
      const wallet = useWalletStore()
      await writeContract({
        address: _festivalAddress as `0x${string}`,
        abi: FestivalABI,
        functionName: 'createSession',
        args: [metadataCid, startTimestamp, endTimestamp, festivalPoapTokenId],
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => { txStatus.value = s },
      })
      await reload()
      return subEvents.value[subEvents.value.length - 1]?.address || null
    } catch (e) {
      txStatus.value = 'error'
      throw new Error(formatTxError(e))
    }
  }

  async function cancelSession(sessionAddress: string): Promise<void> {
    txStatus.value = 'preparing'
    const target = sessionAddress.toLowerCase()
    try {
      const wallet = useWalletStore()
      await writeContract({
        address: _festivalAddress as `0x${string}`,
        abi: FestivalABI,
        functionName: 'cancelSession',
        args: [sessionAddress as `0x${string}`],
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => { txStatus.value = s },
      })

      markCancelledLocally(target)
      reload()
    } catch (e) {
      txStatus.value = 'error'
      throw new Error(formatTxError(e))
    }
  }

  function markCancelledLocally(targetLower: string) {
    const entry = festivalState.sessions.find((s) => s.address.toLowerCase() === targetLower)
    if (entry) {
      entry.details = { ...entry.details, cancelled: true }
    }
  }

  return { subEvents, isLoading, txStatus, createSession, cancelSession, reload }
}
