import { ref, computed } from 'vue'
import type { SubEventMetadata } from '@festival/shared/metadata/schemas'
import type { TxStatus } from '@festival/shared/contracts/write'
import { writeContract } from '@festival/shared/contracts/write'
import { FestivalABI } from '@festival/shared/contracts/abis'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'
import { festivalState, type SessionEntry } from '@festival/shared/cache/festival-state'
import { addPending, dropPending, hasPending, pendingSessions, pendingSessionEdit, draftSessionEntry } from '@festival/shared/cache/pending'
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

  const subEvents = computed<SubEventListItem[]>(() => {
    const toView = (s: SessionEntry): SubEventListItem => ({
      address: s.address,
      // Our own in-flight edit renders immediately; superseded once the chain CID catches up.
      metadata: pendingSessionEdit(s.address)?.metadata ?? s.metadata ?? { ...DEFAULT_METADATA, name: `Sub-Event ${s.address.slice(0, 8)}` },
      registeredCount: Number(s.details.registeredCount),
      startTime: Number(s.details.startTime),
      endTime: Number(s.details.endTime),
      // A cancel tx in flight on this device shows as cancelled immediately;
      // it rolls back if the tx fails and is GC'd once the chain confirms.
      cancelled: s.details.cancelled || hasPending('cancelSession', s.address),
      flagCount: Number(s.details.flagCount),
      flagThreshold: Number(s.details.flagThreshold) || FLAG_THRESHOLD_FALLBACK,
    })

    const confirmed = festivalState.sessions.map(toView)
    // Cancelled sessions don't count: a same-metadata recreate shares their
    // CID and must not hide the new draft.
    const confirmedCids = new Set(
      festivalState.sessions
        .filter((s) => !s.details.cancelled)
        .map((s) => s.details.metadataCid.toLowerCase()),
    )
    const drafts = pendingSessions()
      .filter((s) => !confirmedCids.has(s.details.metadataCid.toLowerCase()))
      .map(toView)
    return [...confirmed, ...drafts]
  })

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
    draftMetadata?: SubEventMetadata,
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
        onStatus: (s) => {
          txStatus.value = s
          // Draft renders in the list immediately; the confirmed entry with
          // this CID supersedes it and promotion GCs the draft.
          if (s === 'broadcasting') {
            addPending('session', metadataCid, draftSessionEntry(
              metadataCid, startTimestamp, endTimestamp,
              walletAddressToH160(wallet.address), draftMetadata,
            ))
          }
        },
      })
      await reload()
      // The tx succeeded, so the draft has done its job either way.
      dropPending('session', metadataCid)
      // The created session is the live one carrying this CID. Fall back to a
      // cancelled match for the rare create then instant cancel case.
      const byCid = (live: boolean) =>
        festivalState.sessions.find(
          (s) =>
            (!live || !s.details.cancelled) &&
            s.details.metadataCid.toLowerCase() === metadataCid.toLowerCase(),
        )
      return (byCid(true) ?? byCid(false))?.address ?? null
    } catch (e) {
      dropPending('session', metadataCid)
      txStatus.value = 'error'
      throw new Error(formatTxError(e))
    }
  }

  async function cancelSession(sessionAddress: string): Promise<void> {
    txStatus.value = 'preparing'
    try {
      const wallet = useWalletStore()
      await writeContract({
        address: _festivalAddress as `0x${string}`,
        abi: FestivalABI,
        functionName: 'cancelSession',
        args: [sessionAddress as `0x${string}`],
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => {
          txStatus.value = s
          // Optimistic via the pending overlay, never a direct state write:
          // under the cancelled-latch a speculative write could outlive a
          // failed tx forever. The overlay rolls back on failure instead.
          if (s === 'broadcasting') addPending('cancelSession', sessionAddress)
        },
      })

      reload()
    } catch (e) {
      dropPending('cancelSession', sessionAddress)
      txStatus.value = 'error'
      throw new Error(formatTxError(e))
    }
  }

  return { subEvents, isLoading, txStatus, createSession, cancelSession, reload }
}
