import { ref, computed, type WritableComputedRef } from 'vue'
import type { TxStatus } from '@festival/shared/contracts/write'
import { writeContract } from '@festival/shared/contracts/write'
import { FestivalABI } from '@festival/shared/contracts/abis'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'
import { hasDeployedContracts } from '@festival/shared/contracts/festival-reads'
import { batchRead } from '@festival/shared/contracts/multicall'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { walletAddressToH160 } from '@festival/shared/utils/address'
import { festivalState } from '@festival/shared/cache/festival-state'
import { bootLoadAttendee } from './useBootLoad'

// Tx-state stays local. It's a per-action signal, not festival state.
const txStatus = ref<TxStatus>('idle')
const error = ref<string | null>(null)

/**
 * Registration composable. Derives the user's status from
 * `festivalState.festival.attendees` and `festivalState.user.ticketTokenId`.
 *
 * `isRegistered` and `isCheckedIn` are writable computed so the watcher's
 * ref-write path keeps working until it mutates state directly.
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

  const isRegistered: WritableComputedRef<boolean> = computed({
    get: () => {
      // Either present in attendees OR the user holds a festival POAP.
      return Boolean(findUserAttendee()) || festivalState.user.ticketTokenId > 0n
    },
    set: (v) => {
      // Keeps the ref-write contract: pushing the user into attendees is what
      // makes the getter return true.
      if (v && festivalState.user.address && festivalState.festival) {
        const exists = festivalState.festival.attendees.some(
          (a) => a.address.toLowerCase() === festivalState.user.address!.toLowerCase(),
        )
        if (!exists) {
          festivalState.festival.attendees.push({
            address: festivalState.user.address,
            isCheckedIn: false,
          })
        }
      }
    },
  })

  const isCheckedIn: WritableComputedRef<boolean> = computed({
    get: () => findUserAttendee()?.isCheckedIn ?? false,
    set: (v) => {
      const ul = userLower()
      if (!ul || !festivalState.festival) return
      const a = festivalState.festival.attendees.find((x) => x.address.toLowerCase() === ul)
      if (a) a.isCheckedIn = v
    },
  })

  const ticketTokenId = computed<number | null>(() => {
    const t = festivalState.user.ticketTokenId
    return t > 0n ? Number(t) : null
  })

  async function register() {
    error.value = null
    txStatus.value = 'preparing'
    try {
      const wallet = useWalletStore()
      await writeContract({
        address: FESTIVAL_ADDRESS as `0x${string}`,
        abi: FestivalABI,
        functionName: 'register',
        value: 0n,
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => {
          txStatus.value = s
          if (s === 'in-block') {
            isRegistered.value = true
          }
        },
      })

      setTimeout(() => { txStatus.value = 'idle' }, 2000)
    } catch (e: any) {
      txStatus.value = 'error'
      error.value = formatTxError(e)
    }
  }

  function reload(): Promise<void> {
    const wallet = useWalletStore()
    const userH160 = wallet.isConnected ? walletAddressToH160(wallet.address) : null
    return bootLoadAttendee(userH160)
  }

  /**
   * Light chain reconcile of the user's registration/check-in status — two
   * constant-size reads in one multicall (isCheckedIn + ticketOf), so it's
   * cheap enough to poll. Safety net for screens gated on `isCheckedIn` when
   * the event watcher missed a CheckedIn event or a boot load failed. On
   * drift (or when no festival state has landed yet) it runs a full bootLoad:
   * a missed check-in implies more than the flag changed (attendee row,
   * registeredCount, the festival POAP minted by checkIn), and bootLoad
   * refreshes and persists all of it consistently.
   */
  async function reconcileCheckInStatus(): Promise<void> {
    if (!hasDeployedContracts()) return
    const wallet = useWalletStore()
    if (!wallet.isConnected) return
    const userH160 = walletAddressToH160(wallet.address)

    if (!festivalState.festival) {
      return bootLoadAttendee(userH160)
    }

    const [chainCheckedIn, chainTicket] = (await batchRead([
      { address: FESTIVAL_ADDRESS, abi: FestivalABI, functionName: 'isCheckedIn', args: [userH160] },
      { address: FESTIVAL_ADDRESS, abi: FestivalABI, functionName: 'ticketOf', args: [userH160] },
    ])) as [boolean, bigint]

    const drifted =
      chainCheckedIn !== isCheckedIn.value ||
      (chainTicket > 0n) !== isRegistered.value

    if (drifted) {
      await bootLoadAttendee(userH160)
    }
  }

  return { isRegistered, ticketTokenId, isCheckedIn, txStatus, error, register, reload, reconcileCheckInStatus }
}
