import { ref, computed } from 'vue'
import type { TxStatus } from '@festival/shared/contracts/write'
import { writeContract } from '@festival/shared/contracts/write'
import { FestivalABI } from '@festival/shared/contracts/abis'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'
import { hasDeployedContracts } from '@festival/shared/contracts/festival-reads'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'
import { festivalState } from '@festival/shared/cache/festival-state'
import { hasPending, addPending, dropPending } from '@festival/shared/cache/pending'
import { bootLoadAttendee } from './useBootLoad'

// Tx-state stays local. It's a per-action signal, not festival state.
const txStatus = ref<TxStatus>('idle')
const error = ref<string | null>(null)

/**
 * Registration composable. Two read tiers, never written directly:
 * confirmed (`festivalState`, fed by chain reads + events through the
 * monotonic merge) OR'd with this device's pending tx overlay. Optimism never
 * touches the confirmed tier — under merge's never-drop semantics a
 * speculative attendee row could outlive a failed tx forever; the pending
 * entry instead rolls back on failure and is GC'd once the chain confirms.
 */
export function useRegistration(_festivalAddress: string) {
  function userLower(): string | null {
    const addr = festivalState.user.address
    return addr ? addr.toLowerCase() : null
  }

  function findUserAttendee() {
    const ul = userLower()
    if (!ul) return undefined
    return festivalState.festival?.attendees.find((a) => a.address.toLowerCase() === ul)
  }

  const isRegistered = computed<boolean>(() => {
    if (!hasDeployedContracts()) return true
    const ul = userLower()
    if (ul && hasPending('register', ul)) return true
    return Boolean(findUserAttendee()) || festivalState.user.ticketTokenId > 0n
  })

  const isCheckedIn = computed<boolean>(() => {
    if (!hasDeployedContracts()) return false
    const ul = userLower()
    if (ul && hasPending('checkin', ul)) return true
    return findUserAttendee()?.isCheckedIn ?? false
  })

  const ticketTokenId = computed<number | null>(() => {
    if (!hasDeployedContracts()) return 42
    const t = festivalState.user.ticketTokenId
    return t > 0n ? Number(t) : null
  })

  async function register() {
    error.value = null
    txStatus.value = 'preparing'
    const wallet = useWalletStore()
    const userH160 =
      hasDeployedContracts() && wallet.isConnected
        ? walletAddressToH160(wallet.address)
        : null
    try {
      if (!hasDeployedContracts()) {
        // Mock mode: isRegistered is pinned true; only the tx status animates.
        await new Promise((r) => setTimeout(r, 1200))
        txStatus.value = 'finalized'
        setTimeout(() => { txStatus.value = 'idle' }, 2000)
        return
      }

      await writeContract({
        address: FESTIVAL_ADDRESS as `0x${string}`,
        abi: FestivalABI,
        functionName: 'register',
        value: 0n,
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => {
          txStatus.value = s
          // Optimistic from broadcast; the pending entry is GC'd once the
          // Registered event / next read confirms, and dropped (rollback) by
          // the catch below on failure. The confirmed tier is never written
          // speculatively.
          if (s === 'broadcasting' && userH160) addPending('register', userH160)
        },
      })

      setTimeout(() => { txStatus.value = 'idle' }, 2000)
    } catch (e: any) {
      if (userH160) dropPending('register', userH160)
      txStatus.value = 'error'
      error.value = formatTxError(e)
    }
  }

  function reload(): Promise<void> {
    const wallet = useWalletStore()
    const userH160 = wallet.isConnected ? walletAddressToH160(wallet.address) : null
    return bootLoadAttendee(userH160)
  }

  return { isRegistered, ticketTokenId, isCheckedIn, txStatus, error, register, reload }
}
