import { ref, computed } from 'vue'
import type { TxStatus } from '@festival/shared/contracts/write'
import { writeContract } from '@festival/shared/contracts/write'
import { FestivalABI } from '@festival/shared/contracts/abis'
import { formatTxError } from '@festival/shared/contracts/errors'
import { useWalletStore } from '@festival/shared/host/wallet'
import { ss58ToH160, isValidSs58, isValidEvmAddress, walletAddressToH160 } from '@festival/shared/utils/address'
import { ROLE_OPTIONS } from '@festival/shared/contracts/role-helpers'
import { festivalState } from '@festival/shared/cache/festival-state'
import { bootLoadAdmin } from './useBootLoad'

export { ROLE_OPTIONS } from '@festival/shared/contracts/role-helpers'

export interface RoleHolder {
  address: string
  roles: string[]
}

/**
 * Roles composable. Holders derived from `festivalState.roles` populated
 * by bootLoadAdmin. Mutating writes (grant/revoke) hit chain and update
 * the local holders array optimistically.
 */
export function useRoles(festivalAddress: string) {
  const txStatus = ref<TxStatus>('idle')

  const holders = computed<RoleHolder[]>(() => {
    // Build address → roles map from festivalState.roles (per-role members).
    const map = new Map<string, string[]>()
    for (const { role, members } of festivalState.roles) {
      const label = ROLE_OPTIONS.find((o) => o.value === role)?.label
      if (!label) continue
      for (const member of members) {
        const list = map.get(member) || []
        if (!list.includes(label)) list.push(label)
        map.set(member, list)
      }
    }
    return Array.from(map.entries()).map(([address, roles]) => ({ address, roles }))
  })

  /**
   * Read the current user's roles directly from `festivalState.user.roles`.
   * Returns the upper-cased ContractRole labels (ADMIN/MANAGER/VOLUNTEER).
   */
  async function loadCurrentUserRoles(): Promise<string[]> {
    return festivalState.user.roles
  }

  function applyHolderUpdate(address: string, roleName: string, action: 'add' | 'remove') {
    // Mutate the members array so the `holders` computed reflects it optimistically.
    const roleHash = ROLE_OPTIONS.find((o) => o.label === roleName)?.value
    if (!roleHash) return
    const slot = festivalState.roles.find((r) => r.role === roleHash)
    if (!slot) return
    const lower = address.toLowerCase()
    if (action === 'add') {
      if (!slot.members.some((m) => m.toLowerCase() === lower)) {
        slot.members.push(address as `0x${string}`)
      }
    } else {
      slot.members = slot.members.filter((m) => m.toLowerCase() !== lower)
    }
  }

  async function grantRole(role: `0x${string}`, address: string) {
    txStatus.value = 'preparing'
    try {
      const wallet = useWalletStore()
      const targetH160 = isValidEvmAddress(address)
        ? address as `0x${string}`
        : isValidSs58(address) ? ss58ToH160(address) : address as `0x${string}`

      await writeContract({
        address: festivalAddress as `0x${string}`,
        abi: FestivalABI,
        functionName: 'grantRole',
        args: [role, targetH160],
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => { txStatus.value = s },
      })

      const roleName = ROLE_OPTIONS.find((o) => o.value === role)?.label || 'Unknown'
      applyHolderUpdate(targetH160, roleName, 'add')
    } catch (e) {
      txStatus.value = 'error'
      throw new Error(formatTxError(e))
    }
  }

  async function revokeRole(role: `0x${string}`, address: string) {
    txStatus.value = 'preparing'
    try {
      const wallet = useWalletStore()
      const targetH160 = isValidEvmAddress(address)
        ? address as `0x${string}`
        : isValidSs58(address) ? ss58ToH160(address) : address as `0x${string}`
      const roleName = ROLE_OPTIONS.find((o) => o.value === role)?.label || 'Unknown'

      await writeContract({
        address: festivalAddress as `0x${string}`,
        abi: FestivalABI,
        functionName: 'revokeRole',
        args: [role, targetH160],
        signer: wallet.getSigner(),
        walletAddress: wallet.address,
        onStatus: (s) => {
          txStatus.value = s
          if (s === 'in-block') {
            applyHolderUpdate(targetH160, roleName, 'remove')
          }
        },
      })
    } catch (e) {
      txStatus.value = 'error'
      throw new Error(formatTxError(e))
    }
  }

  function reload(): Promise<void> {
    const wallet = useWalletStore()
    const userH160 = wallet.isConnected ? walletAddressToH160(wallet.address) : null
    return bootLoadAdmin(festivalAddress as `0x${string}`, userH160)
  }

  return { txStatus, holders, grantRole, revokeRole, loadCurrentUserRoles, reload }
}
