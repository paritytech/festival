import { ref } from 'vue'
import type { TxStatus } from '@festival/shared/contracts/write'
import { checkInSession, manualCheckInSession } from '@festival/shared/contracts/session-writes'
import { FestivalABI } from '@festival/shared/contracts/abis'
import { FESTIVAL_ADDRESS } from '@festival/shared/contracts/addresses'
import { batchRead } from '@festival/shared/contracts/multicall'
import { retryTransient, isTransientError, READ_RETRY_OPTS } from '@festival/shared/contracts/retry'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { resetMainClient } from '@festival/shared/host/client'
import { addPending, dropPending, sessionScopedId } from '@festival/shared/cache/pending'
import { shortenAddress, ss58ToH160, isValidSs58, isValidEvmAddress } from '@festival/shared/utils/address'
import { extractCheckInAddress } from '@festival/shared/checkin/qr'

export type SubEventCheckInStep =
  | 'idle'
  | 'scanning'
  | 'validating'
  | 'confirming'
  | 'executing'
  | 'success'
  | 'error'

export interface CheckInRecord {
  address: string
  time: string
}

function toH160(address: string): `0x${string}` {
  if (isValidEvmAddress(address)) return address as `0x${string}`
  if (isValidSs58(address)) return ss58ToH160(address)
  return address as `0x${string}`
}

export function useSubEventCheckIn(subEventAddress: string) {
  const step = ref<SubEventCheckInStep>('idle')
  const attendeeSS58 = ref<string | null>(null)
  const accountStatus = ref<{ registered: boolean; checkedIn: boolean } | null>(null)
  const txStatus = ref<TxStatus>('idle')
  const error = ref<string | null>(null)
  const recentCheckins = ref<CheckInRecord[]>([])
  const MAX_RECENT_CHECKINS = 50

  function addRecentCheckin(record: CheckInRecord) {
    recentCheckins.value.unshift(record)
    if (recentCheckins.value.length > MAX_RECENT_CHECKINS) {
      recentCheckins.value.length = MAX_RECENT_CHECKINS
    }
  }

  function reset() {
    step.value = 'idle'
    attendeeSS58.value = null
    accountStatus.value = null
    txStatus.value = 'idle'
    error.value = null
  }

  function startScanning() {
    reset()
    step.value = 'scanning'
  }

  async function handleScan(qrData: string) {
    // Passport and ticket QRs both resolve here, and an unreadable code now
    // shows an error. Before, a bad scan just silently vanished.
    const address = extractCheckInAddress(qrData)
    if (!address) {
      error.value = "Couldn't read that code. Show the attendee's account QR or enter their address manually."
      step.value = 'error'
      return
    }

    attendeeSS58.value = address
    error.value = null
    step.value = 'validating'

    try {
      const attendeeH160 = toH160(address)
      // Surface the on-chain check up front. The session contract requires the
      // attendee to be checked in to the parent festival first
      // (FestivalCheckInRequired), so we verify that here instead of letting it
      // surface as a confusing transaction revert after the operator confirms.
      const validate = () => retryTransient(
        () => batchRead([
          { address: FESTIVAL_ADDRESS, abi: FestivalABI, functionName: 'isCheckedIn', args: [attendeeH160] },
          { address: subEventAddress as `0x${string}`, abi: FestivalABI, functionName: 'isRegistered', args: [attendeeH160] },
          { address: subEventAddress as `0x${string}`, abi: FestivalABI, functionName: 'isCheckedIn', args: [attendeeH160] },
        ]),
        READ_RETRY_OPTS,
      ) as Promise<[boolean, boolean, boolean]>

      // On a whole round of timed-out / connection-failed reads, PAPI's follow
      // recovery is event-driven and the host provider can go silent, so a
      // wedged follow never re-establishes on its own — rebuild the client
      // (what a page refresh does) and try once more before giving up.
      const [festivalCheckedIn, registered, checkedIn] = await validate().catch((e) => {
        if (!isTransientError(e)) throw e
        resetMainClient()
        return validate()
      })

      if (checkedIn) {
        error.value = 'Already checked in to this session.'
        step.value = 'error'
        return
      }

      if (!festivalCheckedIn) {
        error.value = 'Not checked in to the festival yet. They need to check in at the festival entrance first.'
        step.value = 'error'
        return
      }

      accountStatus.value = { registered, checkedIn: false }
      step.value = 'confirming'
    } catch {
      error.value = 'Failed to verify account on-chain'
      step.value = 'error'
    }
  }

  async function executeCheckIn() {
    if (!attendeeSS58.value) return

    step.value = 'executing'
    txStatus.value = 'preparing'
    error.value = null

    // Captured before the tx so a late failure still drops the right key,
    // even if the operator already moved on to the next attendee.
    const attendeeH160 = toH160(attendeeSS58.value)
    const pendingId = sessionScopedId(attendeeH160, subEventAddress)
    try {
      const wallet = useWalletStore()
      const fn = accountStatus.value?.registered
        ? checkInSession
        : manualCheckInSession

      // Retry only PRE-broadcast transient failures (dry-run / mapping-read
      // blips). Once the tx is signed/broadcast it must never be re-submitted:
      // a retry would re-prompt the wallet and, if the first attempt landed,
      // surface a spurious "already checked in". A revert is deterministic and
      // throws straight through regardless.
      let committed = false
      await retryTransient(() => fn({
        address: subEventAddress as `0x${string}`,
        attendee: attendeeH160,
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => {
          txStatus.value = s
          if (s === 'signing' || s === 'broadcasting') committed = true
          // Session-scoped overlay entry: rolls back on failure, GC'd once
          // the session's attendee row confirms via the next read.
          if (s === 'broadcasting') addPending('checkin', pendingId)
          if (s === 'in-block') {
            addRecentCheckin({
              address: shortenAddress(attendeeSS58.value!),
              time: 'just now',
            })
            step.value = 'success'
          }
        },
      }), { shouldRetry: (e) => !committed && isTransientError(e) })
    } catch (e: any) {
      dropPending('checkin', pendingId)
      txStatus.value = 'error'
      error.value = formatTxError(e)
      step.value = 'error'
    }
  }

  async function manualCheckInByAddress(address: string) {
    attendeeSS58.value = address
    await handleScan(address)
    if (step.value === 'confirming') {
      await executeCheckIn()
    }
  }

  return {
    step,
    attendeeSS58,
    accountStatus,
    txStatus,
    error,
    recentCheckins,
    reset,
    startScanning,
    handleScan,
    executeCheckIn,
    manualCheckInByAddress,
  }
}
