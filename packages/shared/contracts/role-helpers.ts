import type { ContractRole } from '../permissions'
import { ROLES } from './types'
import { FestivalABI } from './abis'
import { batchRead } from './multicall'
import { useWalletStore } from '../host/wallet'
import { ss58ToH160, isValidEvmAddress } from '../utils/address'

const ROLE_CHECK_ORDER: { hash: `0x${string}`; label: ContractRole }[] = [
  { hash: ROLES.DEFAULT_ADMIN_ROLE, label: 'ADMIN' },
  { hash: ROLES.MANAGER_ROLE, label: 'MANAGER' },
  { hash: ROLES.VOLUNTEER_ROLE, label: 'VOLUNTEER' },
]

/**
 * Load the current wallet user's roles on any contract that uses
 * OZ AccessControlEnumerable (Festival or FestivalSubEvent).
 *
 * Returns ContractRole[] labels for roles the user holds.
 */
export async function loadUserRoles(contractAddress: `0x${string}`): Promise<ContractRole[]> {
  const wallet = useWalletStore()
  if (!wallet.isConnected) return []

  const userH160 = isValidEvmAddress(wallet.address)
    ? wallet.address as `0x${string}`
    : ss58ToH160(wallet.address)

  const results = await batchRead(
    ROLE_CHECK_ORDER.map(({ hash }) => ({
      address: contractAddress,
      abi: FestivalABI,
      functionName: 'hasRole',
      args: [hash, userH160],
    })),
  ) as boolean[]

  return ROLE_CHECK_ORDER
    .filter((_, i) => results[i])
    .map(({ label }) => label)
}

/** Role options for UI dropdowns / grant forms */
export const ROLE_OPTIONS = [
  { value: ROLES.DEFAULT_ADMIN_ROLE, label: 'Admin' },
  { value: ROLES.MANAGER_ROLE, label: 'Manager' },
  { value: ROLES.VOLUNTEER_ROLE, label: 'Volunteer' },
] as const
