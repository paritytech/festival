import { ref } from 'vue'
import type { SubEventDetails } from '@festival/shared/contracts/types'
import type { SubEventMetadata } from '@festival/shared/metadata/schemas'
import { hydrateSubEventMetadata } from '@festival/shared/metadata/schemas'
import type { TxStatus } from '@festival/shared/contracts/write'
import { isNonZeroCid } from '@festival/shared/contracts/festival-reads'
import { FestivalSessionABI, FestivalABI } from '@festival/shared/contracts/abis'
import { batchRead } from '@festival/shared/contracts/multicall'
import { ROLES } from '@festival/shared/contracts/types'
import { ROLE_OPTIONS } from '@festival/shared/contracts/role-helpers'
import {
  cancelSession, grantSessionRole, revokeSessionRole, updateSessionCid,
} from '@festival/shared/contracts/session-writes'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useBulletinStorage } from '@festival/shared/metadata/bulletin'
import { useWalletStore } from '@festival/shared/host/wallet'
import { setCachedMetadata } from '@festival/shared/cache/cid-cache'
import { ss58ToH160, isValidSs58, isValidEvmAddress } from '@festival/shared/utils/address'
import { useSubEvents } from './useSubEvents'

export interface RoleHolder {
  address: string
  roles: string[]
}

export function useSubEventManage(address: string) {
  const details = ref<SubEventDetails | null>(null)
  const metadata = ref<SubEventMetadata | null>(null)
  const attendees = ref<{ address: `0x${string}`; isCheckedIn: boolean }[]>([])
  const holders = ref<RoleHolder[]>([])
  const isLoading = ref(true)
  const txStatus = ref<TxStatus>('idle')
  const error = ref<string | null>(null)

  async function load() {
    isLoading.value = true
    try {
      const addr = address as `0x${string}`

      // Batch initial reads: session details + attendees (2 reads → 1 round-trip)
      const [rawDetails, rawAttendees] = await batchRead([
        { address: addr, abi: FestivalSessionABI, functionName: 'getEventDetails' },
        { address: addr, abi: FestivalSessionABI, functionName: 'getAttendees' },
      ]) as [
        readonly [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, bigint, bigint, boolean, bigint],
        readonly [`0x${string}`[], boolean[]],
      ]

      details.value = {
        metadataCid: rawDetails[0],
        creator: rawDetails[1],
        poapContract: rawDetails[2],
        parentFestival: rawDetails[3],
        startTime: rawDetails[4],
        endTime: rawDetails[5],
        cancelled: rawDetails[6],
        registeredCount: rawDetails[7],
      } as any

      attendees.value = rawAttendees[0].map((a, i) => ({
        address: a,
        isCheckedIn: rawAttendees[1][i],
      }))

      if (isNonZeroCid(details.value!.metadataCid)) {
        try {
          const { retrievePlaintext } = useBulletinStorage()
          metadata.value = hydrateSubEventMetadata(
            await retrievePlaintext<SubEventMetadata>(details.value!.metadataCid),
          )
        } catch (e) {
          console.warn(`[useSubEventManage] Failed to fetch metadata for ${addr}:`, e)
        }
      }

      // Load role holders. Two-phase batch
      // Phase 1: get member counts for all roles (3 reads → 1 round-trip)
      const counts = await batchRead(
        ROLE_OPTIONS.map((opt) => ({
          address: addr, abi: FestivalABI, functionName: 'getRoleMemberCount', args: [opt.value],
        })),
      ) as bigint[]

      // Phase 2: get all members (sum of counts → 1 round-trip)
      const memberCalls = ROLE_OPTIONS.flatMap((opt, roleIdx) =>
        Array.from({ length: Number(counts[roleIdx]) }, (_, i) => ({
          address: addr, abi: FestivalABI, functionName: 'getRoleMember', args: [opt.value, BigInt(i)],
        })),
      )

      const map = new Map<string, string[]>()
      if (memberCalls.length > 0) {
        const members = await batchRead(memberCalls) as `0x${string}`[]
        let offset = 0
        for (let roleIdx = 0; roleIdx < ROLE_OPTIONS.length; roleIdx++) {
          const count = Number(counts[roleIdx])
          for (let i = 0; i < count; i++) {
            const member = members[offset + i]
            const existing = map.get(member) || []
            existing.push(ROLE_OPTIONS[roleIdx].label)
            map.set(member, existing)
          }
          offset += count
        }
      }
      holders.value = Array.from(map.entries()).map(([addr, roles]) => ({ address: addr, roles }))

    } catch (e) {
      console.error('[useSubEventManage] Load error:', e)
    } finally {
      isLoading.value = false
    }
  }

  function getWriteOpts(onStatus: (s: TxStatus) => void) {
    const wallet = useWalletStore()
    return {
      address: address as `0x${string}`,
      signer: wallet.getSigner(),
      walletAddress: wallet.address,
      onStatus,
    }
  }

  async function handleUpdateCapacity(newCapacity: number) {
    error.value = null
    txStatus.value = 'preparing'
    try {
      // TODO: updateSessionCapacity not yet available in session-writes
      throw new Error('Capacity update not yet implemented for sessions')
      setTimeout(() => { txStatus.value = 'idle' }, 2000)
    } catch (e) {
      txStatus.value = 'error'
      error.value = formatTxError(e)
    }
  }

  async function handleCancel() {
    error.value = null
    txStatus.value = 'preparing'
    try {
      const parentFestival = details.value?.parentFestival
      if (!parentFestival) throw new Error('Parent festival address unavailable')
      await cancelSession({
        ...getWriteOpts(s => {
          txStatus.value = s
          if (s === 'in-block' && details.value) {
            details.value = { ...details.value, cancelled: true }
            useSubEvents().reload()
          }
        }),
        address: parentFestival,
        sessionAddress: address as `0x${string}`,
      })
      setTimeout(() => { txStatus.value = 'idle' }, 2000)
    } catch (e) {
      txStatus.value = 'error'
      error.value = formatTxError(e)
    }
  }

  async function handleWithdraw() {
    error.value = null
    txStatus.value = 'preparing'
    try {
      // TODO: withdrawSessionFunds not yet available in session-writes
      throw new Error('Fund withdrawal not yet implemented for sessions')
    } catch (e) {
      txStatus.value = 'error'
      error.value = formatTxError(e)
    }
  }

  async function handleGrantRole(role: `0x${string}`, targetAddress: string) {
    error.value = null
    txStatus.value = 'preparing'
    try {
      const targetH160 = isValidEvmAddress(targetAddress)
        ? targetAddress as `0x${string}`
        : isValidSs58(targetAddress) ? ss58ToH160(targetAddress) : targetAddress as `0x${string}`

      const roleName = ROLE_OPTIONS.find(r => r.value === role)?.label || 'Unknown'
      await grantSessionRole({
        ...getWriteOpts(s => {
          txStatus.value = s
          if (s === 'in-block') {
            const existing = holders.value.find(h => h.address.toLowerCase() === targetH160.toLowerCase())
            if (existing) {
              if (!existing.roles.includes(roleName)) existing.roles.push(roleName)
            } else {
              holders.value.push({ address: targetH160, roles: [roleName] })
            }
          }
        }),
        role,
        account: targetH160,
      })
      setTimeout(() => { txStatus.value = 'idle' }, 2000)
    } catch (e) {
      txStatus.value = 'error'
      error.value = formatTxError(e)
    }
  }

  async function handleRevokeRole(role: `0x${string}`, targetAddress: string) {
    error.value = null
    txStatus.value = 'preparing'
    try {
      const targetH160 = isValidEvmAddress(targetAddress)
        ? targetAddress as `0x${string}`
        : isValidSs58(targetAddress) ? ss58ToH160(targetAddress) : targetAddress as `0x${string}`

      const revokeRoleName = ROLE_OPTIONS.find(r => r.value === role)?.label || 'Unknown'
      await revokeSessionRole({
        ...getWriteOpts(s => {
          txStatus.value = s
          if (s === 'in-block') {
            const target = holders.value.find(h => h.address.toLowerCase() === targetH160.toLowerCase())
            if (target) {
              target.roles = target.roles.filter(r => r !== revokeRoleName)
              if (target.roles.length === 0) {
                holders.value = holders.value.filter(h => h.address.toLowerCase() !== targetH160.toLowerCase())
              }
            }
          }
        }),
        role,
        account: targetH160,
      })
      setTimeout(() => { txStatus.value = 'idle' }, 2000)
    } catch (e) {
      txStatus.value = 'error'
      error.value = formatTxError(e)
    }
  }

  async function handleUpdateMetadata(newMetadata: SubEventMetadata) {
    error.value = null
    txStatus.value = 'preparing'
    try {
      const { storePlaintext } = useBulletinStorage()
      const result = await storePlaintext(newMetadata)

      // Pre-cache metadata under the new CID (so retrieval is instant after CID pointer update)
      await setCachedMetadata(result.cid, newMetadata)

      txStatus.value = 'signing'
      await updateSessionCid({
        ...getWriteOpts(s => {
          txStatus.value = s
          // Apply optimistic metadata only once tx is in a block
          if (s === 'in-block') {
            metadata.value = hydrateSubEventMetadata(newMetadata)
          }
        }),
        newCid: result.bytes32,
      })
      setTimeout(() => { txStatus.value = 'idle' }, 2000)
    } catch (e) {
      txStatus.value = 'error'
      error.value = formatTxError(e)
    }
  }

  load()

  return {
    details,
    metadata,
    attendees,
    holders,
    isLoading,
    txStatus,
    error,
    handleUpdateCapacity,
    handleCancel,
    handleWithdraw,
    handleGrantRole,
    handleRevokeRole,
    handleUpdateMetadata,
    reload: load,
  }
}
