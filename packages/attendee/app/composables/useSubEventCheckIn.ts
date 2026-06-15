import { ref } from 'vue'
import type { TxStatus } from '@festival/shared/contracts/write'
import { checkInSession, manualCheckInSession } from '@festival/shared/contracts/session-writes'
import { FestivalABI } from '@festival/shared/contracts/abis'
import { batchRead } from '@festival/shared/contracts/multicall'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { shortenAddress, ss58ToH160, isValidSs58, isValidEvmAddress } from '@festival/shared/utils/address'

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
    const address = qrData.trim()
    if (!isValidSs58(address)) {
      error.value = 'Invalid SS58 address'
      return
    }

    attendeeSS58.value = address
    error.value = null
    step.value = 'validating'

    try {
      const attendeeH160 = ss58ToH160(address)
      const [registered, checkedIn] = await batchRead([
        { address: subEventAddress as `0x${string}`, abi: FestivalABI, functionName: 'isRegistered', args: [attendeeH160] },
        { address: subEventAddress as `0x${string}`, abi: FestivalABI, functionName: 'isCheckedIn', args: [attendeeH160] },
      ]) as [boolean, boolean]

      if (checkedIn) {
        error.value = 'This account is already checked in'
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

    try {
      const wallet = useWalletStore()
      const attendeeH160 = toH160(attendeeSS58.value)
      const fn = accountStatus.value?.registered
        ? checkInSession
        : manualCheckInSession

      await fn({
        address: subEventAddress as `0x${string}`,
        attendee: attendeeH160,
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => {
          txStatus.value = s
          if (s === 'in-block') {
            addRecentCheckin({
              address: shortenAddress(attendeeSS58.value!),
              time: 'just now',
            })
            step.value = 'success'
          }
        },
      })
    } catch (e: any) {
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
